const stripDiacritics = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

export const normalizeClientId = (value) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

export const normalizeHttpUrl = (value, { stripTracking = true, stripSlash = false } = {}) => {
  try {
    const url = new URL(String(value || "").trim());
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\/{2,}/g, "/");
    if (stripTracking) {
      for (const key of [...url.searchParams.keys()]) {
        if (/^(?:utm_|gclid$|fbclid$|mc_)/i.test(key)) url.searchParams.delete(key);
      }
      url.searchParams.sort();
    }
    if (stripSlash && url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.href;
  } catch {
    return "";
  }
};

export const safeHttpHref = (value) => normalizeHttpUrl(value, { stripTracking: false }) || "";

const normalizedIssueFamily = (record = {}) => {
  const issue = record.issue || {};
  const explicit = String(record.issueType || issue.type || "").trim().toLowerCase();
  if (explicit) return explicit;
  return stripDiacritics(record.issueLabel || issue.label || "audit")
    .toLowerCase()
    .replace(/\b\d+(?:[.,]\d+)?\b/g, "#")
    .replace(/\s+/g, " ")
    .trim();
};

const brokenTarget = (record = {}) => {
  const issue = record.issue || record;
  const type = normalizedIssueFamily(record);
  if (!/broken-(?:external-)?link|link.*(?:404|410|interrott|raggiung)/i.test(type)) return "";
  return normalizeHttpUrl(
    issue.targetUrl || issue.brokenUrl || issue.destinationUrl || issue.href || record.targetUrl || "",
    { stripSlash: false },
  );
};

export function resourceIdentity(record = {}) {
  const wordpressId = Number(record.wordpressId || record.resourceId || record.entityId || record.idWordPress);
  const resource = String(record.wordpressResource || record.resource || "").trim().toLowerCase();
  const site = normalizeHttpUrl(record.siteUrl || record.projectUrl || "", { stripSlash: true });
  if (Number.isSafeInteger(wordpressId) && wordpressId > 0) {
    return `wp:${site || "site"}:${resource || "content"}:${wordpressId}`;
  }

  const finalUrl = normalizeHttpUrl(record.finalUrl || record.resolvedUrl || "", { stripSlash: false });
  if (finalUrl) return `final:${finalUrl}`;

  const canonical = normalizeHttpUrl(record.canonical || record.canonicalUrl || "", { stripSlash: false });
  if (canonical && record.canonicalConfirmed === true) return `canonical:${canonical}`;

  // Non eliminiamo lo slash senza una prova che due URL siano lo stesso documento.
  const observed = normalizeHttpUrl(
    record.sourceUrl || record.url || record.targetUrl || record.issue?.targetUrl || record.issue?.url || "",
    { stripSlash: false },
  );
  return observed ? `url:${observed}` : "resource:unknown";
}

export function issueIdentity(record = {}) {
  const family = normalizedIssueFamily(record);
  const resource = resourceIdentity(record);
  const target = brokenTarget(record);
  return `${family}::${resource}${target ? `::target:${target}` : ""}`;
}

export const exactProblemStatus = (value) => {
  const status = stripDiacritics(value).toLowerCase().trim();
  if (["verificato", "verified"].includes(status)) return "verified";
  if (["da verificare", "needs verification", "needs-verification"].includes(status)) return "needs_verification";
  if (["applicato", "applied"].includes(status)) return "applied";
  if (["ripristinato", "rollback", "rolled back", "rolled-back"].includes(status)) return "rolled_back";
  if (["fallito", "failed", "errore", "error"].includes(status)) return "failed";
  if (["in corso", "in lavorazione", "running", "working"].includes(status)) return "working";
  if (["completato", "completed"].includes(status)) return "task_completed";
  if (["non verificato", "not verified", "unverified"].includes(status)) return "unverified";
  return "open";
};

