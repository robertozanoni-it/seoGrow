import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Eye, ShieldCheck, Wrench, XCircle } from "lucide-react";
import { apiFetch } from "./api";
import { normalizeAnalysisHistory } from "./platform";
import { saveCorrection, setLastBatch } from "./remediationStore";
import { completeTaskForIssue } from "./taskResolution";
import { isIssueResolved, issueFamily, issueKey, rememberResolvedIssue, normalizeIssueUrl } from "./issueIdentity";
import {
  assessCoreOwnership,
  chooseElementorContentCandidate,
  chooseElementorH1Plan,
  countTextWords,
  inspectEditableElementor,
  normalizeVisibleText,
  serializeElementor,
} from "./wordpressOwnershipV2";
import "./WordPressLiveRemediationControl.css";
import "./WordPressLiveRemediationV2.css";

const CLIENTS_KEY = "seogrow-clients";
const SELECTED_CLIENT_KEY = "seogrow-selected-client-v1";
const PAGE_HISTORY_KEY = "seogrow-page-audit-history-v2";
const SITE_HISTORY_KEY = "seogrow-analyses-v2";

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};

const resolveTarget = () => typeof document === "undefined" ? null : document.querySelector(".audit-unified-remediation");
const auditTimestamp = (entry) => entry?.item?.analyzedAt || entry?.item?.startedAt || "";

const candidates = (clientId) => {
  const pages = readJson(PAGE_HISTORY_KEY, {})[clientId] || [];
  const sites = normalizeAnalysisHistory(readJson(SITE_HISTORY_KEY, {})[clientId]);
  return [
    ...(Array.isArray(pages) ? pages.map((item) => ({ type: "page", item })) : []),
    ...sites.map((item) => ({ type: "site", item })),
  ].toSorted((a, b) => Date.parse(auditTimestamp(b) || 0) - Date.parse(auditTimestamp(a) || 0));
};

const selectAudit = (clientId, requested) => {
  const list = candidates(clientId);
  if (!requested) return list[0] || null;
  if (Number(requested.clientId) !== Number(clientId)) return null;
  const matches = list.filter((entry) => entry.type === requested.auditType && String(auditTimestamp(entry)) === String(requested.analyzedAt || ""));
  return matches.length === 1 ? matches[0] : null;
};

const issueUrl = (issue, audit, client) => issue?.targetUrl || issue?.url || issue?.sourceUrl || audit?.url || client?.url || "";
const issueText = (issue) => `${issue?.type || ""} ${issue?.label || ""} ${issue?.detail || ""}`.toLowerCase();

const classifyIssue = (issue) => {
  const text = issueText(issue);
  if (/meta description/.test(text)) return "meta_description";
  if (/canonical/.test(text)) return "canonical";
  if (/noindex/.test(text)) return "noindex";
  if (/\bh1\b/.test(text)) return "h1";
  if (/excerpt|estratto/.test(text)) return "excerpt";
  if (/link estern|external link|broken external/.test(text)) return "external_link";
  if (/link intern|internal link|broken internal/.test(text)) return "internal_link";
  if (/contenuto|content|testo|parole|word|brev/.test(text)) return "content";
  if (/title|titolo/.test(text)) return "title";
  return "";
};

const isNonEditableWordPressUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (/\/(?:category|categoria|tag|author|autore|date|feed)(?:\/|$)/i.test(path)) return true;
    if (/\/page\/\d+$/i.test(path) || /\/(?:search)(?:\/|$)/i.test(path)) return true;
    return ["s", "cat", "tag", "paged", "author", "feed"].some((key) => url.searchParams.has(key));
  } catch {
    return true;
  }
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

const pluginCandidates = (entity, kind) => {
  const meta = pluginMeta(entity);
  const candidatesByKind = {
    title: [["rank_math_title", "Rank Math"], ["_yoast_wpseo_title", "Yoast"]],
    meta_description: [["rank_math_description", "Rank Math"], ["_yoast_wpseo_metadesc", "Yoast"]],
    canonical: [["rank_math_canonical_url", "Rank Math"], ["_yoast_wpseo_canonical", "Yoast"]],
    noindex: [["rank_math_robots", "Rank Math"], ["_yoast_wpseo_meta-robots-noindex", "Yoast"]],
  };
  const exposed = (candidatesByKind[kind] || []).filter(([key]) => Object.prototype.hasOwnProperty.call(meta, key));
  if (exposed.length <= 1) return exposed;
  const nonEmpty = exposed.filter(([key]) => Array.isArray(meta[key]) ? meta[key].length : String(meta[key] ?? "").trim());
  return nonEmpty.length === 1 ? nonEmpty : exposed;
};

