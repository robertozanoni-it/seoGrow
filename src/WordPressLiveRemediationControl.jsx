import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Eye, ShieldCheck, Wrench } from "lucide-react";
import { apiFetch } from "./api";
import { normalizeAnalysisHistory } from "./platform";
import { saveCorrection, setLastBatch } from "./remediationStore";
import "./WordPressLiveRemediationControl.css";

const CLIENTS_KEY = "seogrow-clients";
const SELECTED_CLIENT_KEY = "seogrow-selected-client-v1";
const PAGE_HISTORY_KEY = "seogrow-page-audit-history-v2";
const SITE_HISTORY_KEY = "seogrow-analyses-v2";

const readJson = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};

const resolveTarget = () =>
  typeof document === "undefined"
    ? null
    : document.querySelector(".audit-unified-remediation");

const auditTimestamp = (entry) => entry?.item?.analyzedAt || entry?.item?.startedAt || "";

const candidates = (clientId) => {
  const pages = readJson(PAGE_HISTORY_KEY, {})[clientId] || [];
  const sites = normalizeAnalysisHistory(readJson(SITE_HISTORY_KEY, {})[clientId]);
  return [
    ...(Array.isArray(pages) ? pages.map((item) => ({ type: "page", item })) : []),
    ...sites.map((item) => ({ type: "site", item })),
  ].toSorted(
    (a, b) => Date.parse(auditTimestamp(b) || 0) - Date.parse(auditTimestamp(a) || 0),
  );
};

const selectAudit = (clientId, requested) => {
  const list = candidates(clientId);
  if (!requested || Number(requested.clientId) !== Number(clientId)) return list[0] || null;
  return list.find((entry) =>
    entry.type === requested.auditType &&
    String(auditTimestamp(entry)) === String(requested.analyzedAt || ""),
  ) || list[0] || null;
};

const issueUrl = (issue, audit, client) =>
  issue?.targetUrl || issue?.url || audit?.url || client?.url || "";

const issueText = (issue) =>
  `${issue?.type || ""} ${issue?.label || ""} ${issue?.detail || ""}`.toLowerCase();

const classifyIssue = (issue) => {
  const text = issueText(issue);
  if (/meta description/.test(text)) return "meta_description";
  if (/canonical/.test(text)) return "canonical";
  if (/noindex/.test(text)) return "noindex";
  if (/h1/.test(text)) return "h1";
  if (/excerpt|estratto/.test(text)) return "excerpt";
  if (/contenuto|content|testo|parole|word|brev/.test(text)) return "content";
  if (/title|titolo/.test(text)) return "title";
  return "";
};

const readCredentials = () => {
  const root = document.querySelector(".audit-unified-credentials");
  const inputs = [...(root?.querySelectorAll("input") || [])];
  return {
    url: inputs.find((input) => input.autocomplete === "url")?.value?.trim() || "",
    username: inputs.find((input) => input.autocomplete === "username")?.value?.trim() || "",
    applicationPassword: inputs.find((input) => input.type === "password")?.value || "",
  };
};

const pluginMeta = (entity) => entity?.meta && typeof entity.meta === "object" ? entity.meta : {};

const metaKey = (entity, kind) => {
  const meta = pluginMeta(entity);
  const has = (key) => Object.prototype.hasOwnProperty.call(meta, key);
  const candidatesByKind = {
    title: [
      ["rank_math_title", "Rank Math"],
      ["_yoast_wpseo_title", "Yoast"],
    ],
    meta_description: [
      ["rank_math_description", "Rank Math"],
      ["_yoast_wpseo_metadesc", "Yoast"],
    ],
    canonical: [
      ["rank_math_canonical_url", "Rank Math"],
      ["_yoast_wpseo_canonical", "Yoast"],
    ],
    noindex: [
      ["rank_math_robots", "Rank Math"],
      ["_yoast_wpseo_meta-robots-noindex", "Yoast"],
    ],
  };
  return (candidatesByKind[kind] || []).find(([key]) => has(key)) || null;
};

const parseElementor = (entity) => {
  const raw = pluginMeta(entity)._elementor_data;
  if (!raw) return null;
  try {
    const data = typeof raw === "string" ? JSON.parse(raw) : structuredClone(raw);
    return { data, rawType: typeof raw };
  } catch {
    return null;
  }
};

