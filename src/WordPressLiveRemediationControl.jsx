import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Eye, ShieldCheck, Wrench } from "lucide-react";
import { apiFetch } from "./api";
import { normalizeAnalysisHistory } from "./platform";
import {
  remediationIndex,
  saveCorrection,
  setLastBatch,
  stableIssueKey,
} from "./remediationStore";
import {
  assessCoreOwnership,
  chooseElementorContentCandidate,
  countTextWords,
  inspectEditableElementor,
  serializeElementor,
} from "./wordpressOwnership";
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
  if (!requested) return list[0] || null;
  if (Number(requested.clientId) !== Number(clientId)) return null;
  if (!["page", "site"].includes(requested.auditType)) return null;
  if (!requested.analyzedAt) return null;
  const matches = list.filter((entry) =>
    entry.type === requested.auditType &&
    String(auditTimestamp(entry)) === String(requested.analyzedAt),
  );
  return matches.length === 1 ? matches[0] : null;
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
  const matches = (candidatesByKind[kind] || []).filter(([key]) => has(key));
  if (matches.length > 1) {
    throw ownershipUndetermined(
      kind,
      `Sono esposti contemporaneamente ${matches.map(([, adapter]) => adapter).join(" e ")}; SeoGrow non sceglie un plugin SEO per priorità arbitraria.`,
    );
  }
  return matches[0] || null;
};

const pageContext = (entity, targetUrl, contentOverride, remediationMeasurement) => ({
  title: entity?.title?.raw || entity?.title?.rendered || "",
  content: contentOverride ?? entity?.content?.raw ?? entity?.content?.rendered ?? "",
  excerpt: entity?.excerpt?.raw || entity?.excerpt?.rendered || "",
  url: targetUrl,
  ...(remediationMeasurement ? { remediationMeasurement } : {}),
});

const ownershipUndetermined = (kind, detail) => {
  const error = new Error(
    `Ownership frontend non determinabile per "${kind}". ${detail} Nessuna modifica è stata autorizzata.`,
  );
  error.code = "OWNERSHIP_UNDETERMINED";
  return error;
};

const preparationFailure = (error) => {
  const message = error instanceof Error ? error.message : "Preparazione correzione non riuscita.";
  const code = String(error?.code || "");
  if (code === "OWNERSHIP_UNDETERMINED" || /ownership/i.test(message)) return { status: "ownership_error", category: "ownership", reason: message };
  if (/401|403|credenzial|autentic|password|unauthorized|forbidden/i.test(message)) return { status: "auth_error", category: "authentication", reason: message };
  if (/timeout|timed out|tempo.*scad/i.test(message)) return { status: "timeout_error", category: "timeout", reason: message };
  if (/openai|generaz|modello|ai\b/i.test(message)) return { status: "generation_error", category: "generation", reason: message };
  if (/adapter|non dispone|non espongono/i.test(message)) return { status: "adapter_error", category: "adapter", reason: message };
  return { status: "error", category: "runtime", reason: message };
};

const contentMeasurement = (frontend, fieldContent) => {
  const frontendWords = Number(frontend?.words);
  const minimumWords = Number(frontend?.minimumWords);
  const fieldWords = countTextWords(fieldContent);
  if (
    !Number.isSafeInteger(frontendWords) || frontendWords < 0 ||
    !Number.isSafeInteger(minimumWords) || minimumWords < 0 ||
    !Number.isSafeInteger(fieldWords) || fieldWords < 0 ||
    fieldWords > frontendWords
  ) {
    throw ownershipUndetermined(
      "content",
      "Il conteggio corrente di frontend e campo modificabile non è coerente; il target non può essere calcolato in sicurezza.",
    );
  }
  return {
    frontendWords,
    fieldWords,
    minimumWords,
    marginWords: minimumWords >= 180 ? 30 : 20,
  };
};

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
  if (!response.ok) {
    const error = new Error(data.error || "Ispezione WordPress non riuscita.");
    error.code = response.status === 401 || response.status === 403 ? "AUTH" : "INSPECT";
    throw error;
  }
  return data;
}

async function verifyFrontend(targetUrl, expected) {
  const response = await apiFetch("/api/wordpress/verify-frontend", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: targetUrl, expected }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Controllo ownership frontend non riuscito.");
  return data;
}

async function verifyCoreOwnership(kind, targetUrl, inspected) {
  if (!["title", "content", "h1"].includes(kind)) return { ok: true, frontend: null };
  const entity = inspected.entity || {};
  const expected = kind === "title"
    ? { title: entity.title?.raw || entity.title?.rendered || "" }
    : { content: entity.content?.raw || entity.content?.rendered || "" };
  const frontend = await verifyFrontend(targetUrl, expected);
  return assessCoreOwnership(kind, entity, frontend);
}