const selectPluginField = (entity, kind) => {
  const candidates = pluginCandidates(entity, kind);
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) return null;
  const error = new Error(`Più plugin SEO espongono il campo ${kind}. SeoGrow non può dimostrare quale alimenti il frontend e blocca la modifica.`);
  error.code = "SEO_PLUGIN_AMBIGUOUS";
  throw error;
};

const pageContext = (entity, targetUrl, contentOverride, remediationMeasurement) => ({
  title: entity?.title?.raw || entity?.title?.rendered || "",
  content: contentOverride ?? entity?.content?.raw ?? entity?.content?.rendered ?? "",
  excerpt: entity?.excerpt?.raw || entity?.excerpt?.rendered || "",
  url: targetUrl,
  ...(remediationMeasurement ? { remediationMeasurement } : {}),
});

const ownershipUndetermined = (kind, detail) => {
  const error = new Error(`Ownership frontend non determinabile per "${kind}". ${detail} Nessuna modifica è stata autorizzata.`);
  error.code = "OWNERSHIP_UNDETERMINED";
  return error;
};

const contentMeasurement = (frontend, fieldContent) => {
  const frontendWords = Number(frontend?.words);
  const minimumWords = Number(frontend?.minimumWords);
  const fieldWords = countTextWords(fieldContent);
  if (!Number.isSafeInteger(frontendWords) || frontendWords < 0 || !Number.isSafeInteger(minimumWords) || minimumWords < 0 || fieldWords > frontendWords) {
    throw ownershipUndetermined("content", "Il conteggio frontend/campo non è coerente e il target non può essere calcolato in sicurezza.");
  }
  return { frontendWords, fieldWords, minimumWords, marginWords: minimumWords >= 180 ? 30 : 20 };
};

async function inspectWordPress(targetUrl, credentials) {
  if (isNonEditableWordPressUrl(targetUrl)) {
    const error = new Error("Archivio, tassonomia, ricerca o paginazione WordPress: serve un adapter dedicato e non una modifica pagina/post.");
    error.code = "NON_EDITABLE_ARCHIVE";
    throw error;
  }
  const response = await apiFetch("/api/wordpress/inspect-fast", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: targetUrl, username: credentials.username, applicationPassword: credentials.applicationPassword }),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "Ispezione WordPress non riuscita.");
    error.code = data.code || (response.status === 429 ? "RATE_LIMIT" : "INSPECT_FAILED");
    throw error;
  }
  return data;
}

async function verifyFrontend(targetUrl, expected = {}) {
  const response = await apiFetch("/api/wordpress/verify-frontend-v2", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: targetUrl, expected }),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "Controllo frontend non riuscito.");
    error.code = response.status === 429 ? "RATE_LIMIT" : "FRONTEND_VERIFY_FAILED";
    throw error;
  }
  return data;
}

async function verifyCoreOwnership(kind, targetUrl, inspected) {
  const entity = inspected.entity || {};
  const expected = kind === "title"
    ? { title: entity.title?.raw || entity.title?.rendered || "" }
    : { content: entity.content?.raw || entity.content?.rendered || "" };
  const frontend = await verifyFrontend(targetUrl, expected);
  return assessCoreOwnership(kind, entity, frontend);
}

const alreadyResolvedReason = (kind, issue, frontend, targetUrl) => {
  if (!frontend) return "";
  if (kind === "h1" && Number(frontend.h1) === 1) return "Il frontend corrente contiene esattamente un H1.";
  if (kind === "content" && /brev|parole|word/.test(issueText(issue))) {
    const words = Number(frontend.words);
    const minimumWords = Number(frontend.minimumWords);
    if (Number.isFinite(words) && Number.isFinite(minimumWords) && minimumWords > 0 && words >= minimumWords) return `Il frontend contiene ${words} parole (soglia ${minimumWords}).`;
  }
  if (kind === "canonical" && normalizeIssueUrl(frontend.canonical) === normalizeIssueUrl(targetUrl)) return "La canonical pubblica coincide già con la URL target.";
  if (kind === "noindex" && frontend.indexable === true) return "La pagina pubblica risulta già indicizzabile.";
  return "";
};