export function deriveProblemState(events = []) {
  const ordered = [...events]
    .filter(Boolean)
    .map((event) => ({ ...event, at: event.at || event.observedAt || event.updatedAt || event.createdAt || "" }))
    .sort((a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0));

  let problemState = "open";
  let interventionState = "not_prepared";
  let verifiedAt = "";
  let lastAuditAt = "";
  let lastEventAt = "";

  for (const event of ordered) {
    const at = event.at || "";
    if (at) lastEventAt = at;
    if (event.kind === "audit_detected") {
      lastAuditAt = at || lastAuditAt;
      if (verifiedAt && Date.parse(at || 0) > Date.parse(verifiedAt || 0)) problemState = "reappeared";
      else if (problemState !== "resolved") problemState = "open";
      continue;
    }
    if (event.kind === "audit_intentional") {
      problemState = "intentional";
      continue;
    }
    if (event.kind === "correction_prepared") interventionState = "prepared";
    if (event.kind === "correction_approved") interventionState = "approved";
    if (event.kind === "correction_applied") {
      interventionState = "applied";
      if (problemState !== "reappeared") problemState = "needs_verification";
    }
    if (event.kind === "correction_failed") interventionState = "failed";
    if (event.kind === "rollback") {
      interventionState = "rolled_back";
      problemState = "open";
      verifiedAt = "";
    }
    if (event.kind === "correction_verified") {
      interventionState = "verified";
      problemState = "resolved";
      verifiedAt = at || verifiedAt;
    }
    // Una task completata non dimostra la risoluzione SEO.
    if (event.kind === "task_completed" && interventionState === "not_prepared") interventionState = "task_completed";
  }

  return { problemState, interventionState, verifiedAt, lastAuditAt, lastEventAt };
}

export function correctionEvent(record = {}) {
  const normalized = exactProblemStatus(record.status);
  const at = record.verifiedAt || record.rollbackAt || record.appliedAt || record.updatedAt || "";
  if (normalized === "verified") return { kind: "correction_verified", at, source: "correction", record };
  if (normalized === "rolled_back") return { kind: "rollback", at, source: "correction", record };
  if (normalized === "failed") return { kind: "correction_failed", at, source: "correction", record };
  if (["applied", "needs_verification"].includes(normalized)) return { kind: "correction_applied", at, source: "correction", record };
  return { kind: "correction_prepared", at, source: "correction", record };
}

export function taskEvent(task = {}) {
  const normalized = exactProblemStatus(task.status);
  return {
    kind: normalized === "task_completed" ? "task_completed" : "task_open",
    at: task.updatedAt || task.completedAt || task.createdAt || "",
    source: "task",
    record: task,
  };
}

const issueText = (issue = {}) =>
  `${issue.type || ""} ${issue.label || ""} ${issue.detail || ""}`.toLowerCase();

export function issueCorrectability(issue = {}, { pageKind = "", ownershipBlocked = false } = {}) {
  const text = issueText(issue);
  if (ownershipBlocked) return "manual";
  if (/broken-external-link|link esterno/.test(text)) return "manual";
  if (/broken-link|link interno/.test(text)) return "assisted";
  if (["archive", "taxonomy"].includes(String(pageKind).toLowerCase())) return "not_supported";
  if (/canonical|noindex/.test(text)) return "assisted";
  if (/meta description|title|titolo|h1|excerpt|estratto|contenuto|content|parole|word|brev/.test(text)) return "automatic";
  return "not_supported";
}

export function issueConfidence(issue = {}, { pageKind = "", canonicalEvidence = false, browserRendered = false } = {}) {
  const text = issueText(issue);
  if (/canonical/.test(text) && !canonicalEvidence) return "needs_confirmation";
  if (/noindex/.test(text) && ["archive", "taxonomy", "utility"].includes(String(pageKind).toLowerCase())) return "needs_confirmation";
  if (/h1|contenuto|content|parole|word/.test(text) && !browserRendered) return "measured_html";
  if (/broken-(?:external-)?link|404|410/.test(text)) return "observed";
  return "observed";
}

export const dataNature = (source) => {
  const value = String(source || "").toLowerCase();
  if (/openai|ai|proposta/.test(value)) return "proposal";
  if (/score|indice/.test(value)) return "derived";
  if (/dataforseo|provider/.test(value)) return "provider_observation";
  if (/gsc|search console/.test(value)) return "period_average";
  return "observed";
};

export function latestAudit(entries = [], { scope = "any" } = {}) {
  const valid = entries
    .filter((entry) => entry?.item && (scope === "any" || entry.type === scope))
    .toSorted((a, b) =>
      Date.parse(b.item?.analyzedAt || b.item?.startedAt || 0) -
      Date.parse(a.item?.analyzedAt || a.item?.startedAt || 0),
    );
  return valid[0] || null;
}

export function freshnessLabel(value, now = Date.now()) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return "data sconosciuta";
  const age = Math.max(0, now - timestamp);
  const hours = Math.floor(age / 3_600_000);
  if (hours < 1) return "meno di 1 ora fa";
  if (hours < 24) return `${hours} ore fa`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "giorno" : "giorni"} fa`;
}
