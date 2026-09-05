const RESOLVED_EVIDENCE_KEY = "seogrow-remediation-resolved-evidence-v2";
const LEGACY_RESOLVED_EVIDENCE_KEY = "seogrow-remediation-resolved-evidence-v1";

const readJson = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key, value) => {
  const serialized = JSON.stringify(value);
  localStorage.setItem(key, serialized);
  window.dispatchEvent(new StorageEvent("storage", { key, newValue: serialized }));
  window.dispatchEvent(new CustomEvent("seogrow-storage-ok", { detail: { key } }));
};

export const normalizeIssueUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    const pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
    return `${url.origin}${pathname}${url.search}`;
  } catch {
    return String(value || "").trim().replace(/\/+$/, "");
  }
};

const normalizedText = (value) =>
  String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("it")
    .replace(/\s+/g, " ")
    .trim();

const legacyText = (value) => String(value || "").trim().toLocaleLowerCase("it");

export function issueFamily(issue) {
  const text = normalizedText(`${issue?.type || ""} ${issue?.label || ""} ${issue?.detail || ""}`);
  if (/title duplic|titolo duplic/.test(text)) return "title-duplicate";
  if (/meta description duplic/.test(text)) return "meta-description-duplicate";
  if (/contenuto breve|short content|thin content|content.*parol|\bparol[ea]\b|\bwords?\b/.test(text)) return "short-content";
  if (/\bh1\b/.test(text)) return "h1";
  if (/canonical/.test(text)) return "canonical";
  if (/noindex/.test(text)) return "noindex";
  if (/meta description/.test(text)) return "meta-description";
  if (/excerpt|estratto/.test(text)) return "excerpt";
  if (/link estern|external link|broken external|404 estern/.test(text)) return "broken-external-link";
  if (/link intern|internal link|broken internal|404 intern/.test(text)) return "broken-internal-link";
  if (/title|titolo/.test(text)) return "title";
  const type = normalizedText(issue?.type || "issue").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const label = normalizedText(issue?.label || "issue")
    .replace(/\d+(?:[.,]\d+)?/g, "#")
    .replace(/[^a-z0-9#]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
  return `${type || "issue"}:${label || "unknown"}`;
}

export function issueKey(issue, fallbackUrl = "") {
  const url = normalizeIssueUrl(issue?.targetUrl || issue?.url || issue?.sourceUrl || fallbackUrl);
  return `${issueFamily(issue)}|${url}`;
}

export function clientIssueKey(clientId, issue, fallbackUrl = "") {
  return `${Number(clientId) || 0}|${issueKey(issue, fallbackUrl)}`;
}

const legacyIssueKey = (clientId, issue, fallbackUrl = "") => {
  const url = normalizeIssueUrl(issue?.targetUrl || issue?.url || issue?.sourceUrl || fallbackUrl);
  return `${Number(clientId) || 0}|${legacyText(issue?.label || "")}|${url}`;
};

export function resolvedEvidence() {
  const value = readJson(RESOLVED_EVIDENCE_KEY, {});
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function isIssueResolved(clientId, issue, fallbackUrl = "") {
  const current = resolvedEvidence();
  if (current[clientIssueKey(clientId, issue, fallbackUrl)]?.verifiedAt) return true;
  const legacy = readJson(LEGACY_RESOLVED_EVIDENCE_KEY, {});
  return Boolean(
    legacy &&
    typeof legacy === "object" &&
    !Array.isArray(legacy) &&
    legacy[legacyIssueKey(clientId, issue, fallbackUrl)]?.verifiedAt,
  );
}

export function rememberResolvedIssue(clientId, issue, fallbackUrl = "", details = {}) {
  if (!clientId || !issue) return;
  const current = resolvedEvidence();
  const key = clientIssueKey(clientId, issue, fallbackUrl);
  const next = {
    ...current,
    [key]: {
      verifiedAt: new Date().toISOString(),
      family: issueFamily(issue),
      url: normalizeIssueUrl(issue?.targetUrl || issue?.url || issue?.sourceUrl || fallbackUrl),
      label: String(issue?.label || ""),
      ...details,
    },
  };
  const entries = Object.entries(next)
    .toSorted((a, b) => Date.parse(b[1]?.verifiedAt || 0) - Date.parse(a[1]?.verifiedAt || 0))
    .slice(0, 2000);
  writeJson(RESOLVED_EVIDENCE_KEY, Object.fromEntries(entries));
}

export function forgetResolvedIssue(clientId, issue, fallbackUrl = "") {
  const current = resolvedEvidence();
  const key = clientIssueKey(clientId, issue, fallbackUrl);
  if (key in current) {
    const next = { ...current };
    delete next[key];
    writeJson(RESOLVED_EVIDENCE_KEY, next);
  }
  const legacy = readJson(LEGACY_RESOLVED_EVIDENCE_KEY, {});
  const oldKey = legacyIssueKey(clientId, issue, fallbackUrl);
  if (legacy && typeof legacy === "object" && !Array.isArray(legacy) && oldKey in legacy) {
    const nextLegacy = { ...legacy };
    delete nextLegacy[oldKey];
    writeJson(LEGACY_RESOLVED_EVIDENCE_KEY, nextLegacy);
  }
}

export { LEGACY_RESOLVED_EVIDENCE_KEY, RESOLVED_EVIDENCE_KEY };
