const valueUrl = (value) => {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") return String(value.url || value.targetUrl || "").trim();
  return "";
};

export function buildElementorImpactCandidateUrls({ audit, issue, client, limit = 30 } = {}) {
  const max = Number.isSafeInteger(Number(limit)) ? Math.min(Math.max(Number(limit), 1), 30) : 30;
  const values = [
    issue?.targetUrl,
    issue?.url,
    audit?.url,
    client?.url,
    ...(Array.isArray(audit?.pages) ? audit.pages.map(valueUrl) : []),
    ...(Array.isArray(audit?.issues) ? audit.issues.map(valueUrl) : []),
  ];
  const unique = [];
  const seen = new Set();
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    unique.push(text);
    if (unique.length >= max) break;
  }
  return unique;
}
