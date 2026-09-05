import { randomUUID } from "node:crypto";
import { basePath, safeBase } from "./wordpressInspectFastHook.js";
import { inspectElementorPublicCoverage } from "./elementorPublicCoverageHook.js";
import {
  reconcileAuthoritativeInventoryWithPublicCoverage,
  validateAuthoritativeWordPressInventory,
} from "./elementorWordPressInventory.js";
import { registerElementorCoverageAttestation } from "./elementorCoverageRegistry.js";

const ROUTE = "/api/wordpress/elementor-coverage-attest";
const RATE_WINDOW_MS = 10 * 60_000;
const RATE_MAX = 12;
const NEGATIVE_CACHE_TTL_MS = 30_000;
const RATE = new Map();
const NEGATIVE_CACHE = new Map();

function authHeaders(username, password) {
  return {
    authorization: `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`,
    accept: "application/json",
    "content-type": "application/json",
    "user-agent": "seoGrowAI/1.4-wordpress-remediation",
  };
}

function inventoryEndpoint(base) {
  return new URL(`${basePath(base)}/wp-json/seogrow/v1/wordpress-public-inventory`, base.origin);
}

async function wpFetch(url, options = {}) {
  const response = await fetch(url, {
    redirect: "manual",
    ...options,
    signal: AbortSignal.timeout(20_000),
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    await response.body?.cancel();
    throw new Error("WordPress ha restituito un redirect inatteso durante l'inventario pubblico.");
  }
  return response;
}

async function readJson(response) {
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`Risposta inventario WordPress non valida (HTTP ${response.status}).`, { cause: error });
  }
  if (!response.ok) {
    throw new Error(`WordPress inventory: ${data?.message || data?.code || `HTTP ${response.status}`}`);
  }
  return data;
}

function normalizedRequestHost(siteUrl) {
  try {
    const url = new URL(String(siteUrl || ""));
    return url.protocol === "https:" ? url.hostname.toLowerCase().replace(/^www\./, "") : "";
  } catch {
    return "";
  }
}

function requestClientIdentity(req) {
  return String(req?.ip || req?.socket?.remoteAddress || "unknown").slice(0, 200);
}

function rateKey(req) {
  return `${requestClientIdentity(req)}|${normalizedRequestHost(req?.body?.siteUrl) || "invalid-host"}`;
}

function checkRateLimit(req, now = Date.now()) {
  const key = rateKey(req);
  const current = RATE.get(key);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    RATE.set(key, { startedAt: now, count: 1 });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  current.count += 1;
  if (current.count <= RATE_MAX) return { allowed: true, retryAfterSeconds: 0 };
  const retryAfterSeconds = Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - current.startedAt)) / 1000));
  return { allowed: false, retryAfterSeconds };
}

function negativeCacheKey(body = {}) {
  const host = normalizedRequestHost(body?.siteUrl);
  if (!host) return "";
  const sitemapUrl = String(body?.sitemapUrl || "").trim().slice(0, 2_000);
  return `${host}|${sitemapUrl}`;
}

function readNegativeCache(body, now = Date.now()) {
  const key = negativeCacheKey(body);
  if (!key) return null;
  const entry = NEGATIVE_CACHE.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    NEGATIVE_CACHE.delete(key);
    return null;
  }
  return {
    ...entry.value,
    cached: true,
    cacheType: "short-lived-negative-diagnostic",
    cacheExpiresAt: new Date(entry.expiresAt).toISOString(),
    sharedWriteAllowed: false,
  };
}

function writeNegativeCache(body, value, now = Date.now()) {
  if (!value || value.verified === true || value.ok !== true) return;
  const key = negativeCacheKey(body);
  if (!key) return;
  NEGATIVE_CACHE.set(key, {
    expiresAt: now + NEGATIVE_CACHE_TTL_MS,
    value: {
      ...value,
      provenanceId: "",
      completeSiteEnumeration: false,
      affectedPagesEnumerated: false,
      sharedWriteAllowed: false,
    },
  });
}