async function generateCorePatch(kind, issue, entity, targetUrl, contentOverride, remediationMeasurement) {
  const response = await apiFetch("/api/wordpress/generate-patch-v2", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      topic: `Remediation WordPress ${kind}`,
      context: JSON.stringify({ issue, page: pageContext(entity, targetUrl, contentOverride, remediationMeasurement) }),
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "Generazione patch non riuscita.");
    error.code = response.status === 429 ? "RATE_LIMIT" : "GENERATION_FAILED";
    throw error;
  }
  const changes = data.changes || (() => {
    try { return JSON.parse(String(data.content || "{}")).changes; } catch { return null; }
  })();
  if (!changes || typeof changes !== "object" || !Object.keys(changes).length) throw new Error("La patch WordPress è vuota o non valida.");
  return changes;
}

async function generateSeoValue(kind, issue, entity, targetUrl) {
  const response = await apiFetch("/api/wordpress/generate-seo-value-v2", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, issue, page: pageContext(entity, targetUrl) }),
  });
  const data = await response.json();
  if (!response.ok || !data.value) {
    const error = new Error(data.error || "Generazione valore SEO non riuscita.");
    error.code = response.status === 429 ? "RATE_LIMIT" : "GENERATION_FAILED";
    throw error;
  }
  return String(data.value).trim();
}

const h1TextFromContent = (html) => normalizeVisibleText(String(html || "").match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i)?.[1] || "");

async function elementorContentPlan(issue, entity, targetUrl, state, frontend) {
  if (!state?.parsed || !state.widgets.length) return null;
  if (state.widgets.length > 12) throw ownershipUndetermined("content", "La pagina contiene più di 12 text-editor statici candidati.");
  const probes = await Promise.all(state.widgets.map((widget) => verifyFrontend(targetUrl, { content: widget.value })));
  const selected = chooseElementorContentCandidate(state.widgets, probes);
  if (!selected.candidate) throw ownershipUndetermined("content", selected.reason);
  const previous = selected.candidate.item.settings.editor;
  const measurement = contentMeasurement(frontend, previous);
  const patch = await generateCorePatch("content", issue, entity, targetUrl, previous, measurement);
  if (typeof patch.content !== "string" || !patch.content.trim() || patch.content === previous) throw new Error("La generazione non ha prodotto una modifica di contenuto utile.");
  selected.candidate.item.settings.editor = patch.content;
  return {
    adapter: "Elementor",
    changes: { meta: { _elementor_data: serializeElementor(state.parsed) } },
    verification: { family: "short-content", expectedContent: patch.content },
  };
}

async function elementorH1Plan(entity, targetUrl, state, frontend) {
  if (!state?.parsed || !state.widgets.length) return null;
  const decision = chooseElementorH1Plan(state, frontend);
  if (decision.alreadyResolved) return { alreadyResolved: true, reason: "Il frontend corrente contiene esattamente un H1." };
  if (decision.blocked) throw ownershipUndetermined("h1", decision.reason);
  if (!decision.changed) return null;
  return {
    adapter: "Elementor",
    changes: { meta: { _elementor_data: serializeElementor(state.parsed) } },
    verification: { family: "h1", expectedH1: 1, expectedH1Text: decision.expectedH1Text || "" },
  };
}