const walkElementor = (items, visitor) => {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    visitor(item);
    walkElementor(item?.elements, visitor);
  }
};

const serializeElementor = (parsed) => JSON.stringify(parsed.data);
const countH1 = (value) => (String(value || "").match(/<h1\b[^>]*>/gi) || []).length;

const pageContext = (entity, targetUrl, contentOverride) => ({
  title: entity?.title?.raw || entity?.title?.rendered || "",
  content: contentOverride ?? entity?.content?.raw ?? entity?.content?.rendered ?? "",
  excerpt: entity?.excerpt?.raw || entity?.excerpt?.rendered || "",
  url: targetUrl,
});

async function inspectWordPress(targetUrl, credentials) {
  const response = await apiFetch("/api/wordpress/inspect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: targetUrl,
      username: credentials.username,
      applicationPassword: credentials.applicationPassword,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Ispezione WordPress non riuscita.");
  return data;
}

async function verifyCoreOwnership(kind, targetUrl, inspected) {
  if (!["title", "content", "h1"].includes(kind)) return { ok: true, frontend: null };
  const entity = inspected.entity || {};
  const expected = kind === "title"
    ? { title: entity.title?.raw || entity.title?.rendered || "" }
    : { content: entity.content?.raw || entity.content?.rendered || "" };
  const response = await apiFetch("/api/wordpress/verify-frontend", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: targetUrl, expected }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Controllo ownership frontend non riuscito.");
  if (kind === "title") return { ok: data.titleMatchesExpected === true, frontend: data };
  if (kind === "h1") {
    const coreH1 = countH1(entity.content?.raw || entity.content?.rendered || "");
    const frontendH1 = Number(data.h1);
    return {
      ok: data.contentProbeVisible === true && frontendH1 === coreH1,
      frontend: data,
      coreH1,
      frontendH1,
    };
  }
  return { ok: data.contentProbeVisible === true, frontend: data };
}

const alreadyResolvedReason = (kind, issue, ownership) => {
  const frontend = ownership?.frontend;
  if (!frontend) return "";
  if (kind === "h1") {
    const label = String(issue?.label || "");
    const claimedMissing = /\b0\s*H1\b/i.test(label);
    const claimedMultiple = /\b(?:[2-9]|[1-9]\d+)\s*H1\b/i.test(label);
    if ((claimedMissing || claimedMultiple) && Number(frontend.h1) === 1) {
      return "Il problema H1 dell’audit non è più presente: il frontend corrente contiene esattamente 1 H1. Esegui un nuovo audit per aggiornare il report.";
    }
  }
  if (kind === "content" && /brev|parole|word/.test(issueText(issue))) {
    const words = Number(frontend.words);
    const minimumWords = Number(frontend.minimumWords);
    if (Number.isFinite(words) && Number.isFinite(minimumWords) && minimumWords > 0 && words >= minimumWords) {
      return `Il problema di contenuto breve non è più presente: il frontend corrente contiene ${words} parole (soglia ${minimumWords}). Esegui un nuovo audit per aggiornare il report.`;
    }
  }
  return "";
};

async function generateCorePatch(kind, issue, entity, targetUrl, contentOverride) {
  const response = await apiFetch("/api/wordpress/generate-patch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      topic: `Remediation WordPress ${kind}`,
      context: JSON.stringify({ issue, page: pageContext(entity, targetUrl, contentOverride) }),
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.content) throw new Error(data.error || "Generazione patch non riuscita.");
  let parsed;
  try {
    parsed = JSON.parse(String(data.content));
  } catch {
    throw new Error("La patch WordPress generata non è valida.");
  }
  if (!parsed?.changes || typeof parsed.changes !== "object") throw new Error("La patch WordPress è vuota.");
  return parsed.changes;
}

async function generateSeoValue(kind, issue, entity, targetUrl) {
  const response = await apiFetch("/api/wordpress/generate-seo-value", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, issue, page: pageContext(entity, targetUrl) }),
  });
  const data = await response.json();
  if (!response.ok || !data.value) throw new Error(data.error || "Generazione valore SEO non riuscita.");
  return String(data.value).trim();
}

