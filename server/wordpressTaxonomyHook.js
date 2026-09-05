import dns from "node:dns/promises";
import { isPrivateOrReservedAddress } from "./networkSafety.js";

const HOOKED = Symbol.for("seogrow.wordpressTaxonomyHook");
const RATE = new Map();
const ALLOWED_TAXONOMIES = new Set(["category", "post_tag"]);

async function safeBase(input) {
  const url = new URL(String(input || ""));
  if (url.protocol !== "https:") throw new Error("WordPress deve usare HTTPS.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (["localhost", "127.0.0.1", "::1"].includes(host) || host.endsWith(".local"))
    throw new Error("Indirizzo WordPress locale non consentito.");
  const addresses = await dns.lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => isPrivateOrReservedAddress(item.address)))
    throw new Error("Indirizzo WordPress non pubblico.");
  url.pathname = `${url.pathname.replace(/\/(?:wp-admin|wp-json)(?:\/.*)?$/i, "").replace(/\/+$/, "")}/`;
  url.search = "";
  url.hash = "";
  return url;
}

function basePath(base) {
  const pathname = String(base?.pathname || "/").replace(/\/+$/, "");
  return pathname === "/" ? "" : pathname;
}

function taxonomyEndpoint(base, targetUrl) {
  const endpoint = new URL(`${basePath(base)}/wp-json/seogrow/v1/taxonomy-inspect`, base.origin);
  endpoint.searchParams.set("url", targetUrl);
  return endpoint;
}

function authHeaders(username, password) {
  return {
    authorization: `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`,
    accept: "application/json",
    "user-agent": "seoGrowAI/1.4-wordpress-remediation",
  };
}

function normalizedIdentity(value) {
  try {
    const url = new URL(String(value || ""));
    return {
      host: url.hostname.toLowerCase(),
      path: decodeURIComponent(url.pathname).replace(/\/+$/, "") || "/",
    };
  } catch {
    return { host: "", path: "" };
  }
}

export function normalizeTaxonomyInspection(data, requestedUrl) {
  if (!data || data.ok !== true || data.readOnly !== true || data.resource !== "taxonomy")
    throw new Error("Il Connector non ha restituito un'ispezione tassonomia read-only valida.");

  const term = data.term && typeof data.term === "object" ? data.term : {};
  const id = Number(term.id);
  const taxonomy = String(term.taxonomy || "");
  if (!Number.isSafeInteger(id) || id <= 0 || !ALLOWED_TAXONOMIES.has(taxonomy))
    throw new Error("Identità tassonomia restituita dal Connector non valida.");

  const requested = normalizedIdentity(requestedUrl);
  const linked = normalizedIdentity(term.link);
  if (!requested.host || !linked.host || requested.host !== linked.host || requested.path !== linked.path)
    throw new Error("La tassonomia restituita non coincide esattamente con la URL richiesta.");

  const plugins = {
    rankMath: data.plugins?.rankMath === true,
    yoast: data.plugins?.yoast === true,
  };
  const ownership = plugins.rankMath && plugins.yoast
    ? "ambiguous"
    : plugins.rankMath
      ? "rank-math-only"
      : plugins.yoast
        ? "yoast-only"
        : "none";

  return {
    ok: true,
    readOnly: true,
    resource: "taxonomy",
    term: {
      id,
      taxonomy,
      slug: String(term.slug || ""),
      name: String(term.name || ""),
      description: String(term.description || ""),
      link: String(term.link || ""),
    },
    seo: {
      rankMath: data.seo?.rankMath && typeof data.seo.rankMath === "object" ? data.seo.rankMath : null,
      yoast: data.seo?.yoast && typeof data.seo.yoast === "object" ? data.seo.yoast : null,
    },
    plugins,
    ownership,
    writable: false,
    nextStep: ownership === "ambiguous"
      ? "Confermare quale plugin SEO possiede il valore pubblico prima di preparare modifiche."
      : ownership === "none"
        ? "Nessun adapter SEO tassonomia supportato rilevato."
        : "Ispezione disponibile; la scrittura resta disabilitata finché preview, stale-state e rollback non sono attivi.",
  };
}

function rateLimit(req) {
  const now = Date.now();
  const key = req.ip || "local";
  const recent = (RATE.get(key) || []).filter((time) => now - time < 10 * 60_000);
  if (recent.length >= 120) return false;
  recent.push(now);
  RATE.set(key, recent);
  return true;
}

async function connectorJson(response) {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024)
    throw new Error("Risposta taxonomy del Connector troppo grande.");
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Risposta taxonomy del Connector non valida (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    if (response.status === 404)
      throw new Error("SeoGrow Connector 1.2.0 o superiore è necessario per ispezionare categorie e tag.");
    throw new Error(data?.message || data?.error || data?.code || `WordPress HTTP ${response.status}`);
  }
  return data;
}

function registerRoutes(app) {
  if (app[HOOKED]) return;
  app[HOOKED] = true;

  app.post("/api/wordpress/inspect-taxonomy", async (req, res) => {
    if (!rateLimit(req))
      return res.status(429).json({ error: "Limite ispezioni tassonomie raggiunto. Riprova più tardi." });
    try {
      const { url, username, applicationPassword } = req.body || {};
      if (!username || !applicationPassword)
        throw new Error("Inserisci utente e password applicativa WordPress.");
      const targetUrl = new URL(String(url || ""));
      if (targetUrl.protocol !== "https:") throw new Error("La tassonomia WordPress deve usare HTTPS.");
      targetUrl.hash = "";

      const base = await safeBase(targetUrl.href);
      const response = await fetch(taxonomyEndpoint(base, targetUrl.href), {
        method: "GET",
        headers: authHeaders(username, applicationPassword),
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        throw new Error("WordPress ha restituito un redirect inatteso durante l'ispezione tassonomia.");
      }
      const data = await connectorJson(response);
      return res.json(normalizeTaxonomyInspection(data, targetUrl.href));
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Ispezione tassonomia non riuscita.",
      });
    }
  });
}

export { registerRoutes, safeBase, taxonomyEndpoint, normalizedIdentity };
