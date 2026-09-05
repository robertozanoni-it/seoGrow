import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Eye, ShieldCheck, Wrench } from "lucide-react";
import { apiFetch } from "./api";
import { normalizeAnalysisHistory } from "./platform";
import { listCorrections, saveCorrection, setLastBatch, stableIssueKey } from "./remediationStore";
import {
  assertNoPreviewConflicts,
  detectPreviewConflicts,
  previewIdentity,
  remediationContextDecision,
} from "./remediationPlanSafety";
import { normalizeClientId } from "./reliabilityModel";
import {
  assessCoreOwnership,
  chooseElementorContentCandidate,
  countTextWords,
  inspectEditableElementor,
  serializeElementor,
} from "./wordpressOwnership";
import "./WordPressLiveRemediationControl.css";
import "./WordPressLiveRemediationControlV2.css";

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
  if (normalizeClientId(requested.clientId) !== normalizeClientId(clientId)) return null;
  if (!["page", "site"].includes(requested.auditType) || !requested.analyzedAt) return null;
  const matches = list.filter((entry) => entry.type === requested.auditType && String(auditTimestamp(entry)) === String(requested.analyzedAt));
  return matches.length === 1 ? matches[0] : null;
};

const issueUrl = (issue, audit, client) => issue?.targetUrl || issue?.url || audit?.url || client?.url || "";
const issueText = (issue) => `${issue?.type || ""} ${issue?.label || ""} ${issue?.detail || ""}`.toLowerCase();
const classifyIssue = (issue) => {
  const text = issueText(issue);
  if (/meta description/.test(text)) return "meta_description";
  if (/canonical/.test(text)) return "canonical";
  if (/noindex|indexability/.test(text)) return "noindex";
  if (/h1/.test(text)) return "h1";
  if (/excerpt|estratto/.test(text)) return "excerpt";
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
  } catch { return true; }
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
const ownershipUndetermined = (kind, detail) => {
  const error = new Error(`Ownership frontend non determinabile per "${kind}". ${detail} Nessuna modifica è stata autorizzata.`);
  error.code = "OWNERSHIP_UNDETERMINED";
  return error;
};

const elementorOwnershipDetail = (entity) => {
  const ownership = entity?._seogrowOwnership && typeof entity._seogrowOwnership === "object"
    ? entity._seogrowOwnership
    : {};
  const resolved = Array.isArray(ownership.elementorResolvedExternalDocuments)
    ? ownership.elementorResolvedExternalDocuments.filter((item) => item?.resolved === true)
    : [];
  const rendered = Array.isArray(ownership.elementorExternalRenderedDocuments)
    ? ownership.elementorExternalRenderedDocuments
    : [];
  const sources = resolved.length ? resolved : rendered;
  if (sources.length) {
    const labels = sources.slice(0, 6).map((item) => {
      const type = String(item?.type || "documento");
      const id = Number(item?.id);
      const title = String(item?.title || "").trim();
      return `${type}${Number.isSafeInteger(id) ? ` #${id}` : ""}${title ? ` “${title}”` : ""}`;
    });
    return `Il frontend della URL usa anche documenti Elementor condivisi: ${labels.join(", ")}. SeoGrow ha identificato l'ownership esterna ma non modifica automaticamente un template condiviso senza analizzarne l'impatto sulle altre pagine.`;
  }
  if (ownership.elementorEvidenceStatus === "shared-templates-present-unresolved") {
    const types = Array.isArray(ownership.elementorSharedTemplateTypes) ? ownership.elementorSharedTemplateTypes : [];
    return `Nel sito risultano template Elementor condivisi${types.length ? ` (${types.join(", ")})` : ""}, ma il documento sorgente applicato a questa URL non è stato identificato con certezza.`;
  }
  return "La pagina contiene ownership Elementor locale o condivisa che non può essere attribuita con certezza a un singolo widget modificabile.";
};

