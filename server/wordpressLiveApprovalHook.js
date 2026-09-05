import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import express from "express";

const HOOKED = Symbol.for("seogrow.wordpressLiveApprovalHook");
const USE_PATCHED = Symbol.for("seogrow.wordpressLiveApprovalUsePatched");
const LISTEN_PATCHED = Symbol.for("seogrow.wordpressLiveApprovalListenPatched");
const APPROVALS = new Map();
const TTL_MS = 30 * 60_000;
const RATE = new Map();

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

async function safeSiteBase(input) {
  const url = new URL(String(input || ""));
  if (url.protocol !== "https:") throw new Error("WordPress deve usare HTTPS.");
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase()) || url.hostname.endsWith(".local"))
    throw new Error("Indirizzo WordPress locale non consentito.");
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((item) => privateAddress(item.address)))
    throw new Error("Indirizzo WordPress non pubblico.");
  url.pathname = `${url.pathname.replace(/\/(?:wp-admin|wp-json)(?:\/.*)?$/i, "").replace(/\/+$/, "")}/`;
  url.search = "";
  url.hash = "";
  return url;
}

function endpoint(base, resource, suffix = "") {
  return new URL(`wp-json/wp/v2/${resource}${suffix}`, base);
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
  const response = await fetch(url, {
    redirect: "manual",
    ...options,
    signal: AbortSignal.timeout(20_000),
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) throw new Error("WordPress ha restituito un redirect inatteso.");
  return response;
}

async function json(response) {
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; }
  catch (error) { throw new Error(`Risposta WordPress non valida (HTTP ${response.status}).`, { cause: error }); }
  if (!response.ok) {
    const detail = data?.message || data?.code || `HTTP ${response.status}`;
    throw new Error(`WordPress: ${detail}`);
  }
  return data;
}

function rateLimit(req) {
  const now = Date.now();
  const key = req.ip || "local";
  const recent = (RATE.get(key) || []).filter((time) => now - time < 10 * 60_000);
  if (recent.length >= 250) return false;
  recent.push(now);
  RATE.set(key, recent);
  return true;
}

function cleanString(value, max = 300000) {
  const text = String(value ?? "");
  if (text.length > max) throw new Error("Valore della modifica troppo grande.");
  return text;
}

function cleanMetaValue(value) {
  if (Array.isArray(value)) {
    if (value.length > 30) throw new Error("Valore meta troppo complesso.");
    return value.map((item) => cleanString(item, 10000));
  }
  return cleanString(value, 300000);
}

function allowedChanges(input) {
  const source = input && typeof input === "object" ? input : {};
  const changes = {};
  for (const key of ["title", "content", "excerpt"]) {
    if (source[key] !== undefined) changes[key] = cleanString(source[key]);
  }
  if (source.meta && typeof source.meta === "object" && !Array.isArray(source.meta)) {
    const meta = {};
    for (const [key, value] of Object.entries(source.meta)) {
      if (!META_KEYS.has(key)) throw new Error(`Campo meta WordPress non autorizzato: ${key}`);
      meta[key] = cleanMetaValue(value);
    }
    if (Object.keys(meta).length) changes.meta = meta;
  }
  if (!Object.keys(changes).length) throw new Error("Nessuna modifica supportata da applicare.");
  if (changes.title && changes.title.length > 300) throw new Error("Il titolo supera 300 caratteri.");
  return changes;
}

const rawField = (field) => String(field?.raw ?? field?.rendered ?? "");

function selectedState(entity, changes) {
  const state = {};
  for (const key of ["title", "content", "excerpt"]) {
    if (changes[key] !== undefined) state[key] = rawField(entity?.[key]);
  }
  if (changes.meta) {
    state.meta = {};
    for (const key of Object.keys(changes.meta)) state.meta[key] = entity?.meta?.[key] ?? "";
  }
  return state;
}

function afterState(entity, changes) {
  const state = selectedState(entity, changes);
  for (const key of ["title", "content", "excerpt"]) {
    if (changes[key] !== undefined) state[key] = changes[key];
  }
  if (changes.meta) state.meta = { ...state.meta, ...changes.meta };
  return state;
}

