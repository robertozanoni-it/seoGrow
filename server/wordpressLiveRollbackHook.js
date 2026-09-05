import dns from "node:dns/promises";
import net from "node:net";
import express from "express";

const HOOKED = Symbol.for("seogrow.wordpressLiveRollbackHook");
const USE_PATCHED = Symbol.for("seogrow.wordpressLiveRollbackUsePatched");
const LISTEN_PATCHED = Symbol.for("seogrow.wordpressLiveRollbackListenPatched");

const META_KEYS = new Set([
  "_elementor_data",
  "rank_math_title",
  "rank_math_description",
  "rank_math_canonical_url",
  "rank_math_robots",
  "_yoast_wpseo_title",
  "_yoast_wpseo_metadesc",
  "_yoast_wpseo_canonical",
  "_yoast_wpseo_meta-robots-noindex",
]);

function privateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b, c] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0 && [0, 2].includes(c)) ||
      (a === 198 && [18, 19].includes(b)) ||
      (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
  }
  const value = String(address).toLowerCase();
  return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") ||
    /^fe[89ab]/.test(value) || /^fe[c-f]/.test(value) || value.startsWith("ff") || value.startsWith("2001:db8:");
}

async function safeBase(input) {
  const url = new URL(String(input || ""));
  if (url.protocol !== "https:") throw new Error("WordPress deve usare HTTPS.");
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase()) || url.hostname.endsWith(".local"))
    throw new Error("Indirizzo WordPress locale non consentito.");
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((item) => privateAddress(item.address)))
    throw new Error("Indirizzo WordPress non pubblico.");
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function endpoint(base, resource, suffix = "") {
  return new URL(`wp-json/wp/v2/${resource}${suffix}`, base);
}

function headers(username, password) {
  return {
    authorization: `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`,
    accept: "application/json",
    "content-type": "application/json",
    "user-agent": "seoGrowAI/1.4-wordpress-remediation",
  };
}

async function wpJson(url, options) {
  const response = await fetch(url, { redirect: "manual", ...options, signal: AbortSignal.timeout(20_000) });
  if ([301, 302, 303, 307, 308].includes(response.status)) throw new Error("WordPress ha restituito un redirect inatteso.");
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; }
  catch (error) { throw new Error(`Risposta WordPress non valida (HTTP ${response.status}).`, { cause: error }); }
  if (!response.ok) throw new Error(`WordPress: ${data?.message || data?.code || `HTTP ${response.status}`}`);
  return data;
}

function cleanChanges(input) {
  const source = input && typeof input === "object" ? input : {};
  const result = {};
  for (const key of ["title", "content", "excerpt"]) {
    if (source[key] !== undefined) result[key] = String(source[key] ?? "");
  }
  if (source.meta && typeof source.meta === "object" && !Array.isArray(source.meta)) {
    const meta = {};
    for (const [key, value] of Object.entries(source.meta)) {
      if (!META_KEYS.has(key)) throw new Error(`Campo meta non autorizzato nel rollback: ${key}`);
      meta[key] = Array.isArray(value) ? value.map((item) => String(item)) : String(value ?? "");
    }
    if (Object.keys(meta).length) result.meta = meta;
  }
  if (!Object.keys(result).length) throw new Error("Nessun valore ripristinabile.");
  return result;
}

const comparable = (value) => {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (value && typeof value === "object") return value;
  return String(value ?? "");
};

function currentField(entity, field) {
  if (field.startsWith("meta.")) return comparable(entity?.meta?.[field.slice(5)]);
  const value = entity?.[field];
  if (value && typeof value === "object") return comparable(value.raw ?? value.rendered ?? "");
  return comparable(value);
}

function assertExpectedCurrent(entity, expectedCurrent) {
  const expected = expectedCurrent && typeof expectedCurrent === "object" ? expectedCurrent : {};
  const staleFields = [];
  for (const [field, value] of Object.entries(expected)) {
    const current = currentField(entity, field);
    if (JSON.stringify(current) !== JSON.stringify(comparable(value))) staleFields.push(field);
  }
  if (staleFields.length) {
    const error = new Error(`Rollback bloccato: WordPress è cambiato dopo la correzione (${staleFields.join(", ")}). Ricarica lo stato e verifica le modifiche intervenute prima di ripristinare.`);
    error.code = "STALE_ROLLBACK";
    throw error;
  }
}

function registerRoutes(app) {
  if (app[HOOKED]) return;
  app[HOOKED] = true;
  app.post("/api/wordpress/live-rollback", async (req, res) => {
    try {
      const { siteUrl, targetUrl, username, applicationPassword, resource, id, changes, expectedCurrent } = req.body || {};
      if (!username || !applicationPassword) throw new Error("Inserisci utente e password applicativa WordPress.");
      if (resource !== "pages" && resource !== "posts") throw new Error("Tipo di contenuto WordPress non supportato.");
      const entityId = Number(id);
      if (!Number.isSafeInteger(entityId) || entityId <= 0) throw new Error("ID contenuto WordPress non valido.");
      const base = await safeBase(siteUrl || targetUrl);
      const auth = headers(username, applicationPassword);
      const patch = cleanChanges(changes);

      const current = await wpJson(endpoint(base, resource, `/${entityId}?context=edit`), {
        method: "GET",
        headers: auth,
      });
      if (!expectedCurrent || typeof expectedCurrent !== "object" || !Object.keys(expectedCurrent).length) {
        const error = new Error("Rollback bloccato: manca lo snapshot dello stato applicato necessario per il controllo stale-state.");
        error.code = "STALE_ROLLBACK";
        throw error;
      }
      assertExpectedCurrent(current, expectedCurrent);

      const update = await wpJson(endpoint(base, resource, `/${entityId}`), {
        method: "POST",
        headers: auth,
        body: JSON.stringify(patch),
      });
      return res.json({
        ok: true,
        resource,
        id: entityId,
        link: update?.link || targetUrl || "",
        changed: [
          ...Object.keys(patch).filter((key) => key !== "meta"),
          ...Object.keys(patch.meta || {}).map((key) => `meta.${key}`),
        ],
        status: update?.status || "",
        staleChecked: true,
        message: "Versione precedente ripristinata tramite rollback live approvato dopo controllo stale-state.",
      });
    } catch (error) {
      const status = error?.code === "STALE_ROLLBACK" ? 409 : 400;
      return res.status(status).json({ error: error instanceof Error ? error.message : "Rollback live non riuscito." });
    }
  });
}

const originalUse = express.application.use;
if (!originalUse[USE_PATCHED]) {
  const patchedUse = function (...args) {
    if (!this[HOOKED] && args[0] === "/api") registerRoutes(this);
    return originalUse.apply(this, args);
  };
  patchedUse[USE_PATCHED] = true;
  express.application.use = patchedUse;
}

const originalListen = express.application.listen;
if (!originalListen[LISTEN_PATCHED]) {
  const patchedListen = function (...args) {
    registerRoutes(this);
    return originalListen.apply(this, args);
  };
  patchedListen[LISTEN_PATCHED] = true;
  express.application.listen = patchedListen;
}
