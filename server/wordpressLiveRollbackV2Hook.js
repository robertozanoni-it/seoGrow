import express from "express";

const HOOKED = Symbol.for("seogrow.wordpressLiveRollbackV2Hook");
const USE_PATCHED = Symbol.for("seogrow.wordpressLiveRollbackV2UsePatched");
const LISTEN_PATCHED = Symbol.for("seogrow.wordpressLiveRollbackV2ListenPatched");
const USER_AGENT = "seoGrowAI/1.4-wordpress-remediation";

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

const safeBase = (input) => {
  const url = new URL(String(input || ""));
  if (url.protocol !== "https:") throw new Error("WordPress deve usare HTTPS.");
  if (url.username || url.password) throw new Error("La URL WordPress non può contenere credenziali.");
  url.pathname = `${url.pathname.replace(/\/(?:wp-admin|wp-json)(?:\/.*)?$/i, "").replace(/\/+$/, "")}/`;
  url.search = "";
  url.hash = "";
  return url;
};

const endpoint = (base, resource, suffix = "") => new URL(`wp-json/wp/v2/${resource}${suffix}`, base);

const authHeaders = (username, password) => ({
  authorization: `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`,
  accept: "application/json",
  "content-type": "application/json",
  "user-agent": USER_AGENT,
});

const wpJson = async (url, options = {}) => {
  const response = await fetch(url, { redirect: "manual", ...options, signal: AbortSignal.timeout(20_000) });
  if ([301, 302, 303, 307, 308].includes(response.status)) throw new Error("WordPress ha restituito un redirect inatteso.");
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; }
  catch (error) { throw new Error(`Risposta WordPress non valida (HTTP ${response.status}).`, { cause: error }); }
  if (!response.ok) throw new Error(`WordPress: ${data?.message || data?.code || `HTTP ${response.status}`}`);
  return data;
};

const cleanString = (value, max = 300000) => {
  const text = String(value ?? "");
  if (text.length > max) throw new Error("Valore rollback troppo grande.");
  return text;
};

const cleanMetaValue = (value) => {
  if (Array.isArray(value)) {
    if (value.length > 30) throw new Error("Valore meta rollback troppo complesso.");
    return value.map((item) => cleanString(item, 10000));
  }
  return cleanString(value);
};

function cleanChanges(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const changes = {};
  for (const key of ["title", "content", "excerpt"]) {
    if (source[key] !== undefined) changes[key] = cleanString(source[key]);
  }
  const meta = {};
  const nestedMeta = source.meta && typeof source.meta === "object" && !Array.isArray(source.meta) ? source.meta : {};
  for (const [key, value] of Object.entries(nestedMeta)) {
    if (!META_KEYS.has(key)) throw new Error(`Campo meta non autorizzato nel rollback: ${key}`);
    meta[key] = cleanMetaValue(value);
  }
  for (const [key, value] of Object.entries(source)) {
    if (!key.startsWith("meta.")) continue;
    const metaKey = key.slice(5);
    if (!META_KEYS.has(metaKey)) throw new Error(`Campo meta non autorizzato nel rollback: ${metaKey}`);
    meta[metaKey] = cleanMetaValue(value);
  }
  if (Object.keys(meta).length) changes.meta = meta;
  if (!Object.keys(changes).length) throw new Error("Nessun valore ripristinabile.");
  return changes;
}

const rawField = (field) => String(field?.raw ?? field?.rendered ?? "");

function selectedState(entity, changes) {
  const result = {};
  for (const key of ["title", "content", "excerpt"]) {
    if (changes[key] !== undefined) result[key] = rawField(entity?.[key]);
  }
  if (changes.meta) {
    result.meta = {};
    for (const key of Object.keys(changes.meta)) result.meta[key] = entity?.meta?.[key] ?? "";
  }
  return result;
}

function normalizeExpected(input, changes) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const expected = {};
  for (const key of ["title", "content", "excerpt"]) {
    if (changes[key] !== undefined && input[key] !== undefined) expected[key] = String(input[key] ?? "");
  }
  if (changes.meta) {
    expected.meta = {};
    for (const key of Object.keys(changes.meta)) {
      if (input.meta && Object.prototype.hasOwnProperty.call(input.meta, key)) expected.meta[key] = input.meta[key];
      else if (Object.prototype.hasOwnProperty.call(input, `meta.${key}`)) expected.meta[key] = input[`meta.${key}`];
      else return null;
    }
  }
  return expected;
}

const stateEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function registerRoutes(app) {
  if (app[HOOKED]) return;
  app[HOOKED] = true;
  app.post("/api/wordpress/live-rollback-v2", async (req, res) => {
    try {
      const { siteUrl, targetUrl, username, applicationPassword, resource, id, changes, expectedCurrent } = req.body || {};
      if (!username || !applicationPassword) throw new Error("Inserisci utente e password applicativa WordPress.");
      if (!["pages", "posts"].includes(resource)) throw new Error("Tipo di contenuto WordPress non supportato.");
      const entityId = Number(id);
      if (!Number.isSafeInteger(entityId) || entityId <= 0) throw new Error("ID contenuto WordPress non valido.");
      const base = safeBase(siteUrl || targetUrl);
      const headers = authHeaders(username, applicationPassword);
      const patch = cleanChanges(changes);
      const current = await wpJson(endpoint(base, resource, `/${entityId}?context=edit`), { headers });
      const currentState = selectedState(current, patch);
      const expected = normalizeExpected(expectedCurrent, patch);
      if (!expected) {
        return res.status(409).json({
          error: "Rollback bloccato: manca lo stato corrente atteso. Riapri Correzioni e prepara nuovamente il ripristino.",
          code: "ROLLBACK_EXPECTATION_REQUIRED",
        });
      }
      if (!stateEqual(currentState, expected)) {
        return res.status(409).json({
          error: "Rollback bloccato: il campo WordPress è cambiato dopo la correzione. Nessun dato è stato sovrascritto.",
          code: "STALE_ROLLBACK",
          current: currentState,
        });
      }
      const update = await wpJson(endpoint(base, resource, `/${entityId}`), {
        method: "POST",
        headers,
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
        before: currentState,
        after: selectedState(update, patch),
        status: update?.status || "",
        message: "Versione precedente ripristinata con controllo anti-sovrascrittura.",
      });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Rollback V2 non riuscito." });
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