function snapshotHash(entity, changes) {
  const payload = {
    id: Number(entity?.id || 0),
    status: String(entity?.status || ""),
    selected: selectedState(entity, changes),
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function changedFields(changes) {
  return [
    ...Object.keys(changes || {}).filter((key) => key !== "meta"),
    ...Object.keys(changes?.meta || {}).map((key) => `meta.${key}`),
  ].sort();
}

function cleanupApprovals() {
  const now = Date.now();
  for (const [token, approval] of APPROVALS.entries()) {
    if (now - approval.createdAt > TTL_MS) APPROVALS.delete(token);
  }
}

function invalidateOverlappingApprovals({ siteUrl, resource, id, changes }) {
  const fields = new Set(changedFields(changes));
  let invalidated = 0;
  for (const [token, approval] of APPROVALS.entries()) {
    if (
      String(approval.siteUrl || "") !== String(siteUrl || "") ||
      approval.resource !== resource ||
      Number(approval.id) !== Number(id)
    ) continue;
    if (!changedFields(approval.changes).some((field) => fields.has(field))) continue;
    APPROVALS.delete(token);
    invalidated += 1;
  }
  return invalidated;
}

async function loadEntity(base, headers, resource, id) {
  if (resource !== "pages" && resource !== "posts") throw new Error("Tipo di contenuto WordPress non supportato.");
  const entityId = Number(id);
  if (!Number.isSafeInteger(entityId) || entityId <= 0) throw new Error("ID contenuto WordPress non valido.");
  return json(await wpFetch(endpoint(base, resource, `/${entityId}?context=edit`), { headers }));
}

function registerRoutes(app) {
  if (app[HOOKED]) return;
  app[HOOKED] = true;

  app.post("/api/wordpress/live-preview", async (req, res) => {
    if (!rateLimit(req)) return res.status(429).json({ error: "Limite remediation raggiunto. Riprova più tardi." });
    try {
      cleanupApprovals();
      const { siteUrl, targetUrl, username, applicationPassword, resource, id, changes, issue, adapter } = req.body || {};
      if (!username || !applicationPassword) throw new Error("Inserisci utente e password applicativa WordPress.");
      const base = await safeSiteBase(siteUrl || targetUrl);
      const headers = authHeaders(username, applicationPassword);
      const current = await loadEntity(base, headers, resource, id);
      const status = String(current?.status || "").toLowerCase();
      if (["trash", "auto-draft", "inherit"].includes(status)) throw new Error(`Il contenuto WordPress ha stato ${status} e non può essere modificato.`);
      const patch = allowedChanges(changes);
      const before = selectedState(current, patch);
      const after = afterState(current, patch);
      if (JSON.stringify(before) === JSON.stringify(after)) throw new Error("La modifica proposta coincide con il valore già presente.");

      const normalizedSite = String(siteUrl || targetUrl || "");
      const invalidatedApprovals = invalidateOverlappingApprovals({
        siteUrl: normalizedSite,
        resource,
        id: Number(id),
        changes: patch,
      });
      const token = crypto.randomUUID();
      APPROVALS.set(token, {
        createdAt: Date.now(),
        siteUrl: normalizedSite,
        targetUrl: String(targetUrl || ""),
        resource,
        id: Number(id),
        changes: patch,
        issue: issue && typeof issue === "object" ? issue : {},
        adapter: String(adapter || "WordPress"),
        snapshotHash: snapshotHash(current, patch),
        before,
      });
      return res.json({
        ok: true,
        approvalToken: token,
        expiresInSeconds: Math.floor(TTL_MS / 1000),
        invalidatedApprovals,
        resource,
        id: Number(id),
        sourceStatus: status || "unknown",
        adapter: String(adapter || "WordPress"),
        targetUrl: String(targetUrl || current?.link || ""),
        previewBefore: before,
        previewAfter: after,
        changed: changedFields(patch),
        message: invalidatedApprovals
          ? `Anteprima pronta. ${invalidatedApprovals} anteprime precedenti sullo stesso campo sono state invalidate. Nessuna modifica è stata ancora applicata.`
          : "Anteprima pronta. Nessuna modifica è stata ancora applicata al sito.",
      });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Anteprima remediation non riuscita." });
    }
  });

  app.post("/api/wordpress/live-apply", async (req, res) => {
    if (!rateLimit(req)) return res.status(429).json({ error: "Limite remediation raggiunto. Riprova più tardi." });
    try {
      cleanupApprovals();
      const { approvalToken, username, applicationPassword } = req.body || {};
      if (!username || !applicationPassword) throw new Error("Inserisci utente e password applicativa WordPress.");
      const approval = APPROVALS.get(String(approvalToken || ""));
      if (!approval) return res.status(409).json({ error: "Anteprima scaduta, sostituita o già utilizzata. Rigenera l'anteprima.", code: "APPROVAL_EXPIRED" });
      APPROVALS.delete(String(approvalToken));

      const base = await safeSiteBase(approval.siteUrl || approval.targetUrl);
      const headers = authHeaders(username, applicationPassword);
      const current = await loadEntity(base, headers, approval.resource, approval.id);
      if (snapshotHash(current, approval.changes) !== approval.snapshotHash)
        return res.status(409).json({ error: "Il campo WordPress da modificare è cambiato dopo l'anteprima. Nessuna modifica applicata: rigenera l'anteprima.", code: "STALE_PREVIEW" });

      const update = await json(await wpFetch(endpoint(base, approval.resource, `/${approval.id}`), {
        method: "POST",
        headers,
        body: JSON.stringify(approval.changes),
      }));
      const before = approval.before;
      const after = selectedState(update, approval.changes);
      return res.json({
        ok: true,
        liveApplied: true,
        adapter: approval.adapter,
        resource: approval.resource,
        id: approval.id,
        link: update?.link || approval.targetUrl,
        sourceUrl: approval.targetUrl,
        issue: approval.issue,
        status: update?.status || current?.status || "",
        changed: changedFields(approval.changes),
        before,
        after,
        changes: approval.changes,
        message: "Modifica live approvata e applicata a WordPress. Avvio della riverifica SEO necessario.",
      });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Applicazione live non riuscita." });
    }
  });
}

export { registerRoutes, invalidateOverlappingApprovals, changedFields };

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