async function elementorPlan(kind, issue, entity, targetUrl) {
  const parsed = parseElementor(entity);
  if (!parsed) return null;

  if (kind === "h1") {
    const headings = [];
    walkElementor(parsed.data, (item) => {
      if (item?.widgetType === "heading" && item.settings) headings.push(item);
    });
    if (!headings.length) return null;
    const h1 = headings.filter((item) => String(item.settings?.header_size || "h2").toLowerCase() === "h1");
    const label = String(issue?.label || "");
    if (/\b0\s*H1\b/i.test(label) || h1.length === 0) {
      headings[0].settings.header_size = "h1";
    } else if (/\b(?:2|3|4|5|6|7|8|9)\s*H1\b/i.test(label) || h1.length > 1) {
      h1.slice(1).forEach((item) => { item.settings.header_size = "h2"; });
    } else return null;
    return {
      adapter: "Elementor",
      changes: { meta: { _elementor_data: serializeElementor(parsed) } },
    };
  }

  if (kind === "content") {
    const editors = [];
    walkElementor(parsed.data, (item) => {
      const editor = item?.widgetType === "text-editor" ? item.settings?.editor : "";
      if (typeof editor === "string" && editor.trim()) editors.push({ item, editor });
    });
    if (!editors.length) return null;
    editors.sort((a, b) => b.editor.length - a.editor.length);
    const selected = editors[0];
    const patch = await generateCorePatch("content", issue, entity, targetUrl, selected.editor);
    if (!patch.content || patch.content === selected.editor) return null;
    selected.item.settings.editor = patch.content;
    return {
      adapter: "Elementor",
      changes: { meta: { _elementor_data: serializeElementor(parsed) } },
    };
  }

  return null;
}

async function buildPlan(kind, issue, inspected, targetUrl) {
  const entity = inspected.entity || {};

  if (["content", "h1", "title"].includes(kind)) {
    const ownership = await verifyCoreOwnership(kind, targetUrl, inspected);
    const resolvedReason = alreadyResolvedReason(kind, issue, ownership);
    if (resolvedReason) return { alreadyResolved: true, reason: resolvedReason };
    if (ownership.ok) {
      return {
        adapter: "WordPress core",
        changes: await generateCorePatch(kind, issue, entity, targetUrl),
      };
    }
    if (["content", "h1"].includes(kind)) {
      const elementor = await elementorPlan(kind, issue, entity, targetUrl);
      if (elementor) return elementor;
      throw new Error("Il frontend è gestito da Elementor/template, ma _elementor_data non è disponibile o non contiene un widget modificabile in sicurezza.");
    }
    const plugin = metaKey(entity, "title");
    if (!plugin)
      throw new Error("Il title SEO è gestito dal frontend ma Rank Math/Yoast non espongono un campo REST scrivibile per questa pagina.");
    const value = await generateSeoValue("seo_title", issue, entity, targetUrl);
    return { adapter: plugin[1], changes: { meta: { [plugin[0]]: value } } };
  }

  if (kind === "excerpt") {
    return {
      adapter: "WordPress core",
      changes: await generateCorePatch("excerpt", issue, entity, targetUrl),
    };
  }

  if (kind === "meta_description") {
    const plugin = metaKey(entity, kind);
    if (!plugin) throw new Error("Rank Math/Yoast non espongono la meta description come campo REST scrivibile per questa pagina.");
    const value = await generateSeoValue("meta_description", issue, entity, targetUrl);
    return { adapter: plugin[1], changes: { meta: { [plugin[0]]: value } } };
  }

  if (kind === "canonical") {
    const plugin = metaKey(entity, kind);
    if (!plugin) throw new Error("Rank Math/Yoast non espongono la canonical come campo REST scrivibile per questa pagina.");
    return { adapter: plugin[1], changes: { meta: { [plugin[0]]: targetUrl } } };
  }

  if (kind === "noindex") {
    const plugin = metaKey(entity, kind);
    if (!plugin) throw new Error("Rank Math/Yoast non espongono la direttiva noindex come campo REST scrivibile per questa pagina.");
    const [key, adapter] = plugin;
    const current = pluginMeta(entity)[key];
    let next;
    if (key === "_yoast_wpseo_meta-robots-noindex") next = "2";
    else if (Array.isArray(current)) next = [...new Set(["index", "follow", ...current.filter((item) => !/noindex/i.test(String(item)))])];
    else next = "index,follow";
    return { adapter, changes: { meta: { [key]: next } } };
  }

  throw new Error("Questo problema non dispone ancora di un adapter WordPress applicabile.");
}