export async function attestElementorCoverage({
  siteUrl,
  username,
  applicationPassword,
  sitemapUrl = "",
} = {}) {
  if (!siteUrl || !username || !applicationPassword) {
    throw new Error("URL sito, username e password applicazione WordPress sono obbligatori.");
  }

  const base = await safeBase(siteUrl);
  const headers = authHeaders(username, applicationPassword);
  const publicCoverage = await inspectElementorPublicCoverage({
    siteUrl: base.href,
    sitemapUrl,
  });

  const inventoryResponse = await wpFetch(inventoryEndpoint(base), { headers });
  const rawInventory = await readJson(inventoryResponse);
  const inventory = validateAuthoritativeWordPressInventory(rawInventory, {
    siteUrl: base.href,
  });
  const reconciliation = reconcileAuthoritativeInventoryWithPublicCoverage(
    inventory,
    publicCoverage,
  );

  if (reconciliation.verified !== true) {
    return {
      ok: true,
      readOnly: true,
      verified: false,
      provenanceId: "",
      publicCoverage,
      inventory,
      reconciliation,
      completeSiteEnumeration: false,
      affectedPagesEnumerated: false,
      sharedWriteAllowed: false,
    };
  }

  const publicProof = publicCoverage.reconciliation || {};
  const provenanceId = `elementor-coverage:${randomUUID()}`;
  const attestation = registerElementorCoverageAttestation({
    provenanceId,
    siteUrl: base.href,
    totalUrls: reconciliation.totalUrls,
    complete: true,
    verified: true,
    discoveryProof: {
      method: "crawl+sitemap-reconciled",
      discoveredUrls: publicProof.discoveredUrls,
      inspectedUrls: publicProof.inspectedUrls,
      failedUrls: publicProof.failedUrls,
      truncated: publicProof.truncated === true,
      sitemapReconciled: publicProof.sitemapReconciled === true,
      queueExhausted: publicProof.queueDrained === true,
    },
  });

  return {
    ok: true,
    readOnly: true,
    verified: true,
    provenanceId: attestation.provenanceId,
    candidateUrls: inventory.resources.map((resource) => resource.url),
    totalUrls: attestation.totalUrls,
    expiresAt: attestation.expiresAt,
    publicCoverage,
    inventory,
    reconciliation,
    completeSiteEnumeration: true,
    affectedPagesEnumerated: false,
    sharedWriteAllowed: false,
    note: "La completezza della coverage è attestata dal server. L'impatto dei singoli documenti Elementor resta soggetto a Display Conditions e ownership; la scrittura condivisa resta bloccata.",
  };
}

export function registerRoutes(app) {
  app.post(ROUTE, async (req, res) => {
    const rate = checkRateLimit(req);
    if (!rate.allowed) {
      res.set?.("Retry-After", String(rate.retryAfterSeconds));
      return res.status(429).json({
        ok: false,
        readOnly: true,
        verified: false,
        provenanceId: "",
        error: "Troppe richieste di attestazione Elementor per questo sito. Riprova dopo il periodo indicato.",
        retryAfterSeconds: rate.retryAfterSeconds,
        completeSiteEnumeration: false,
        affectedPagesEnumerated: false,
        sharedWriteAllowed: false,
      });
    }

    const cached = readNegativeCache(req.body || {});
    if (cached) return res.json(cached);

    try {
      const result = await attestElementorCoverage(req.body || {});
      writeNegativeCache(req.body || {}, result);
      return res.json(result);
    } catch (error) {
      return res.status(400).json({
        ok: false,
        readOnly: true,
        verified: false,
        provenanceId: "",
        error: error?.message || "Attestazione coverage Elementor non riuscita.",
        completeSiteEnumeration: false,
        affectedPagesEnumerated: false,
        sharedWriteAllowed: false,
      });
    }
  });
}

export {
  ROUTE as ELEMENTOR_COVERAGE_ATTESTATION_ROUTE,
  inventoryEndpoint,
  checkRateLimit,
  readNegativeCache,
  writeNegativeCache,
};