const metaKey = (entity, kind) => {
  const meta = pluginMeta(entity);
  const has = (key) => Object.prototype.hasOwnProperty.call(meta, key);
  const choices = {
    title: [["rank_math_title", "Rank Math"], ["_yoast_wpseo_title", "Yoast"]],
    meta_description: [["rank_math_description", "Rank Math"], ["_yoast_wpseo_metadesc", "Yoast"]],
    canonical: [["rank_math_canonical_url", "Rank Math"], ["_yoast_wpseo_canonical", "Yoast"]],
    noindex: [["rank_math_robots", "Rank Math"], ["_yoast_wpseo_meta-robots-noindex", "Yoast"]],
  };
  const matches = (choices[kind] || []).filter(([key]) => has(key));
  if (matches.length > 1) throw ownershipUndetermined(kind, `Sono esposti contemporaneamente ${matches.map(([, adapter]) => adapter).join(" e ")}; SeoGrow non sceglie un plugin SEO per priorità arbitraria.`);
  return matches[0] || null;
};

const pageContext = (entity, targetUrl, contentOverride, remediationMeasurement) => ({
  title: entity?.title?.raw || entity?.title?.rendered || "",
  content: contentOverride ?? entity?.content?.raw ?? entity?.content?.rendered ?? "",
  excerpt: entity?.excerpt?.raw || entity?.excerpt?.rendered || "",
  url: targetUrl,
  ...(remediationMeasurement ? { remediationMeasurement } : {}),
});

const preparationFailure = (error) => {
  const message = error instanceof Error ? error.message : "Preparazione correzione non riuscita.";
  const code = String(error?.code || "");
  if (/EDITORIAL_REVIEW_REQUIRED/.test(code)) return { status: "quality_error", category: "quality", reason: message };
  if (/CANONICAL_|INDEX_INTENT/.test(code)) return { status: "context_error", category: "context", reason: message };
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
  if (![frontendWords, minimumWords, fieldWords].every((value) => Number.isSafeInteger(value) && value >= 0) || fieldWords > frontendWords) {
    throw ownershipUndetermined("content", "Il conteggio corrente di frontend e campo modificabile non è coerente; il target non può essere calcolato in sicurezza.");
  }
  return { frontendWords, fieldWords, minimumWords, marginWords: minimumWords >= 180 ? 30 : 20 };
};

async function inspectWordPress(targetUrl, credentials) {
  if (isNonEditableWordPressUrl(targetUrl)) {
    const error = new Error("Archivio/tassonomia/paginazione WordPress: questa URL non è una pagina o un articolo modificabile via REST.");
    error.code = "NON_EDITABLE_ARCHIVE";
    throw error;
  }
  const response = await apiFetch("/api/wordpress/inspect-fast", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      siteUrl: credentials.url,
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

async function inspectFrontend(targetUrl) {
  const response = await apiFetch("/api/frontend/inspect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: targetUrl }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Ispezione frontend non riuscita.");
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
    if ((/\b0\s*H1\b/i.test(label) || /\b(?:[2-9]|[1-9]\d+)\s*H1\b/i.test(label)) && Number(frontend.h1) === 1)
      return "Il problema H1 dell’audit non è più presente nel frontend corrente. Esegui un nuovo audit per aggiornare il report.";
  }
  if (kind === "content" && /brev|parole|word/.test(issueText(issue))) {
    const words = Number(frontend.words);
    const minimumWords = Number(frontend.minimumWords);
    if (Number.isFinite(words) && Number.isFinite(minimumWords) && minimumWords > 0 && words >= minimumWords)
      return `Il contenuto breve non è più presente nel frontend corrente (${words} parole, soglia ${minimumWords}). Esegui un nuovo audit per confermare.`;
  }
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
  if (!response.ok || !data.content) {
    const error = new Error(data.error || "Generazione patch non riuscita.");
    error.code = data.code || "GENERATION_FAILED";
    throw error;
  }
  const parsed = data.changes ? { changes: data.changes } : JSON.parse(String(data.content));
  if (!parsed?.changes || typeof parsed.changes !== "object") throw new Error("La patch WordPress è vuota.");
  return { changes: parsed.changes, quality: data.quality || null };
}

async function generateSeoValue(kind, issue, entity, targetUrl) {
  const response = await apiFetch("/api/wordpress/generate-seo-value-v2", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, issue, page: pageContext(entity, targetUrl) }),
  });
  const data = await response.json();
  if (!response.ok || !data.value || data.publishable !== true) {
    const error = new Error(data.error || "La proposta SEO richiede revisione editoriale e non può essere approvata automaticamente.");
    error.code = data.code || "EDITORIAL_REVIEW_REQUIRED";
    error.quality = data.quality || null;
    throw error;
  }
  return { value: String(data.value).trim(), quality: data.quality || null };
}