const flattenState = (state, fields) => {
  const flat = {};
  for (const field of fields || []) {
    if (field.startsWith("meta.")) flat[field] = state?.meta?.[field.slice(5)] ?? "";
    else flat[field] = state?.[field] ?? "";
  }
  return flat;
};

const compactPreviewValue = (value) => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return value;
  const text = String(value ?? "");
  if (text.length <= 1400) return text || "(vuoto)";
  return `${text.slice(0, 900)}\n…\n${text.slice(-420)}`;
};

const localPreview = (entity, changes) => {
  const before = {};
  const after = {};
  for (const key of ["title", "content", "excerpt"]) {
    if (changes?.[key] === undefined) continue;
    before[key] = compactPreviewValue(entity?.[key]?.raw ?? entity?.[key]?.rendered ?? "");
    after[key] = compactPreviewValue(changes[key]);
  }
  if (changes?.meta) {
    before.meta = {};
    after.meta = {};
    for (const [key, value] of Object.entries(changes.meta)) {
      before.meta[key] = compactPreviewValue(entity?.meta?.[key] ?? "");
      after.meta[key] = compactPreviewValue(value);
    }
  }
  return { before, after };
};

const hasUsefulPreview = (value) => value && typeof value === "object" && Object.keys(value).length > 0;
const previewText = (value) => JSON.stringify(value, null, 2) || "(anteprima non disponibile)";

