import dns from "node:dns/promises";
import { isPrivateOrReservedAddress } from "./networkSafety.js";
import { pickExactWordPressEntity } from "./wordpressEntityIdentity.js";

const HOOKED = Symbol.for("seogrow.wordpressInspectFastHook");
const RATE = new Map();
const RANK_MATH_META = ["rank_math_title", "rank_math_description", "rank_math_canonical_url", "rank_math_robots"];
const YOAST_META = ["_yoast_wpseo_title", "_yoast_wpseo_metadesc", "_yoast_wpseo_canonical", "_yoast_wpseo_meta-robots-noindex"];

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
  const path = String(base?.pathname || "/").replace(/\/+$/, "");
  return path === "/" ? "" : path;
}

function endpoint(base, resource, suffix = "") {
  return new URL(`${basePath(base)}/wp-json/wp/v2/${resource}${suffix}`, base.origin);
}

function connectorEndpoint(base) {
  return new URL(`${basePath(base)}/wp-json/seogrow/v1/status`, base.origin);
}

function authHeaders(username, password) {
  return {
    authorization: `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`,
    accept: "application/json",
    "content-type": "application/json",
    "user-agent": "seoGrowAI/1.4-wordpress-remediation",
  };
}

async function wpFetch(url, options = {}) {
  const response = await fetch(url, { redirect: "manual", ...options, signal: AbortSignal.timeout(20_000) });
  if ([301, 302, 303, 307, 308].includes(response.status))
    throw new Error("WordPress ha restituito un redirect inatteso.");
  return response;
}

async function json(response) {
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`Risposta WordPress non valida (HTTP ${response.status}).`, { cause: error });
  }
  if (!response.ok) {
    const detail = data?.message || data?.code || `HTTP ${response.status}`;
    throw new Error(`WordPress: ${detail}`);
  }
  return data;
}

async function connectorStatus(base, headers) {
  const response = await wpFetch(connectorEndpoint(base), { headers });
  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  const data = await json(response);
  if (data?.ok !== true || data?.connector !== "SeoGrow Connector") return null;
  return {
    connector: String(data.connector),
    version: String(data.version || ""),
    elementor: data.elementor === true,
    rankMath: data.rankMath === true,
    yoast: data.yoast === true,
  };
}

function filterConnectorOwnedMeta(entity, connector) {
  const source = entity && typeof entity === "object" ? entity : {};
  const meta = source.meta && typeof source.meta === "object" && !Array.isArray(source.meta)
    ? { ...source.meta }
    : {};
  if (connector?.elementor !== true) delete meta._elementor_data;
  if (connector?.rankMath !== true) RANK_MATH_META.forEach((key) => delete meta[key]);
  if (connector?.yoast !== true) YOAST_META.forEach((key) => delete meta[key]);
  return { ...source, meta };
}

function rateLimit(req) {
  const now = Date.now();
  const key = req.ip || "local";
  const recent = (RATE.get(key) || []).filter((time) => now - time < 10 * 60_000);
  if (recent.length >= 300) return false;
  recent.push(now);
  RATE.set(key, recent);
  return true;
}

async function resolveEntity(base, headers, requestedUrl) {
  const target = new URL(String(requestedUrl || base.href));
  const pathname = target.pathname.replace(/\/+$/, "") || "/";
  const segments = pathname.split("/").filter(Boolean);
  const slug = decodeURIComponent(segments.at(-1) || "");

  if (!slug) {
    const settings = await json(await wpFetch(endpoint(base, "settings"), { headers }));
    const frontPageId = Number(settings?.page_on_front);
    if (settings?.show_on_front !== "page" || !Number.isSafeInteger(frontPageId) || frontPageId <= 0)
      throw new Error("Homepage WordPress basata sull'archivio articoli: non è un contenuto singolo modificabile automaticamente.");
    const entity = await json(await wpFetch(endpoint(base, "pages", `/${frontPageId}?context=edit`), { headers }));
    return { resource: "pages", entity };
  }

  let candidatesFound = 0;
  for (const resource of ["pages", "posts"]) {
    const url = endpoint(base, resource);
    url.searchParams.set("slug", slug);
    url.searchParams.set("context", "edit");
    url.searchParams.set("per_page", "10");
    const rows = await json(await wpFetch(url, { headers }));
    if (Array.isArray(rows)) candidatesFound += rows.length;
    const match = pickExactWordPressEntity(rows, pathname, target.hostname);
    if (match) return { resource, entity: match };
  }

  if (candidatesFound > 0) {
    throw new Error(
      `WordPress ha restituito ${candidatesFound} contenuti con slug compatibile, ma nessun permalink coincide esattamente con ${target.hostname}${target.pathname}. SeoGrow blocca l'ispezione per evitare di modificare la risorsa sbagliata.`,
    );
  }
  throw new Error(`Nessuna pagina o articolo WordPress trovato per ${target.href}`);
}

function registerRoutes(app) {
  if (app[HOOKED]) return;
  app[HOOKED] = true;

  app.post("/api/wordpress/inspect-fast", async (req, res) => {
    if (!rateLimit(req)) return res.status(429).json({ error: "Limite ispezioni WordPress raggiunto. Riprova più tardi." });
    try {
      const { url, username, applicationPassword } = req.body || {};
      if (!username || !applicationPassword) throw new Error("Inserisci utente e password applicativa WordPress.");
      const base = await safeBase(url);
      const headers = authHeaders(username, applicationPassword);
      const [resolved, connector] = await Promise.all([
        resolveEntity(base, headers, url),
        connectorStatus(base, headers),
      ]);
      return res.json({
        ok: true,
        fast: true,
        user: { id: 0, name: String(username) },
        resource: resolved.resource,
        entity: filterConnectorOwnedMeta(resolved.entity, connector),
        connector,
      });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Ispezione WordPress non riuscita." });
    }
  });
}

export { registerRoutes, resolveEntity, safeBase, connectorStatus, filterConnectorOwnedMeta, basePath };