async function buildPlan(kind, issue, inspected, targetUrl) {
  const entity = inspected.entity || {};

  if (["content", "h1"].includes(kind)) {
    const baseFrontend = await verifyFrontend(targetUrl, {});
    const resolved = alreadyResolvedReason(kind, issue, baseFrontend, targetUrl);
    if (resolved) return { alreadyResolved: true, reason: resolved };
    const state = inspectEditableElementor(kind, entity);
    if (state.state === "invalid") throw ownershipUndetermined(kind, "_elementor_data è presente ma non è strutturato in modo valido.");
    if (state.state === "valid" && state.widgets.length) {
      const plan = kind === "content"
        ? await elementorContentPlan(issue, entity, targetUrl, state, baseFrontend)
        : await elementorH1Plan(entity, targetUrl, state, baseFrontend);
      if (plan) return plan;
      throw ownershipUndetermined(kind, "Widget Elementor pertinenti presenti, ma nessuna modifica non ambigua è disponibile.");
    }
    if (state.state === "valid" && state.hasDocument) throw ownershipUndetermined(kind, "Documento Elementor presente senza widget statici pertinenti: fallback su post_content bloccato.");

    const ownership = await verifyCoreOwnership(kind, targetUrl, inspected);
    if (!ownership.ok) throw ownershipUndetermined(kind, "La verifica frontend non dimostra che post_content controlli il contenuto pubblico.");
    const coreContent = entity?.content?.raw || entity?.content?.rendered || "";
    const changes = await generateCorePatch(kind, issue, entity, targetUrl, undefined, kind === "content" ? contentMeasurement(ownership.frontend, coreContent) : undefined);
    return {
      adapter: "WordPress core",
      changes,
      verification: kind === "content"
        ? { family: "short-content", expectedContent: changes.content || "" }
        : { family: "h1", expectedH1: 1, expectedH1Text: h1TextFromContent(changes.content || ""), expectedContent: changes.content || "" },
    };
  }

  if (kind === "title") {
    const ownership = await verifyCoreOwnership("title", targetUrl, inspected);
    if (ownership.ok) {
      const changes = await generateCorePatch("title", issue, entity, targetUrl);
      return { adapter: "WordPress core", changes, verification: { family: issueFamily(issue), expectedTitle: changes.title || "" } };
    }
    const plugin = selectPluginField(entity, "title");
    if (!plugin) throw ownershipUndetermined("title", "Il title pubblico non coincide con WordPress core e nessun plugin SEO espone un campo REST scrivibile.");
    const value = await generateSeoValue("seo_title", issue, entity, targetUrl);
    return { adapter: plugin[1], changes: { meta: { [plugin[0]]: value } }, verification: { family: issueFamily(issue), expectedTitle: value } };
  }

  if (kind === "excerpt") {
    const changes = await generateCorePatch("excerpt", issue, entity, targetUrl);
    return { adapter: "WordPress core", changes, verification: { family: "excerpt", expectedContent: changes.excerpt || "" } };
  }

  if (kind === "meta_description") {
    const plugin = selectPluginField(entity, kind);
    if (!plugin) throw ownershipUndetermined(kind, "Rank Math/Yoast non espongono una meta description REST scrivibile.");
    const value = await generateSeoValue("meta_description", issue, entity, targetUrl);
    return { adapter: plugin[1], changes: { meta: { [plugin[0]]: value } }, verification: { family: issueFamily(issue), expectedDescription: value } };
  }

  if (kind === "canonical") {
    const frontend = await verifyFrontend(targetUrl, {});
    const resolved = alreadyResolvedReason(kind, issue, frontend, targetUrl);
    if (resolved) return { alreadyResolved: true, reason: resolved };
    const plugin = selectPluginField(entity, kind);
    if (!plugin) throw ownershipUndetermined(kind, "Nessun campo canonical Rank Math/Yoast REST scrivibile.");
    return { adapter: plugin[1], changes: { meta: { [plugin[0]]: targetUrl } }, verification: { family: "canonical", expectedCanonical: targetUrl } };
  }

  if (kind === "noindex") {
    const frontend = await verifyFrontend(targetUrl, {});
    const resolved = alreadyResolvedReason(kind, issue, frontend, targetUrl);
    if (resolved) return { alreadyResolved: true, reason: resolved };
    const plugin = selectPluginField(entity, kind);
    if (!plugin) throw ownershipUndetermined(kind, "Nessun campo robots Rank Math/Yoast REST scrivibile.");
    const [key, adapter] = plugin;
    const current = pluginMeta(entity)[key];
    let next;
    if (key === "_yoast_wpseo_meta-robots-noindex") next = "2";
    else if (Array.isArray(current)) next = [...new Set(["index", "follow", ...current.filter((item) => !/noindex/i.test(String(item)))])];
    else next = "index,follow";
    return { adapter, changes: { meta: { [key]: next } }, verification: { family: "noindex", expectedIndexable: true } };
  }

  if (["external_link", "internal_link"].includes(kind)) {
    const error = new Error("Il link deve essere corretto nella pagina sorgente o nel widget che lo contiene. L'adapter dedicato non è ancora disponibile: nessuna sostituzione automatica viene indovinata.");
    error.code = "LINK_ADAPTER_REQUIRED";
    throw error;
  }

  const error = new Error("Questo problema non dispone ancora di un adapter WordPress applicabile.");
  error.code = "ADAPTER_REQUIRED";
  throw error;
}

const flattenState = (state, fields) => {
  const flat = {};
  for (const field of fields || []) {
    if (field.startsWith("meta.")) flat[field] = state?.meta?.[field.slice(5)] ?? "";
    else flat[field] = state?.[field] ?? "";
  }
  return flat;
};

