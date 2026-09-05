const CHOICES = {
  title: [["rank_math_title", "Rank Math"], ["_yoast_wpseo_title", "Yoast"]],
  meta_description: [["rank_math_description", "Rank Math"], ["_yoast_wpseo_metadesc", "Yoast"]],
  canonical: [["rank_math_canonical_url", "Rank Math"], ["_yoast_wpseo_canonical", "Yoast"]],
  noindex: [["rank_math_robots", "Rank Math"], ["_yoast_wpseo_meta-robots-noindex", "Yoast"]],
};

const decodeEntities = (value) => String(value ?? "")
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, '"')
  .replace(/&#0*39;|&apos;/gi, "'")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">");

const normalizeText = (value) => decodeEntities(value)
  .replace(/\s+/g, " ")
  .trim()
  .toLocaleLowerCase("it");

const containsTemplateToken = (value) => /%%[^%]+%%|%[a-z0-9_-]+%|\{\{[^}]+\}\}|\[[a-z0-9_-]+\]/i.test(String(value || ""));

const normalizeUrl = (value) => {
  try {
    const url = new URL(String(value || "").trim());
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    return url.href;
  } catch {
    return "";
  }
};

const noindexIntent = (key, value) => {
  if (key === "_yoast_wpseo_meta-robots-noindex") {
    const normalized = String(value ?? "").trim();
    if (normalized === "1") return true;
    if (normalized === "2") return false;
    return null;
  }
  const values = Array.isArray(value) ? value : String(value ?? "").split(/[\s,]+/);
  const tokens = values.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  if (tokens.includes("noindex")) return true;
  if (tokens.includes("index")) return false;
  return null;
};

const evidenceMatches = (kind, key, storedValue, frontend = {}) => {
  if (kind === "title") {
    if (!storedValue || containsTemplateToken(storedValue)) return false;
    const observed = normalizeText(frontend.title);
    return Boolean(observed) && normalizeText(storedValue) === observed;
  }
  if (kind === "meta_description") {
    if (!storedValue || containsTemplateToken(storedValue)) return false;
    const observed = normalizeText(frontend.metaDescription);
    return Boolean(observed) && normalizeText(storedValue) === observed;
  }
  if (kind === "canonical") {
    const stored = normalizeUrl(storedValue);
    const observed = normalizeUrl(frontend.canonical);
    return Boolean(stored && observed) && stored === observed;
  }
  if (kind === "noindex") {
    const intent = noindexIntent(key, storedValue);
    return intent !== null && typeof frontend.noindex === "boolean" && intent === frontend.noindex;
  }
  return false;
};

export function resolveSeoPluginOwner(entity, kind, frontend = {}) {
  const meta = entity?.meta && typeof entity.meta === "object" && !Array.isArray(entity.meta)
    ? entity.meta
    : {};
  const matches = (CHOICES[kind] || []).filter(([key]) => Object.prototype.hasOwnProperty.call(meta, key));
  if (matches.length === 0) return { owner: null, reason: "Nessun campo SEO REST compatibile è esposto." };
  if (matches.length === 1) return { owner: matches[0], reason: "Un solo adapter SEO espone il campo richiesto." };

  const evidenced = matches.filter(([key]) => evidenceMatches(kind, key, meta[key], frontend));
  if (evidenced.length === 1) {
    return {
      owner: evidenced[0],
      reason: `Ownership confermata dal valore frontend corrente: ${evidenced[0][1]}.`,
      evidence: "frontend-value-match",
    };
  }

  return {
    owner: null,
    reason: evidenced.length > 1
      ? "Rank Math e Yoast coincidono entrambi con il frontend: l'ownership resta ambigua."
      : "Rank Math e Yoast sono entrambi esposti, ma nessun valore identifica in modo univoco quale plugin alimenti il frontend.",
    evidence: evidenced.length > 1 ? "multiple-frontend-matches" : "no-unique-frontend-match",
  };
}

export { evidenceMatches, noindexIntent, normalizeUrl };