const alreadyResolvedReason = (kind, issue, ownership) => {
  const frontend = ownership?.frontend;
  if (!frontend) return "";
  if (kind === "h1") {
    const label = String(issue?.label || "");
    const claimedMissing = /\b0\s*H1\b/i.test(label);
    const claimedMultiple = /\b(?:[2-9]|[1-9]\d+)\s*H1\b/i.test(label);
    if ((claimedMissing || claimedMultiple) && Number(frontend.h1) === 1) {
      return "Il problema H1 dell’audit non è più presente nel frontend corrente. Esegui un nuovo audit per aggiornare il report prima di considerarlo chiuso.";
    }
  }
  if (kind === "content" && /brev|parole|word/.test(issueText(issue))) {
    const words = Number(frontend.words);
    const minimumWords = Number(frontend.minimumWords);
    if (Number.isFinite(words) && Number.isFinite(minimumWords) && minimumWords > 0 && words >= minimumWords) {
      return `Il problema di contenuto breve non è più presente nel frontend corrente (${words} parole, soglia ${minimumWords}). Esegui un nuovo audit per aggiornare il report.`;
    }
  }
  return "";
};

async function generateCorePatch(kind, issue, entity, targetUrl, contentOverride, remediationMeasurement) {
  const response = await apiFetch("/api/wordpress/generate-patch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      topic: `Remediation WordPress ${kind}`,
      context: JSON.stringify({
        issue,
        page: pageContext(entity, targetUrl, contentOverride, remediationMeasurement),
      }),
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

async function chooseVerifiedElementorContentWidget(targetUrl, state) {
  if (state.widgets.length > 8) {
    throw ownershipUndetermined(
      "content",
      "La pagina contiene più di 8 text-editor Elementor candidati; il widget responsabile non può essere scelto in sicurezza.",
    );
  }
  const probes = await Promise.all(
    state.widgets.map((widget) => verifyFrontend(targetUrl, { content: widget.value })),
  );
  const selected = chooseElementorContentCandidate(state.widgets, probes);
  if (!selected.candidate) throw ownershipUndetermined("content", selected.reason);
  return selected.candidate;
}

async function elementorPlan(kind, issue, entity, targetUrl, state, frontend) {
  if (!state?.parsed || !state.widgets.length) return null;
  if (kind === "h1") {
    const headings = state.widgets.map((candidate) => candidate.item);
    const h1 = headings.filter((item) => String(item.settings?.header_size || "h2").toLowerCase() === "h1");
    const label = String(issue?.label || "");
    const frontendH1 = Number(frontend?.h1);
    const missing = /\b0\s*H1\b/i.test(label);
    const multiple = /\b(?:[2-9]|[1-9]\d+)\s*H1\b/i.test(label);
    if (missing || h1.length === 0) {
      if (frontendH1 !== 0) {
        throw ownershipUndetermined("h1", `Elementor non contiene H1 modificabili ma il frontend ne espone ${Number.isFinite(frontendH1) ? frontendH1 : "un numero non verificabile"}.`);
      }
      headings[0].settings.header_size = "h1";
    } else if (multiple || h1.length > 1) {
      if (h1.length <= 1 || frontendH1 !== h1.length) {
        throw ownershipUndetermined("h1", "Gli H1 pubblici non coincidono con gli H1 Elementor modificabili; potrebbe intervenire un template o un altro layer.");
      }
      h1.slice(1).forEach((item) => { item.settings.header_size = "h2"; });
    } else {
      return null;
    }
    return { adapter: "Elementor", changes: { meta: { _elementor_data: serializeElementor(state.parsed) } } };
  }
  if (kind === "content") {
    const selected = await chooseVerifiedElementorContentWidget(targetUrl, state);
    const previous = selected.item.settings.editor;
    const measurement = contentMeasurement(frontend, previous);
    const patch = await generateCorePatch("content", issue, entity, targetUrl, previous, measurement);
    if (typeof patch?.content !== "string" || !patch.content.trim() || patch.content === previous) return null;
    selected.item.settings.editor = patch.content;
    return { adapter: "Elementor", changes: { meta: { _elementor_data: serializeElementor(state.parsed) } } };
  }
  return null;
}

async function buildPlan(kind, issue, inspected, targetUrl) {
  const entity = inspected.entity || {};
  if (["content", "h1"].includes(kind)) {
    const ownership = await verifyCoreOwnership(kind, targetUrl, inspected);
    const resolvedReason = alreadyResolvedReason(kind, issue, ownership);
    if (resolvedReason) return { alreadyResolved: true, reason: resolvedReason };
    const elementorState = inspectEditableElementor(kind, entity);
    if (elementorState.state === "invalid") throw ownershipUndetermined(kind, "_elementor_data è presente ma non è strutturato in modo valido e sicuro.");
    if (elementorState.state === "valid" && elementorState.widgets.length > 0) {
      const elementor = await elementorPlan(kind, issue, entity, targetUrl, elementorState, ownership.frontend);
      if (elementor) return elementor;
      throw ownershipUndetermined(kind, "Sono presenti widget Elementor pertinenti, ma non è stato possibile preparare una modifica utile senza ambiguità. Il fallback su post_content è bloccato.");
    }
    if (elementorState.state === "valid" && elementorState.hasDocument) {
      throw ownershipUndetermined(kind, "La pagina contiene un documento Elementor non vuoto ma nessun widget statico pertinente modificabile con certezza. Il fallback su post_content è bloccato.");
    }
    if (ownership.ok) {
      const coreContent = entity?.content?.raw || entity?.content?.rendered || "";
      return {
        adapter: "WordPress core",
        changes: await generateCorePatch(kind, issue, entity, targetUrl, undefined, kind === "content" ? contentMeasurement(ownership.frontend, coreContent) : undefined),
      };
    }
    const detail = elementorState.state === "valid"
      ? "Elementor è presente ma non contiene widget pertinenti modificabili; inoltre la verifica non dimostra ownership WordPress core."
      : "La verifica frontend non dimostra che post_content sia la sorgente principale della pagina.";
    throw ownershipUndetermined(kind, detail);
  }
  if (kind === "title") {
    const ownership = await verifyCoreOwnership(kind, targetUrl, inspected);
    const resolvedReason = alreadyResolvedReason(kind, issue, ownership);
    if (resolvedReason) return { alreadyResolved: true, reason: resolvedReason };
    if (ownership.ok) return { adapter: "WordPress core", changes: await generateCorePatch(kind, issue, entity, targetUrl) };
    const plugin = metaKey(entity, "title");
    if (!plugin) throw new Error("Il title SEO è gestito dal frontend ma Rank Math/Yoast non espongono un campo REST scrivibile per questa pagina.");
    const value = await generateSeoValue("seo_title", issue, entity, targetUrl);
    return { adapter: plugin[1], changes: { meta: { [plugin[0]]: value } } };
  }
  if (kind === "excerpt") return { adapter: "WordPress core", changes: await generateCorePatch("excerpt", issue, entity, targetUrl) };
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

const localPreview = (entity, changes) => {
  const before = {};
  const after = {};
  for (const key of ["title", "content", "excerpt"]) {
    if (changes?.[key] === undefined) continue;
    before[key] = entity?.[key]?.raw ?? entity?.[key]?.rendered ?? "";
    after[key] = changes[key];
  }
  if (changes?.meta) {
    before.meta = {};
    after.meta = {};
    for (const [key, value] of Object.entries(changes.meta)) {
      before.meta[key] = entity?.meta?.[key] ?? "";
      after.meta[key] = value;
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
    return () => { window.clearTimeout(timer); observer.disconnect(); };
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
    const verifiedKeys = new Set(
      remediationIndex()
        .filter((record) => Number(record.clientId) === Number(clientId) && record.status === "Verificato")
        .map((record) => record.issueKey || stableIssueKey(record)),
    );
    const activeIssues = issues.filter((issue) => !verifiedKeys.has(stableIssueKey({
      issue,
      issueType: issue?.type || "audit",
      issueLabel: issue?.label || "",
      sourceUrl: issueUrl(issue, audit?.item, client),
    })));
    return { clientId, client, audit, issues, activeIssues };
  };

  const prepare = async (all) => {
    const credentials = readCredentials();
    if (!credentials.url || !credentials.username || !credentials.applicationPassword) {
      setMessage("Connetti WordPress inserendo URL, utente e password applicativa prima di preparare le correzioni.");
      return;
    }
    const context = currentContext();
    if (!context.client || !context.audit || !context.issues.length) {
      setMessage("L'audit richiesto non è disponibile o non corrisponde più al cliente corrente. Riapri l'audit prima di preparare le correzioni.");
      return;
    }
    const domIndex = Number(document.querySelector(".audit-issue-select select")?.value || 0);
    const requestedIndex = requestedAudit && Number(requestedAudit.clientId) === Number(context.clientId)
      ? Number(requestedAudit.issueIndex || 0)
      : domIndex;
    const selected = all
      ? context.activeIssues
      : [context.issues[requestedIndex]].filter((issue) => issue && context.activeIssues.includes(issue));
    if (!selected.length) {
      setResults([]);
      setMessage("Nessun problema attivo da preparare: gli elementi dell'audit risultano già verificati o non sono più selezionabili.");
      return;
    }
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
        const contextSnapshot = {
          clientId: context.clientId,
          clientName: context.client?.name || "",
          auditType: context.audit.type,
          analyzedAt: auditTimestamp(context.audit),
        };
        if (plan.alreadyResolved) {
          next.push({ status: "resolved", issue: currentIssue, targetUrl, reason: plan.reason, contextSnapshot });
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
        next.push({ status: "preview", issue: currentIssue, targetUrl, plan, data, contextSnapshot });
      } catch (error) {
        next.push({ ...preparationFailure(error), issue: currentIssue });
      }
      setResults([...next]);
    }
    const ready = next.filter((item) => item.status === "preview").length;
    const resolved = next.filter((item) => item.status === "resolved").length;
    const skipped = next.length - ready - resolved;
    setMessage(
      ready > 0
        ? `Anteprima pronta: ${ready} modifiche applicabili, ${resolved} problemi già risolti nel frontend corrente, ${skipped} bloccati con causa specifica. Nessuna modifica live è stata ancora eseguita.`
        : `Nessuna modifica da applicare: ${resolved} problemi risultano già risolti nel frontend corrente, ${skipped} sono stati bloccati con causa specifica.`,
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
    const liveContext = currentContext();
    const stale = previews.some((item) =>
      Number(item.contextSnapshot?.clientId) !== Number(liveContext.clientId) ||
      item.contextSnapshot?.auditType !== liveContext.audit?.type ||
      String(item.contextSnapshot?.analyzedAt || "") !== String(auditTimestamp(liveContext.audit) || ""),
    );
    if (stale) {
      setMessage("Cliente o audit sono cambiati dopo la preparazione. Le anteprime sono stale e sono state invalidate: preparale di nuovo prima di applicare.");
      setResults((current) => current.map((item) => item.status === "preview" ? { ...item, status: "stale", reason: "Audit o cliente cambiati dopo la preview." } : item));
      return;
    }
    if (!window.confirm(`Applicare ORA ${previews.length} modifiche al sito WordPress live? SeoGrow userà esattamente i payload completi mostrati nelle anteprime.`)) return;

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
        const snapshot = item.contextSnapshot || {};
        const record = {
          id: `correction-${crypto.randomUUID()}`,
          batchId,
          clientId: snapshot.clientId,
          clientName: snapshot.clientName || "",
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
          auditType: snapshot.auditType,
          auditAnalyzedAt: snapshot.analyzedAt,
          verificationNote: `Modifica live approvata e applicata tramite ${data.adapter || item.plan.adapter}. Esegui la riverifica SeoGrow; per duplicati serve un nuovo crawl completo.`,
        };
        await saveCorrection(record);
        window.dispatchEvent(new CustomEvent("seogrow-remediation-applied", { detail: { id: record.id, batchId } }));
        updated[index] = { ...item, status: "applied", data: { ...item.data, apply: data } };
      } catch (error) {
        updated[index] = { ...item, status: "error", reason: error instanceof Error ? error.message : "Applicazione live non riuscita." };
      }
      setResults([...updated]);
    }
    const applied = updated.filter((item) => item.status === "applied").length;
    const errors = updated.filter((item) => item.status === "error").length;
    setMessage(`Applicazione live completata: ${applied} modifiche scritte in WordPress, ${errors} errori. Le modifiche applicate sono registrate in Correzioni e restano Da verificare finché il nuovo audit non le conferma.`);
    sessionStorage.removeItem("seogrow-remediation-active-batch-v1");
    setApplying(false);
  };

  return createPortal(
    <section className="wp-live-remediation panel" aria-label="Remediation WordPress live con approvazione">
      <div className="wp-live-remediation-head">
        <div>
          <span><ShieldCheck /> Modalità live controllata</span>
          <h3>Anteprima → approvazione → applicazione → riverifica</h3>
          <p>SeoGrow prepara la modifica sul campo che alimenta davvero il frontend, esclude i problemi già verificati e applica il cambiamento soltanto dopo approvazione esplicita.</p>
        </div>
      </div>
      <div className="wp-live-remediation-actions">
        <button data-seogrow-live="1" type="button" className="primary" disabled={running || applying} onClick={() => prepare(true)}>
          <Eye />{running ? "Preparazione…" : "Prepara anteprima di tutte le correzioni attive"}
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
                          : `${item.category ? `${item.category}: ` : ""}${item.reason || item.status}`}
                  </small>
                  {item.targetUrl && <small>{item.targetUrl}</small>}
                  {item.status === "preview" && Array.isArray(item.data.changed) && item.data.changed.length > 0 && (
                    <small>Campi interessati: {item.data.changed.join(", ")}</small>
                  )}
                </div>
              </div>
              {item.status === "preview" && (
                <details>
                  <summary>Vedi payload completo che verrà approvato</summary>
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