const exactState = (entity, changes) => {
  const before = {};
  const after = {};
  for (const key of ["title", "content", "excerpt"]) {
    if (changes?.[key] === undefined) continue;
    before[key] = entity?.[key]?.raw ?? entity?.[key]?.rendered ?? "";
    after[key] = changes[key];
  }
  for (const [key, value] of Object.entries(changes?.meta || {})) {
    before[`meta.${key}`] = entity?.meta?.[key] ?? "";
    after[`meta.${key}`] = value;
  }
  return { before, after };
};

const differenceWindow = (beforeValue, afterValue) => {
  const before = String(beforeValue ?? "");
  const after = String(afterValue ?? "");
  if (before === after) return { before, after };
  let index = 0;
  const limit = Math.min(before.length, after.length);
  while (index < limit && before[index] === after[index]) index += 1;
  const start = Math.max(0, index - 220);
  return {
    before: `${start ? "…" : ""}${before.slice(start, index + 650)}${index + 650 < before.length ? "…" : ""}`,
    after: `${start ? "…" : ""}${after.slice(start, index + 650)}${index + 650 < after.length ? "…" : ""}`,
  };
};

const focusedPreview = (state) => {
  const before = {};
  const after = {};
  for (const key of Object.keys(state.after)) {
    const windowed = differenceWindow(state.before[key], state.after[key]);
    before[key] = windowed.before;
    after[key] = windowed.after;
  }
  return { before, after };
};

const errorStatus = (error) => {
  const code = String(error?.code || "");
  if (["OWNERSHIP_UNDETERMINED", "NON_EDITABLE_ARCHIVE", "SEO_PLUGIN_AMBIGUOUS", "LINK_ADAPTER_REQUIRED", "ADAPTER_REQUIRED"].includes(code)) return "blocked";
  return "error";
};

