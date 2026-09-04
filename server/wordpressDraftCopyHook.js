import dns from "node:dns/promises";
import net from "node:net";
import express from "express";

const HOOKED = Symbol.for("seogrow.wordpressDraftCopyHook");
const USE_PATCHED = Symbol.for("seogrow.wordpressDraftCopyUsePatched");
const LISTEN_PATCHED = Symbol.for("seogrow.wordpressDraftCopyListenPatched");

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
  const response = await fetch(url, {
    redirect: "manual",
    ...options,
    signal: AbortSignal.timeout(20_000),
  });
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

function cleanString(value, max = 300000) {
  const text = String(value ?? "");
  if (text.length > max) throw new Error("Valore della modifica troppo grande.");
  return text;
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

const rawField = (field) => String(field?.raw ?? field?.rendered ?? "");

function draftPayload(current, changes, resource) {
  const payload = {
    status: "draft",
    title: changes.title ?? rawField(current?.title),
    content: changes.content ?? rawField(current?.content),
    excerpt: changes.excerpt ?? rawField(current?.excerpt),
  };
  if (changes.slug) payload.slug = changes.slug;
  if (resource === "pages") {
    const parent = Number(current?.parent);
    if (Number.isSafeInteger(parent) && parent >= 0) payload.parent = parent;
    if (typeof current?.template === "string" && current.template) payload.template = current.template;
    const menuOrder = Number(current?.menu_order);
    if (Number.isSafeInteger(menuOrder)) payload.menu_order = menuOrder;
  }
  return payload;
}

function registerRoutes(app) {
  if (app[HOOKED]) return;
  app[HOOKED] = true;

  app.post("/api/wordpress/remediate-draft-copy", async (req, res) => {
    try {
      const { url, username, applicationPassword, resource, id, changes } = req.body || {};
      if (!username || !applicationPassword)
        throw new Error("Inserisci utente e password applicativa WordPress.");
      if (resource !== "pages" && resource !== "posts")
        throw new Error("Tipo di contenuto WordPress non supportato.");
      const entityId = Number(id);
      if (!Number.isSafeInteger(entityId) || entityId <= 0)
        throw new Error("ID contenuto WordPress non valido.");

      const base = await safeBase(url);
      const headers = authHeaders(username, applicationPassword);
      const current = await json(
        await wpFetch(endpoint(base, resource, `/${entityId}?context=edit`), { headers }),
      );
      const currentStatus = String(current?.status || "").toLowerCase();
      if (currentStatus === "draft")
        return res.status(409).json({
          error: "Il contenuto è già una bozza: usa la remediation standard.",
          code: "ALREADY_DRAFT",
        });
      if (["trash", "auto-draft", "inherit"].includes(currentStatus))
        return res.status(409).json({
          error: `Il contenuto WordPress ha stato ${currentStatus} e non può essere duplicato per la remediation.`,
          code: "UNSAFE_SOURCE_STATUS",
          currentStatus,
        });

      const patch = allowedChanges(changes);
      const payload = draftPayload(current, patch, resource);
      const created = await json(
        await wpFetch(endpoint(base, resource), {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        }),
      );
      if (String(created?.status || "").toLowerCase() !== "draft")
        throw new Error("WordPress non ha confermato la creazione della bozza corretta.");

      return res.json({
        ok: true,
        createdDraft: true,
        sourceId: entityId,
        sourceStatus: currentStatus || "unknown",
        sourceUrl: String(url || current?.link || ""),
        resource,
        id: Number(created.id),
        link: String(url || current?.link || ""),
        draftLink: created?.link || "",
        changed: Object.keys(patch),
        before: {
          title: rawField(current?.title),
          content: rawField(current?.content),
          excerpt: rawField(current?.excerpt),
          slug: current?.slug || "",
        },
        after: {
          title: rawField(created?.title),
          content: rawField(created?.content),
          excerpt: rawField(created?.excerpt),
          slug: created?.slug || "",
        },
        status: "draft",
        message: "Bozza WordPress corretta creata. Il contenuto pubblicato originale non è stato modificato.",
      });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Creazione bozza corretta non riuscita.",
      });
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