async function chooseVerifiedElementorContentWidget(targetUrl, state) {
  if (state.widgets.length > 8) throw ownershipUndetermined("content", "La pagina contiene più di 8 text-editor Elementor candidati; serve selezione assistita prima di modificare.");
  const probes = await Promise.all(state.widgets.map((widget) => verifyFrontend(targetUrl, { content: widget.value })));
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
      if (frontendH1 !== 0 || !headings.length) throw ownershipUndetermined("h1", `Gli H1 Elementor modificabili non coincidono con il frontend (${Number.isFinite(frontendH1) ? frontendH1 : "non verificabile"}).`);
      headings[0].settings.header_size = "h1";
    } else if (multiple || h1.length > 1) {
      if (h1.length <= 1 || frontendH1 !== h1.length) throw ownershipUndetermined("h1", "Gli H1 pubblici non coincidono con gli H1 Elementor modificabili; potrebbe intervenire un template condiviso.");
      h1.slice(1).forEach((item) => { item.settings.header_size = "h2"; });
    } else return null;
    return { adapter: "Elementor", changes: { meta: { _elementor_data: serializeElementor(state.parsed) } }, quality: null };
  }
  if (kind === "content") {
    const selected = await chooseVerifiedElementorContentWidget(targetUrl, state);
    const previous = selected.item.settings.editor;
    const measurement = contentMeasurement(frontend, previous);
    const generated = await generateCorePatch("content", issue, entity, targetUrl, previous, measurement);
    if (typeof generated.changes?.content !== "string" || !generated.changes.content.trim() || generated.changes.content === previous) return null;
    selected.item.settings.editor = generated.changes.content;
    return { adapter: "Elementor", changes: { meta: { _elementor_data: serializeElementor(state.parsed) } }, quality: generated.quality };
  }
  return null;
}