export default function WordPressLiveRemediationControlV2() {
  const [target, setTarget] = useState(() => resolveTarget());
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState([]);
  const [message, setMessage] = useState("");
  const [requestedAudit, setRequestedAudit] = useState(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const sync = () => {
      setTarget((current) => {
        const next = resolveTarget();
        return current === next ? current : next;
      });
      setRevision((value) => value + 1);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("storage", sync);
    return () => { observer.disconnect(); window.removeEventListener("storage", sync); };
  }, []);

  useEffect(() => {
    const open = (event) => {
      const detail = event?.detail || {};
      setRequestedAudit({ clientId: Number(detail.clientId), issueIndex: Number(detail.issueIndex || 0), auditType: detail.auditType || "page", analyzedAt: detail.analyzedAt || "" });
    };
    window.addEventListener("seogrow-remediation-open", open);
    return () => window.removeEventListener("seogrow-remediation-open", open);
  }, []);

  const currentContext = () => {
    const clients = readJson(CLIENTS_KEY, []);
    const clientId = Number(readJson(SELECTED_CLIENT_KEY, clients[0]?.id));
    const client = clients.find((item) => Number(item.id) === clientId) || clients[0];
    const audit = client ? selectAudit(clientId, requestedAudit) : null;
    const allIssues = Array.isArray(audit?.item?.issues) ? audit.item.issues : [];
    const activeIssues = allIssues.map((issue, index) => ({ issue, index, targetUrl: issueUrl(issue, audit?.item, client) }))
      .filter((entry) => !isIssueResolved(clientId, entry.issue, entry.targetUrl));
    return { clientId, client, audit, allIssues, activeIssues };
  };

  const context = useMemo(() => { void revision; return currentContext(); }, [requestedAudit, revision]);
  const previews = useMemo(() => results.filter((item) => item.status === "preview"), [results]);

  if (!target) return null;

  const prepare = async (all) => {
    const credentials = readCredentials();
    if (!credentials.url || !credentials.username || !credentials.applicationPassword) {
      setMessage("Connetti WordPress inserendo la password applicativa prima di preparare le correzioni.");
      return;
    }
    const latest = currentContext();
    if (!latest.client || !latest.audit || !latest.activeIssues.length) {
      setMessage("Nessun problema attivo da preparare per l'audit corrente.");
      return;
    }
    const domIndex = Number(document.querySelector(".audit-issue-select select")?.value ?? latest.activeIssues[0]?.index ?? 0);
    const selectedEntry = latest.activeIssues.find((entry) => entry.index === domIndex) || latest.activeIssues[0];
    const selected = all ? latest.activeIssues : [selectedEntry].filter(Boolean);
    setRunning(true);
    setResults([]);
    const next = [];

    for (let position = 0; position < selected.length; position += 1) {
      const entry = selected[position];
      const currentIssue = entry.issue;
      setMessage(`Preparazione ${position + 1}/${selected.length}: ${currentIssue?.label || "problema SEO"}…`);
      try {
        const kind = classifyIssue(currentIssue);
        if (!kind) {
          const error = new Error("Tipo di problema non riconosciuto dall'adapter WordPress.");
          error.code = "ADAPTER_REQUIRED";
          throw error;
        }
        const inspected = await inspectWordPress(entry.targetUrl, credentials);
        const plan = await buildPlan(kind, currentIssue, inspected, entry.targetUrl);
        const contextSnapshot = {
          clientId: latest.clientId,
          clientName: latest.client?.name || "",
          auditType: latest.audit.type,
          analyzedAt: auditTimestamp(latest.audit),
          issueKey: issueKey(currentIssue, entry.targetUrl),
        };
        if (plan.alreadyResolved) {
          rememberResolvedIssue(latest.clientId, currentIssue, entry.targetUrl, { reason: plan.reason, source: "preflight" });
          completeTaskForIssue(latest.clientId, currentIssue, entry.targetUrl, plan.reason);
          next.push({ status: "resolved", issue: currentIssue, targetUrl: entry.targetUrl, reason: plan.reason, contextSnapshot });
          setResults([...next]);
          continue;
        }

        const exact = exactState(inspected.entity || {}, plan.changes || {});
        const response = await apiFetch("/api/wordpress/live-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            siteUrl: credentials.url,
            targetUrl: entry.targetUrl,
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
        if (!response.ok) {
          const error = new Error(data.error || "Anteprima WordPress non riuscita.");
          error.code = data.code || (response.status === 429 ? "RATE_LIMIT" : "PREVIEW_FAILED");
          throw error;
        }
        next.push({
          status: "preview",
          issue: currentIssue,
          targetUrl: entry.targetUrl,
          plan,
          data,
          contextSnapshot,
          exact,
          focused: focusedPreview(exact),
        });
      } catch (error) {
        next.push({
          status: errorStatus(error),
          issue: currentIssue,
          targetUrl: entry.targetUrl,
          reason: error instanceof Error ? error.message : "Preparazione non riuscita.",
          code: error?.code || "",
        });
      }
      setResults([...next]);
    }

    const ready = next.filter((item) => item.status === "preview").length;
    const resolved = next.filter((item) => item.status === "resolved").length;
    const blocked = next.filter((item) => item.status === "blocked").length;
    const errors = next.filter((item) => item.status === "error").length;
    setMessage(`Preparazione completata: ${ready} applicabili, ${resolved} già risolti, ${blocked} bloccati in sicurezza, ${errors} errori operativi. Nessuna modifica live eseguita.`);
    setRunning(false);
    setRevision((value) => value + 1);
  };

  const rollbackApplied = async (appliedItems, credentials) => {
    const rolledBack = [];
    const failed = [];
    for (const item of [...appliedItems].reverse()) {
      try {
        const response = await apiFetch("/api/wordpress/live-rollback-v2", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            siteUrl: credentials.url,
            targetUrl: item.preview.targetUrl,
            username: credentials.username,
            applicationPassword: credentials.applicationPassword,
            resource: item.apply.resource,
            id: item.apply.id,
            changes: item.apply.before,
            expectedCurrent: item.apply.after,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Rollback compensativo non riuscito.");
        rolledBack.push({ ...item, rollback: data });
      } catch (error) {
        failed.push({ ...item, rollbackError: error instanceof Error ? error.message : "Rollback non riuscito." });
      }
    }
    return { rolledBack, failed };
  };

  const saveAppliedRecord = async (preview, applyData, batchId, status = "Da verificare", extra = {}) => {
    const fields = applyData.changed || [];
    const snapshot = preview.contextSnapshot || {};
    const record = {
      id: `correction-${crypto.randomUUID()}`,
      batchId,
      clientId: snapshot.clientId,
      clientName: snapshot.clientName || "",
      platform: "wordpress",
      liveApproval: true,
      adapter: applyData.adapter || preview.plan.adapter,
      issue: preview.issue,
      issueKey: snapshot.issueKey || issueKey(preview.issue, preview.targetUrl),
      issueLabel: preview.issue?.label || "Problema SEO",
      issueType: preview.issue?.type || "audit",
      severity: preview.issue?.severity || "media",
      sourceUrl: applyData.sourceUrl || preview.targetUrl,
      resource: applyData.resource,
      entityId: Number(applyData.id),
      username: readCredentials().username,
      fields,
      before: flattenState(applyData.before, fields),
      after: flattenState(applyData.after, fields),
      rollbackChanges: applyData.before,
      rollbackExpectedCurrent: applyData.after,
      verification: preview.plan.verification || {},
      status,
      appliedAt: new Date().toISOString(),
      frontendConfirmed: false,
      verificationNote: status === "Ripristinato"
        ? "Batch annullato automaticamente dopo un errore: la modifica è stata ripristinata."
        : `Modifica live approvata e applicata tramite ${applyData.adapter || preview.plan.adapter}. Riverifica necessaria prima di chiudere la Task.`,
      ...extra,
    };
    await saveCorrection(record);
    window.dispatchEvent(new CustomEvent("seogrow-remediation-history", { detail: { id: record.id, batchId } }));
    return record;
  };

  const apply = async () => {
    const credentials = readCredentials();
    if (!previews.length || applying) return;
    if (!credentials.username || !credentials.applicationPassword) {
      setMessage("Reinserisci la password applicativa prima dell'approvazione.");
      return;
    }
    const now = currentContext();
    const stale = previews.some((item) =>
      Number(item.contextSnapshot?.clientId) !== Number(now.clientId) ||
      item.contextSnapshot?.auditType !== now.audit?.type ||
      String(item.contextSnapshot?.analyzedAt || "") !== String(auditTimestamp(now.audit) || ""),
    );
    if (stale) {
      setMessage("Cliente o audit sono cambiati dopo la preparazione. Le anteprime sono scadute: preparale di nuovo.");
      return;
    }

    const labels = previews.slice(0, 6).map((item) => `• ${item.issue?.label || "Problema SEO"}`).join("\n");
    const more = previews.length > 6 ? `\n…e altre ${previews.length - 6}` : "";
    if (!window.confirm(`Applicare ORA ${previews.length} modifiche al sito live come batch controllato?\n\n${labels}${more}\n\nSe una modifica fallisce, SeoGrow tenterà di ripristinare automaticamente quelle già applicate nel batch.`)) return;

    const batchId = `live-remediation-${Date.now()}`;
    setLastBatch(batchId);
    setApplying(true);
    const appliedItems = [];
    const updated = [...results];
    let failure = null;

    for (let index = 0; index < updated.length; index += 1) {
      const item = updated[index];
      if (item.status !== "preview") continue;
      setMessage(`Applicazione live ${appliedItems.length + 1}/${previews.length}: ${item.issue?.label || "problema SEO"}…`);
      try {
        const response = await apiFetch("/api/wordpress/live-apply", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ approvalToken: item.data.approvalToken, username: credentials.username, applicationPassword: credentials.applicationPassword }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Applicazione live non riuscita.");
        appliedItems.push({ preview: item, apply: data, index });
        updated[index] = { ...item, status: "applied", data: { ...item.data, apply: data } };
      } catch (error) {
        failure = { index, item, reason: error instanceof Error ? error.message : "Applicazione live non riuscita." };
        updated[index] = { ...item, status: "error", reason: failure.reason };
        break;
      }
      setResults([...updated]);
    }

    if (failure) {
      const compensation = await rollbackApplied(appliedItems, credentials);
      for (const rolled of compensation.rolledBack) {
        updated[rolled.index] = { ...updated[rolled.index], status: "rolledback", reason: "Ripristinata automaticamente dopo errore del batch." };
        await saveAppliedRecord(rolled.preview, rolled.apply, batchId, "Ripristinato", { rollbackAt: new Date().toISOString(), rollbackNote: "Rollback compensativo automatico completato." });
      }
      for (const failed of compensation.failed) {
        updated[failed.index] = { ...updated[failed.index], status: "rollback-error", reason: failed.rollbackError };
        await saveAppliedRecord(failed.preview, failed.apply, batchId, "Da verificare", { verificationNote: `ERRORE CRITICO: applicazione riuscita ma rollback compensativo fallito: ${failed.rollbackError}` });
      }
      setResults([...updated]);
      setMessage(compensation.failed.length
        ? `Batch interrotto: ${failure.reason}. ${compensation.rolledBack.length} modifiche ripristinate, ${compensation.failed.length} richiedono controllo manuale immediato.`
        : `Batch annullato senza modifiche residue: ${failure.reason}. Le ${compensation.rolledBack.length} modifiche già applicate sono state ripristinate.`);
      setApplying(false);
      setRevision((value) => value + 1);
      return;
    }

    for (const applied of appliedItems) {
      const record = await saveAppliedRecord(applied.preview, applied.apply, batchId);
      window.dispatchEvent(new CustomEvent("seogrow-remediation-applied", { detail: { id: record.id, batchId } }));
    }
    setResults([...updated]);
    setMessage(`Applicazione completata: ${appliedItems.length} modifiche scritte. Ora devono essere riverificate prima di chiudere le Task.`);
    setApplying(false);
    window.dispatchEvent(new CustomEvent("seogrow-remediation-recheck", { detail: { batchId } }));
  };

  const activeCount = context?.activeIssues?.length || 0;

  return createPortal(
    <section className="wp-live-remediation wp-live-remediation-v2 panel" aria-label="Remediation WordPress live con approvazione">
      <div className="wp-live-remediation-head">
        <div>
          <span><ShieldCheck /> Modalità live controllata</span>
          <h3>Anteprima → approvazione → applicazione → riverifica</h3>
          <p>La lista comprende solo i problemi ancora attivi. Nessuna Task viene chiusa per la sola scrittura WordPress.</p>
        </div>
      </div>

      <div className="wp-live-remediation-actions">
        <button data-seogrow-live="1" type="button" className="primary" disabled={running || applying || activeCount === 0} onClick={() => prepare(true)}>
          <Eye />{running ? "Preparazione…" : `Prepara anteprima di tutte le correzioni (${activeCount})`}
        </button>
        <button data-seogrow-live="1" type="button" className="secondary" disabled={running || applying || activeCount === 0} onClick={() => prepare(false)}>
          <Wrench />Prepara solo il problema selezionato
        </button>
        <button data-seogrow-live="1" type="button" className="danger" disabled={!previews.length || running || applying} onClick={apply}>
          <ShieldCheck />{applying ? "Applicazione live…" : `Approva e applica al sito live (${previews.length})`}
        </button>
      </div>

      {results.length > 0 && (
        <div className="wp-live-preview-list">
          {results.map((item, index) => (
            <article key={`${item.contextSnapshot?.issueKey || item.issue?.label || "issue"}-${index}`} className={`wp-live-preview-row ${item.status}`}>
              <div className="wp-live-preview-title">
                {item.status === "resolved" || item.status === "applied" || item.status === "rolledback" ? <CheckCircle2 /> : item.status === "error" || item.status === "rollback-error" ? <XCircle /> : <AlertTriangle />}
                <div>
                  <strong>{item.issue?.label || "Problema SEO"}</strong>
                  <small>
                    {item.status === "preview" ? `${item.plan?.adapter} · anteprima pronta`
                      : item.status === "resolved" ? `Già risolto · ${item.reason}`
                        : item.status === "applied" ? `${item.data?.apply?.adapter || item.plan?.adapter} · applicato live`
                          : item.status === "rolledback" ? "Ripristinato automaticamente"
                            : item.status === "blocked" ? `NON CORRETTO · ${item.reason}`
                              : item.reason}
                  </small>
                  {item.targetUrl && <small>{item.targetUrl}</small>}
                  {item.status === "preview" && Array.isArray(item.data?.changed) && <small>Campi interessati: {item.data.changed.join(", ")}</small>}
                </div>
              </div>
              {item.status === "preview" && (
                <details>
                  <summary>Vedi cosa cambierà</summary>
                  <div className="wp-live-diff">
                    <section><strong>Prima — area modificata</strong><pre>{JSON.stringify(item.focused?.before || {}, null, 2)}</pre></section>
                    <section><strong>Dopo — area modificata</strong><pre>{JSON.stringify(item.focused?.after || {}, null, 2)}</pre></section>
                  </div>
                  <details className="wp-live-full-payload">
                    <summary>Mostra payload completo approvato</summary>
                    <div className="wp-live-diff">
                      <section><strong>Prima completa</strong><pre>{JSON.stringify(item.exact?.before || {}, null, 2)}</pre></section>
                      <section><strong>Dopo completa</strong><pre>{JSON.stringify(item.exact?.after || {}, null, 2)}</pre></section>
                    </div>
                  </details>
                </details>
              )}
            </article>
          ))}
        </div>
      )}

      {message && <p className="integration-result wp-live-remediation-message" role="status">{message}</p>}
    </section>,
    target,
  );
}
