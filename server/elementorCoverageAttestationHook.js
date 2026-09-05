import { randomUUID } from "node:crypto";
import { basePath, safeBase } from "./wordpressInspectFastHook.js";
import { inspectElementorPublicCoverage } from "./elementorPublicCoverageHook.js";
import {
  reconcileAuthoritativeInventoryWithPublicCoverage,
  validateAuthoritativeWordPressInventory,
} from "./elementorWordPressInventory.js";
import { registerElementorCoverageAttestation } from "./elementorCoverageRegistry.js";

const ROUTE = "/api/wordpress/elementor-coverage-attest";

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
    try {
      const result = await attestElementorCoverage(req.body || {});
      res.json(result);
    } catch (error) {
      res.status(400).json({
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

export { ROUTE as ELEMENTOR_COVERAGE_ATTESTATION_ROUTE, inventoryEndpoint };