export default function WordPressLiveRemediationControl() {
  const [target, setTarget] = useState(() => resolveTarget());
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState([]);
  const [message, setMessage] = useState("");
  const [requestedAudit, setRequestedAudit] = useState(null);

  useEffect(() => {
    const sync = () => setTarget((current) => {
      const next = resolveTarget();
      return current === next ? current : next;
    });
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setTimeout(sync, 0);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const open = (event) => {
      const detail = event?.detail || {};
      setRequestedAudit({
        clientId: Number(detail.clientId),
        issueIndex: Number(detail.issueIndex || 0),
        auditType: detail.auditType || "page",
        analyzedAt: detail.analyzedAt || "",
      });
    };
    window.addEventListener("seogrow-remediation-open", open);
    return () => window.removeEventListener("seogrow-remediation-open", open);
  }, []);

  useEffect(() => {
    const hideLegacy = () => {
      document.querySelectorAll(".audit-unified-actions button").forEach((button) => {
        if (button.dataset.seogrowLive === "1") return;
        if (/^Correggi tutti|^Correggi questo problema/i.test(String(button.textContent || "").trim())) {
          button.hidden = true;
          button.dataset.seogrowLegacyCorrection = "1";
        }
      });
    };
    hideLegacy();
    const observer = new MutationObserver(hideLegacy);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      document.querySelectorAll('[data-seogrow-legacy-correction="1"]').forEach((button) => { button.hidden = false; });
    };
  }, [target]);

  const previews = useMemo(() => results.filter((item) => item.status === "preview"), [results]);

  if (!target) return null;

  const currentContext = () => {
    const clients = readJson(CLIENTS_KEY, []);
    const clientId = Number(readJson(SELECTED_CLIENT_KEY, clients[0]?.id));
    const client = clients.find((item) => Number(item.id) === clientId) || clients[0];
    const audit = client ? selectAudit(clientId, requestedAudit) : null;
    const issues = Array.isArray(audit?.item?.issues) ? audit.item.issues : [];
    return { clientId, client, audit, issues };
  };

  const prepare = async (all) => {
    const credentials = readCredentials();
    if (!credentials.url || !credentials.username || !credentials.applicationPassword) {
      setMessage("Connetti WordPress inserendo URL, utente e password applicativa prima di preparare le correzioni.");
      return;
    }
    const context = currentContext();
    if (!context.client || !context.audit || !context.issues.length) {
      setMessage("Nessun audit con problemi disponibile per il cliente corrente.");
      return;
    }
    const domIndex = Number(document.querySelector(".audit-issue-select select")?.value || 0);
    const requestedIndex = requestedAudit && Number(requestedAudit.clientId) === Number(context.clientId)
      ? Number(requestedAudit.issueIndex || 0)
      : domIndex;
    const selected = all ? context.issues : [context.issues[requestedIndex]].filter(Boolean);
    setRunning(true);
    setResults([]);
    const next = [];
    for (let index = 0; index < selected.length; index += 1) {
      const currentIssue = selected[index];
      setMessage(`Preparazione anteprima ${index + 1}/${selected.length}: ${currentIssue?.label || "problema SEO"}…`);
      try {
        const kind = classifyIssue(currentIssue);
        if (!kind) throw new Error("Questo problema non dispone ancora di un adapter WordPress applicabile.");
        const targetUrl = issueUrl(currentIssue, context.audit.item, context.client);
        const inspected = await inspectWordPress(targetUrl, credentials);
        const plan = await buildPlan(kind, currentIssue, inspected, targetUrl);
        if (plan.alreadyResolved) {
          next.push({ status: "resolved", issue: currentIssue, targetUrl, reason: plan.reason });
          setResults([...next]);
          continue;
        }
        const response = await apiFetch("/api/wordpress/live-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            siteUrl: credentials.url,
            targetUrl,
            username: credentials.username,
            applicationPassword: credentials.applicationPassword,
            resource: inspected.resource,
            id: inspected.entity.id,
            changes: plan.changes,
            issue: currentIssue,
            adapter: plan.adapter,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Anteprima WordPress non riuscita.");
        const fallback = localPreview(inspected.entity || {}, plan.changes || {});
        if (!hasUsefulPreview(data.previewBefore)) data.previewBefore = fallback.before;
        if (!hasUsefulPreview(data.previewAfter)) data.previewAfter = fallback.after;
        next.push({ status: "preview", issue: currentIssue, targetUrl, plan, data });
      } catch (error) {
        next.push({
          status: "unsupported",
          issue: currentIssue,
          reason: error instanceof Error ? error.message : "Preparazione correzione non riuscita.",
        });
      }
      setResults([...next]);
    }
    const ready = next.filter((item) => item.status === "preview").length;
    const resolved = next.filter((item) => item.status === "resolved").length;
    const skipped = next.length - ready - resolved;
    setMessage(
      ready > 0
        ? `Anteprima pronta: ${ready} modifiche applicabili, ${resolved} problemi già risolti nel frontend corrente, ${skipped} non applicabili. Nessuna modifica live è stata ancora eseguita.`
        : `Nessuna modifica da applicare: ${resolved} problemi risultano già risolti nel frontend corrente, ${skipped} richiedono un adapter o un campo REST disponibile.`,
    );
    setRunning(false);
  };

  const apply = async () => {
    const credentials = readCredentials();
    if (!previews.length || applying) return;
    if (!credentials.username || !credentials.applicationPassword) {
      setMessage("La password applicativa non è disponibile. Reinseriscila prima dell'approvazione.");
      return;
    }
    if (!window.confirm(`Applicare ORA ${previews.length} modifiche al sito WordPress live? SeoGrow userà esattamente le anteprime mostrate.`)) return;

    const context = currentContext();
    const batchId = `live-remediation-${Date.now()}`;
    setLastBatch(batchId);
    sessionStorage.setItem("seogrow-remediation-active-batch-v1", batchId);
    setApplying(true);
    const updated = [...results];

    for (let index = 0; index < updated.length; index += 1) {
      const item = updated[index];
      if (item.status !== "preview") continue;
      setMessage(`Applicazione live: ${item.issue?.label || "problema SEO"}…`);
      try {
        const response = await apiFetch("/api/wordpress/live-apply", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            approvalToken: item.data.approvalToken,
            username: credentials.username,
            applicationPassword: credentials.applicationPassword,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Applicazione live non riuscita.");
        const fields = data.changed || [];
        const record = {
          id: `correction-${crypto.randomUUID()}`,
          batchId,
          clientId: context.clientId,
          clientName: context.client?.name || "",
          platform: "wordpress",
          liveApproval: true,
          adapter: data.adapter || item.plan.adapter,
          issue: item.issue,
          issueLabel: item.issue?.label || "Problema SEO",
          issueType: item.issue?.type || "audit",
          severity: item.issue?.severity || "media",
          sourceUrl: data.sourceUrl || item.targetUrl,
          resource: data.resource,
          entityId: Number(data.id),
          username: credentials.username,
          fields,
          before: flattenState(data.before, fields),
          after: flattenState(data.after, fields),
          rollbackChanges: data.before,
          status: "Da verificare",
          appliedAt: new Date().toISOString(),
          frontendConfirmed: false,
          verificationNote: `Modifica live approvata e applicata tramite ${data.adapter || item.plan.adapter}. Esegui la riverifica SeoGrow; per duplicati serve un nuovo crawl completo.`,
        };
        await saveCorrection(record);
        window.dispatchEvent(new CustomEvent("seogrow-remediation-applied", { detail: { id: record.id, batchId } }));
        updated[index] = { ...item, status: "applied", data: { ...item.data, apply: data } };
      } catch (error) {
        updated[index] = {
          ...item,
          status: "error",
          reason: error instanceof Error ? error.message : "Applicazione live non riuscita.",
        };
      }
      setResults([...updated]);
    }

    const applied = updated.filter((item) => item.status === "applied").length;
    const errors = updated.filter((item) => item.status === "error").length;
    setMessage(
      `Applicazione live completata: ${applied} modifiche scritte in WordPress, ${errors} errori. Le modifiche applicate sono registrate in Correzioni e restano Da verificare finché il nuovo audit non le conferma.`,
    );
    sessionStorage.removeItem("seogrow-remediation-active-batch-v1");
    setApplying(false);
  };

  return createPortal(
    <section className="wp-live-remediation panel" aria-label="Remediation WordPress live con approvazione">
      <div className="wp-live-remediation-head">
        <div>
          <span><ShieldCheck /> Modalità live controllata</span>
          <h3>Anteprima → approvazione → applicazione → riverifica</h3>
          <p>SeoGrow prepara la modifica sul campo che alimenta davvero il frontend, riconosce gli errori di audit già risolti e applica il cambiamento al contenuto reale soltanto dopo la tua approvazione esplicita.</p>
        </div>
      </div>

      <div className="wp-live-remediation-actions">
        <button data-seogrow-live="1" type="button" className="primary" disabled={running || applying} onClick={() => prepare(true)}>
          <Eye />{running ? "Preparazione…" : "Prepara anteprima di tutte le correzioni"}
        </button>
        <button data-seogrow-live="1" type="button" className="secondary" disabled={running || applying} onClick={() => prepare(false)}>
          <Wrench />Prepara solo questo problema
        </button>
        <button data-seogrow-live="1" type="button" className="danger" disabled={!previews.length || running || applying} onClick={apply}>
          <ShieldCheck />{applying ? "Applicazione live…" : `Approva e applica al sito live (${previews.length})`}
        </button>
      </div>

      {results.length > 0 && (
        <div className="wp-live-preview-list">
          {results.map((item, index) => (
            <article key={`${item.issue?.label || "issue"}-${index}`} className={`wp-live-preview-row ${item.status}`}>
              <div className="wp-live-preview-title">
                {item.status === "applied" || item.status === "resolved" ? <CheckCircle2 /> : <AlertTriangle />}
                <div>
                  <strong>{item.issue?.label || "Problema SEO"}</strong>
                  <small>
                    {item.status === "preview"
                      ? `${item.data.adapter} · anteprima pronta`
                      : item.status === "applied"
                        ? `${item.data.apply?.adapter || item.plan?.adapter} · applicato live`
                        : item.status === "resolved"
                          ? `Già risolto · ${item.reason}`
                          : item.reason}
                  </small>
                  {item.targetUrl && <small>{item.targetUrl}</small>}
                  {item.status === "preview" && Array.isArray(item.data.changed) && item.data.changed.length > 0 && (
                    <small>Campi interessati: {item.data.changed.join(", ")}</small>
                  )}
                </div>
              </div>
              {item.status === "preview" && (
                <details>
                  <summary>Vedi cosa cambierà</summary>
                  <div className="wp-live-diff">
                    <section><strong>Prima</strong><pre>{previewText(item.data.previewBefore)}</pre></section>
                    <section><strong>Dopo</strong><pre>{previewText(item.data.previewAfter)}</pre></section>
                  </div>
                </details>
              )}
            </article>
          ))}
        </div>
      )}

      {message && <p className="integration-result wp-live-remediation-message">{message}</p>}
    </section>,
    target,
  );
}