async function buildPlan(kind, issue, inspected, targetUrl, frontendContext) {
  const entity = inspected.entity || {};
  const contextDecision = remediationContextDecision(issue, frontendContext || {}, targetUrl);
  if (!contextDecision.allowed) {
    const error = new Error(contextDecision.reason);
    error.code = contextDecision.code;
    throw error;
  }

  if (["content", "h1"].includes(kind)) {
    const ownership = await verifyCoreOwnership(kind, targetUrl, inspected);
    const resolvedReason = alreadyResolvedReason(kind, issue, ownership);
    if (resolvedReason) return { alreadyResolved: true, reason: resolvedReason };
    const elementorState = inspectEditableElementor(kind, entity);
    if (elementorState.state === "invalid") throw ownershipUndetermined(kind, "_elementor_data è presente ma non è strutturato in modo valido e sicuro.");
    if (elementorState.state === "valid" && elementorState.widgets.length > 0) {
      const elementor = await elementorPlan(kind, issue, entity, targetUrl, elementorState, ownership.frontend);
      if (elementor) return elementor;
      throw ownershipUndetermined(kind, "Sono presenti widget Elementor pertinenti, ma non è stato possibile preparare una modifica senza ambiguità. Il fallback su post_content è bloccato.");
    }
    if (elementorState.state === "valid" && elementorState.hasDocument) {
      throw ownershipUndetermined(kind, `${elementorOwnershipDetail(entity)} Il fallback su post_content è bloccato.`);
    }
    if (ownership.ok) {
      const coreContent = entity?.content?.raw || entity?.content?.rendered || "";
      const generated = await generateCorePatch(kind, issue, entity, targetUrl, undefined, kind === "content" ? contentMeasurement(ownership.frontend, coreContent) : undefined);
      return { adapter: "WordPress core", ...generated };
    }
    throw ownershipUndetermined(kind, "La verifica frontend non dimostra che post_content sia la sorgente principale della pagina.");
  }

  if (kind === "title") {
    const ownership = await verifyCoreOwnership(kind, targetUrl, inspected);
    const resolvedReason = alreadyResolvedReason(kind, issue, ownership);
    if (resolvedReason) return { alreadyResolved: true, reason: resolvedReason };
    if (ownership.ok) {
      const generated = await generateCorePatch(kind, issue, entity, targetUrl);
      return { adapter: "WordPress core", ...generated };
    }
    const plugin = metaKey(entity, "title");
    if (!plugin) throw new Error("Il title SEO è gestito dal frontend ma Rank Math/Yoast non espongono un campo REST scrivibile per questa pagina.");
    const generated = await generateSeoValue("seo_title", issue, entity, targetUrl);
    return { adapter: plugin[1], changes: { meta: { [plugin[0]]: generated.value } }, quality: generated.quality };
  }

  if (kind === "excerpt") {
    const generated = await generateCorePatch("excerpt", issue, entity, targetUrl);
    return { adapter: "WordPress core", ...generated };
  }

  if (kind === "meta_description") {
    const plugin = metaKey(entity, kind);
    if (!plugin) throw new Error("Rank Math/Yoast non espongono la meta description come campo REST scrivibile per questa pagina.");
    const generated = await generateSeoValue("meta_description", issue, entity, targetUrl);
    return { adapter: plugin[1], changes: { meta: { [plugin[0]]: generated.value } }, quality: generated.quality };
  }

  if (kind === "canonical") {
    const plugin = metaKey(entity, kind);
    if (!plugin) throw new Error("Rank Math/Yoast non espongono la canonical come campo REST scrivibile per questa pagina.");
    return { adapter: plugin[1], changes: { meta: { [plugin[0]]: frontendContext?.url || targetUrl } }, quality: null };
  }

  if (kind === "noindex") {
    const plugin = metaKey(entity, kind);
    if (!plugin) throw new Error("Rank Math/Yoast non espongono la direttiva noindex come campo REST scrivibile per questa pagina.");
    const [key, adapter] = plugin;
    const current = pluginMeta(entity)[key];
    const next = key === "_yoast_wpseo_meta-robots-noindex"
      ? "2"
      : Array.isArray(current)
        ? [...new Set(["index", "follow", ...current.filter((item) => !/noindex/i.test(String(item)))])]
        : "index,follow";
    return { adapter, changes: { meta: { [key]: next } }, quality: null };
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
const previewText = (value) => JSON.stringify(value, null, 2) || "(anteprima non disponibile)";

export default function WordPressLiveRemediationControlV2() {
  const [target, setTarget] = useState(() => resolveTarget());
  const [running, setRunning] = useState(false);
  const [applyingId, setApplyingId] = useState("");
  const [results, setResults] = useState([]);
  const [message, setMessage] = useState("");
  const [requestedAudit, setRequestedAudit] = useState(null);

  useEffect(() => {
    if (target) return undefined;
    let frame = 0;
    let attempts = 0;
    const find = () => {
      const next = resolveTarget();
      if (next) { setTarget(next); return; }
      attempts += 1;
      if (attempts < 120) frame = window.requestAnimationFrame(find);
    };
    find();
    return () => window.cancelAnimationFrame(frame);
  }, [target]);

  useEffect(() => {
    const open = (event) => {
      const detail = event?.detail || {};
      setRequestedAudit({
        clientId: normalizeClientId(detail.clientId),
        issueIndex: Number(detail.issueIndex || 0),
        auditType: detail.auditType || "page",
        analyzedAt: detail.analyzedAt || "",
      });
    };
    window.addEventListener("seogrow-remediation-open", open);
    return () => window.removeEventListener("seogrow-remediation-open", open);
  }, []);

  const previews = useMemo(() => results.filter((item) => item.status === "preview"), [results]);
  const conflicts = useMemo(() => detectPreviewConflicts(previews), [previews]);
  if (!target) return null;

  const currentContext = async () => {
    const clients = readJson(CLIENTS_KEY, []);
    const clientId = normalizeClientId(readJson(SELECTED_CLIENT_KEY, null));
    const client = clients.find((item) => normalizeClientId(item?.id) === clientId) || null;
    const audit = client ? selectAudit(clientId, requestedAudit) : null;
    const issues = Array.isArray(audit?.item?.issues) ? audit.item.issues : [];
    const corrections = clientId ? await listCorrections({ clientId }) : [];
    const verifiedKeys = new Set(corrections.filter((record) => record.status === "Verificato").flatMap((record) => [record.issueKey, record.legacyIssueKey].filter(Boolean)));
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
    const context = await currentContext();
    if (!context.client || !context.audit || !context.issues.length) {
      setMessage("Il progetto o l'audit richiesto non è disponibile. Seleziona esplicitamente il progetto e riapri l'audit.");
      return;
    }
    const domIndex = Number(document.querySelector(".audit-issue-select select")?.value || 0);
    const requestedIndex = requestedAudit && normalizeClientId(requestedAudit.clientId) === context.clientId ? Number(requestedAudit.issueIndex || 0) : domIndex;
    const selected = all ? context.activeIssues : [context.issues[requestedIndex]].filter((issue) => issue && context.activeIssues.includes(issue));
    if (!selected.length) {
      setResults([]);
      setMessage("Nessun problema attivo da preparare.");
      return;
    }

    setRunning(true);
    setResults([]);
    const next = [];
    for (let index = 0; index < selected.length; index += 1) {
      const currentIssue = selected[index];
      setMessage(`Esaminati ${index}/${selected.length} · in elaborazione: ${currentIssue?.label || "problema SEO"}…`);
      try {
        const kind = classifyIssue(currentIssue);
        if (!kind) throw new Error("Questo problema non dispone ancora di un adapter WordPress applicabile.");
        const targetUrl = issueUrl(currentIssue, context.audit.item, context.client);
        const [inspected, frontendContext] = await Promise.all([
          inspectWordPress(targetUrl, credentials),
          inspectFrontend(targetUrl),
        ]);
        const plan = await buildPlan(kind, currentIssue, inspected, targetUrl, frontendContext);
        const contextSnapshot = {
          clientId: context.clientId,
          clientName: context.client?.name || "",
          auditType: context.audit.type,
          analyzedAt: auditTimestamp(context.audit),
        };
        const identity = previewIdentity({ issue: currentIssue, inspected, targetUrl, frontend: frontendContext });
        if (plan.alreadyResolved) {
          next.push({ status: "resolved", issue: currentIssue, targetUrl, reason: plan.reason, contextSnapshot, inspected, frontendContext, ...identity });
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
        if (!response.ok) {
          const error = new Error(data.error || "Anteprima WordPress non riuscita.");
          error.code = data.code || "PREVIEW_FAILED";
          throw error;
        }
        next.push({ status: "preview", issue: currentIssue, targetUrl, plan, data, contextSnapshot, inspected, frontendContext, ...identity });
      } catch (error) {
        next.push({ ...preparationFailure(error), issue: currentIssue, quality: error?.quality || null });
      }
      setResults([...next]);
    }

    const ready = next.filter((item) => item.status === "preview").length;
    const resolved = next.filter((item) => item.status === "resolved").length;
    const blocked = next.length - ready - resolved;
    const foundConflicts = detectPreviewConflicts(next);
    setMessage(
      `Esaminati ${next.length}/${selected.length} · pronti ${ready} · già risolti ${resolved} · bloccati ${blocked} · conflitti ${foundConflicts.length}. ${ready > 1 ? "Le anteprime si applicano una alla volta per sicurezza." : "Nessuna modifica live è stata ancora eseguita."}`,
    );
    setRunning(false);
  };

  const applyOne = async (item) => {
    if (!item || item.status !== "preview" || applyingId) return;
    const credentials = readCredentials();
    if (!credentials.username || !credentials.applicationPassword) {
      setMessage("La password applicativa non è disponibile. Reinseriscila prima dell'approvazione.");
      return;
    }
    try {
      assertNoPreviewConflicts(previews);
    } catch (error) {
      setMessage(error.message);
      return;
    }
    const liveContext = await currentContext();
    const stale = normalizeClientId(item.contextSnapshot?.clientId) !== liveContext.clientId ||
      item.contextSnapshot?.auditType !== liveContext.audit?.type ||
      String(item.contextSnapshot?.analyzedAt || "") !== String(auditTimestamp(liveContext.audit) || "");
    if (stale) {
      setResults((current) => current.map((entry) => entry === item ? { ...entry, status: "stale", reason: "Audit o progetto cambiati dopo l'anteprima." } : entry));
      setMessage("Progetto o audit sono cambiati dopo la preparazione. L'anteprima selezionata è stata invalidata.");
      return;
    }
    if (!window.confirm(`Applicare ORA questa singola modifica al sito WordPress live?\n\nProblema: ${item.issue?.label || "SEO"}\nCampo/i: ${(item.data.changed || []).join(", ")}\nRisorsa WordPress: ${item.inspected?.resource || "contenuto"} #${item.inspected?.entity?.id || "?"}\n\nIl payload completo è visibile nell'anteprima.`)) return;

    const batchId = `live-remediation-${Date.now()}`;
    setLastBatch(batchId);
    setApplyingId(item.data.approvalToken);
    setMessage(`Applicazione live: ${item.issue?.label || "problema SEO"}…`);
    try {
      const response = await apiFetch("/api/wordpress/live-apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvalToken: item.data.approvalToken, username: credentials.username, applicationPassword: credentials.applicationPassword }),
      });
      const data = await response.json();
      if (!response.ok) {
        const error = new Error(data.error || "Applicazione live non riuscita.");
        error.code = data.code || "APPLY_FAILED";
        throw error;
      }
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
        siteUrl: credentials.url,
        finalUrl: item.frontendContext?.url || "",
        canonical: item.frontendContext?.canonical || "",
        canonicalConfirmed: Boolean(item.frontendContext?.canonical),
        resource: data.resource,
        entityId: Number(data.id),
        wordpressResource: data.resource,
        wordpressId: Number(data.id),
        resourceIdentity: item.resourceIdentity,
        issueIdentity: item.issueIdentity,
        username: credentials.username,
        fields,
        before: flattenState(data.before, fields),
        after: flattenState(data.after, fields),
        rollbackChanges: data.before,
        editorialQuality: item.plan.quality || null,
        status: "Da verificare",
        appliedAt: new Date().toISOString(),
        frontendConfirmed: false,
        auditType: snapshot.auditType,
        auditAnalyzedAt: snapshot.analyzedAt,
        verificationNote: `Modifica live approvata e applicata tramite ${data.adapter || item.plan.adapter}. Scrittura e risoluzione SEO restano stati distinti.`,
      };
      await saveCorrection(record);
      window.dispatchEvent(new CustomEvent("seogrow-remediation-applied", { detail: { id: record.id, batchId } }));
      setResults((current) => current.map((entry) => entry === item ? { ...entry, status: "applied", data: { ...entry.data, apply: data } } : entry));
      setMessage("Modifica applicata e registrata. Stato: Da verificare. Usa la riverifica specifica e, quando richiesto, un nuovo audit prima di considerare il problema risolto.");
    } catch (error) {
      setResults((current) => current.map((entry) => entry === item ? { ...entry, status: "error", reason: error.message } : entry));
      setMessage(`Applicazione non completata: ${error.message}`);
    } finally {
      setApplyingId("");
    }
  };

  return createPortal(
    <section className="wp-live-remediation panel wp-live-remediation-v2" aria-label="Remediation WordPress live con approvazione selettiva">
      <div className="wp-live-remediation-head">
        <div>
          <span><ShieldCheck /> Modalità live controllata</span>
          <h3>Esamina → prepara → approva una modifica → riverifica</h3>
          <p>SeoGrow separa problema, intervento e verifica. Le anteprime concorrenti sullo stesso campo vengono rilevate e nessun batch multiplo viene scritto live in modo non transazionale.</p>
        </div>
      </div>

      <div className="wp-live-remediation-actions">
        <button data-seogrow-live="1" type="button" className="primary" disabled={running || Boolean(applyingId)} onClick={() => prepare(true)}><Eye />{running ? "Esame in corso…" : "Prepara le anteprime dei problemi attivi"}</button>
        <button data-seogrow-live="1" type="button" className="secondary" disabled={running || Boolean(applyingId)} onClick={() => prepare(false)}><Wrench />Prepara solo questo problema</button>
      </div>

      {conflicts.length > 0 && <div className="wp-live-conflict" role="alert"><AlertTriangle /><div><strong>{conflicts.length} conflitti tra anteprime</strong><p>Due proposte cambiano diversamente lo stesso campo della stessa risorsa. Rigenera o scegli una sola proposta prima di approvare.</p></div></div>}

      {results.length > 0 && <div className="wp-live-preview-list">
        {results.map((item, index) => <article key={`${item.issue?.label || "issue"}-${item.resourceIdentity || index}`} className={`wp-live-preview-row ${item.status}`}>
          <div className="wp-live-preview-title">
            {item.status === "applied" || item.status === "resolved" ? <CheckCircle2 /> : <AlertTriangle />}
            <div>
              <strong>{item.issue?.label || "Problema SEO"}</strong>
              <small>{item.status === "preview" ? `${item.data.adapter} · anteprima tecnica pronta${item.plan.quality ? " · quality gate superato" : ""}` : item.status === "applied" ? `${item.data.apply?.adapter || item.plan?.adapter} · applicato live · da verificare` : item.status === "resolved" ? `Già risolto · ${item.reason}` : `${item.category ? `${item.category}: ` : ""}${item.reason || item.status}`}</small>
              {item.targetUrl && <small>{item.targetUrl}</small>}
              {item.status === "preview" && <small>Risorsa: {item.inspected?.resource} #{item.inspected?.entity?.id} · campi: {(item.data.changed || []).join(", ")}</small>}
            </div>
          </div>
          {item.status === "preview" && <>
            <details><summary>Prima → Dopo · payload completo</summary><div className="wp-live-diff"><section><strong>Prima</strong><pre>{previewText(item.data.previewBefore)}</pre></section><section><strong>Dopo</strong><pre>{previewText(item.data.previewAfter)}</pre></section></div></details>
            <button data-seogrow-live="1" type="button" className="danger wp-live-apply-one" disabled={Boolean(applyingId) || conflicts.length > 0} onClick={() => applyOne(item)}><ShieldCheck />{applyingId === item.data.approvalToken ? "Applicazione…" : "Approva e applica questa modifica"}</button>
          </>}
        </article>)}
      </div>}

      {message && <p className="integration-result wp-live-remediation-message" role="status">{message}</p>}
    </section>,
    target,
  );
}