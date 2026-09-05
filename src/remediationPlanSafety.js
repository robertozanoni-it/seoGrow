import { issueIdentity, normalizeHttpUrl, resourceIdentity } from "./reliabilityModel.js";

export const changedFieldKeys = (changes = {}) => [
  ...["title", "content", "excerpt"].filter((key) => Object.prototype.hasOwnProperty.call(changes || {}, key)),
  ...Object.keys(changes?.meta || {}).map((key) => `meta.${key}`),
].toSorted();

const canonicalJsonValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .toSorted()
        .map((key) => [key, canonicalJsonValue(value[key])]),
    );
  }
  return value;
};

const stableJson = (value) => JSON.stringify(canonicalJsonValue(value));

const fieldValue = (changes, field) =>
  field.startsWith("meta.") ? changes?.meta?.[field.slice(5)] : changes?.[field];

export function remediationResource({ inspected = {}, targetUrl = "", frontend = null } = {}) {
  return resourceIdentity({
    siteUrl: inspected?.siteUrl || frontend?.siteUrl || "",
    wordpressResource: inspected?.resource || "",
    wordpressId: inspected?.entity?.id || inspected?.id,
    finalUrl: frontend?.url || "",
    canonical: frontend?.canonical || "",
    canonicalConfirmed: Boolean(frontend?.canonical),
    sourceUrl: targetUrl,
  });
}

export function previewConflictKey(preview) {
  const resource = preview?.resourceIdentity || remediationResource(preview || {});
  return `${resource}`;
}

export function detectPreviewConflicts(previews = []) {
  const byResourceField = new Map();
  const conflicts = [];

  for (const preview of previews.filter((item) => item?.status === "preview")) {
    const resource = previewConflictKey(preview);
    const changes = preview?.plan?.changes || preview?.changes || {};
    for (const field of changedFieldKeys(changes)) {
      const key = `${resource}::${field}`;
      const value = fieldValue(changes, field);
      const previous = byResourceField.get(key);
      if (!previous) {
        byResourceField.set(key, { preview, value });
        continue;
      }
      if (stableJson(previous.value) !== stableJson(value)) {
        conflicts.push({
          key,
          field,
          resource,
          firstIssue: previous.preview?.issue?.label || previous.preview?.issue?.type || "Problema 1",
          secondIssue: preview?.issue?.label || preview?.issue?.type || "Problema 2",
        });
      }
    }
  }

  return conflicts;
}

export function assertNoPreviewConflicts(previews = []) {
  const conflicts = detectPreviewConflicts(previews);
  if (!conflicts.length) return true;
  const error = new Error(
    `Conflitto tra anteprime: ${conflicts.map((item) => `${item.field} su ${item.resource}`).join("; ")}. Le proposte devono essere risolte prima dell'approvazione.`,
  );
  error.code = "PREVIEW_CONFLICT";
  error.conflicts = conflicts;
  throw error;
}

export function remediationContextDecision(issue = {}, frontend = {}, targetUrl = "") {
  const text = `${issue?.type || ""} ${issue?.label || ""} ${issue?.detail || ""}`.toLowerCase();
  const type = String(issue?.type || "").toLowerCase();
  const isCanonical = type.includes("canonical") || /canonical/.test(text);
  const isNoindex = type.includes("indexability") || /noindex/.test(text);

  if (isCanonical) {
    const brokenConfirmed = /\b(?:404|410)\b|canonical.*(?:rotta|broken|irraggiungibile)/i.test(text) || issue?.canonicalBroken === true;
    if (!brokenConfirmed) {
      return {
        allowed: false,
        code: "CANONICAL_CONTEXT_REQUIRED",
        reason: "Canonical differente o assente non equivale automaticamente a errore. Serve confermare URL finale, canonical pubblica, destinazione HTTP, sitemap e intento prima della modifica.",
      };
    }
    const finalUrl = normalizeHttpUrl(frontend?.url || targetUrl, { stripSlash: false });
    const target = normalizeHttpUrl(targetUrl, { stripSlash: false });
    if (!finalUrl || !target || finalUrl !== target) {
      return {
        allowed: false,
        code: "CANONICAL_TARGET_AMBIGUOUS",
        reason: "L'URL finale non coincide con l'URL target. SeoGrow non imposta una self-canonical senza identificare prima la risorsa preferita.",
      };
    }
    return { allowed: true, code: "CANONICAL_BROKEN_CONFIRMED" };
  }

  if (isNoindex) {
    if (issue?.indexIntentConfirmed === true || issue?.intentConfirmed === true) {
      return { allowed: true, code: "INDEX_INTENT_CONFIRMED" };
    }
    return {
      allowed: false,
      code: "INDEX_INTENT_REQUIRED",
      reason: "La direttiva noindex può essere intenzionale. Prima di rimuoverla serve una conferma esplicita dell'intento di indicizzazione.",
    };
  }

  return { allowed: true, code: "NOT_CONTEXT_SENSITIVE" };
}

export function previewIdentity({ issue, inspected, targetUrl, frontend } = {}) {
  const resource = remediationResource({ inspected, targetUrl, frontend });
  const issueKey = issueIdentity({
    issue,
    issueType: issue?.type,
    issueLabel: issue?.label,
    sourceUrl: targetUrl,
    siteUrl: inspected?.siteUrl,
    wordpressResource: inspected?.resource,
    wordpressId: inspected?.entity?.id,
    finalUrl: frontend?.url,
    canonical: frontend?.canonical,
    canonicalConfirmed: Boolean(frontend?.canonical),
  });
  return { resourceIdentity: resource, issueIdentity: issueKey };
}
