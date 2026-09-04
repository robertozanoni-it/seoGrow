import dns from "node:dns/promises";
import net from "node:net";
import express from "express";

const HOOKED = Symbol.for("seogrow.wordpressRemediationHook");
const RATE = new Map();

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
  const v = String(address).toLowerCase();
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") ||
    /^fe[89ab]/.test(v) || /^fe[c-f]/.test(v) || v.startsWith("ff") || v.startsWith("2001:db8:");
}

async function safeBase(input) {
  const url = new URL(String(input || ""));
  if (url.protocol !== "https:") throw new Error("WordPress deve usare HTTPS.");
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase()) || url.hostname.endsWith(".local"))
    throw new Error("Indirizzo WordPress locale non consentito.");
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((item) => privateAddress(item.address)))
    throw new Error("Indirizzo WordPress non pubblico.");
  url.hash = "";
  return url;
}

function basePath(base) {
  return base.pathname.replace(/\/(?:wp-admin|wp-json)(?:\/.*)?$/i, "").replace(/\/$/, "");
}

function endpoint(base, resource, suffix = "") {
  const prefix = basePath(base);
  return new URL(`${prefix}/wp-json/wp/v2/${resource}${suffix}`, base.origin);
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
  const response = await fetch(url, { redirect: "manual", ...options, signal: AbortSignal.timeout(20000) });
  if ([301, 302, 303, 307, 308].includes(response.status)) throw new Error("WordPress ha restituito un redirect inatteso.");
  return response;
}

async function json(response) {
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { throw new Error(`Risposta WordPress non valida (HTTP ${response.status}).`); }
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
  if (recent.length >= 30) return false;
  recent.push(now); RATE.set(key, recent); return true;
}

function cleanString(value, max = 300000) {
  const text = String(value ?? "");
  if (text.length > max) throw new Error("Valore della modifica troppo grande.");
  return text;
}

async function resolveEntity(base, headers, requestedUrl) {
  const target = new URL(requestedUrl || base.href);
  const pathname = target.pathname.replace(/\/+$/, "");
  const slug = decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) || "");
  if (!slug) throw new Error("Impossibile determinare lo slug della pagina WordPress.");
  for (const resource of ["pages", "posts"]) {
    const url = endpoint(base, resource);
    url.searchParams.set("slug", slug);
    url.searchParams.set("context", "edit");
    url.searchParams.set("per_page", "10");
    const response = await wpFetch(url, { headers });
    const rows = await json(response);
    const match = Array.isArray(rows) ? rows.find((row) => {
      try { return new URL(row.link).pathname.replace(/\/+$/, "") === pathname; } catch { return false; }
    }) || rows[0] : null;
    if (match) return { resource, entity: match };
  }
  throw new Error(`Nessuna pagina o articolo WordPress trovato per ${target.href}`);
}

function allowedChanges(input) {
  const source = input && typeof input === "object" ? input : {};
  const changes = {};
  for (const key of ["title", "content", "excerpt", "slug"]) {
    if (source[key] !== undefined) changes[key] = cleanString(source[key]);
  }
  if (!Object.keys(changes).length) throw new Error("Nessuna modifica supportata da applicare.");
  if (changes.title && changes.title.length > 300) throw new Error("Il titolo supera 300 caratteri.");
  if (changes.slug && !/^[a-z0-9][a-z0-9-]*$/.test(changes.slug)) throw new Error("Slug non valido.");
  return changes;
}

async function registerRoutes(app) {
  if (app[HOOKED]) return;
  app[HOOKED] = true;

  app.post("/api/wordpress/inspect", async (req, res) => {
    if (!rateLimit(req)) return res.status(429).json({ error: "Limite remediation raggiunto. Riprova più tardi." });
    try {
      const { url, username, applicationPassword } = req.body || {};
      if (!username || !applicationPassword) throw new Error("Inserisci utente e password applicativa WordPress.");
      const base = await safeBase(url);
      const headers = authHeaders(username, applicationPassword);
      const me = await json(await wpFetch(endpoint(base, "users/me"), { headers }));
      const resolved = await resolveEntity(base, headers, url);
      return res.json({ ok: true, user: { id: me.id, name: me.name || me.username }, resource: resolved.resource, entity: resolved.entity });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Ispezione WordPress non riuscita." });
    }
  });

  app.post("/api/wordpress/remediate", async (req, res) => {
    if (!rateLimit(req)) return res.status(429).json({ error: "Limite remediation raggiunto. Riprova più tardi." });
    try {
      const { url, username, applicationPassword, resource, id, changes } = req.body || {};
      if (!username || !applicationPassword) throw new Error("Inserisci utente e password applicativa WordPress.");
      const base = await safeBase(url);
      const headers = authHeaders(username, applicationPassword);
      let entityResource = resource === "pages" || resource === "posts" ? resource : null;
      let entityId = Number(id);
      let current;
      if (!entityResource || !Number.isSafeInteger(entityId) || entityId <= 0) {
        const resolved = await resolveEntity(base, headers, url);
        entityResource = resolved.resource; entityId = Number(resolved.entity.id); current = resolved.entity;
      } else {
        current = await json(await wpFetch(endpoint(base, entityResource, `/${entityId}?context=edit`), { headers }));
      }
      const patch = allowedChanges(changes);
      const update = await json(await wpFetch(endpoint(base, entityResource, `/${entityId}`), {
        method: "POST", headers, body: JSON.stringify(patch),
      }));
      return res.json({
        ok: true,
        resource: entityResource,
        id: entityId,
        link: update.link || current?.link || url,
        changed: Object.keys(patch),
        before: { title: current?.title?.rendered || current?.title?.raw || "", slug: current?.slug || "" },
        after: { title: update?.title?.rendered || update?.title?.raw || "", slug: update?.slug || "" },
        message: "Modifica applicata e confermata da WordPress.",
      });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Remediation WordPress non riuscita." });
    }
  });
}

const originalListen = express.application.listen;
if (!originalListen[HOOKED]) {
  const patched = function (...args) {
    registerRoutes(this);
    return originalListen.apply(this, args);
  };
  patched[HOOKED] = true;
  express.application.listen = patched;
}
