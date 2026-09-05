import { basePath, safeBase } from "./wordpressInspectFastHook.js";
import {
  aggregateElementorReferenceImpact,
  scanElementorExplicitReferences,
} from "./elementorReferenceImpact.js";
import { validateAuthoritativeWordPressInventory } from "./elementorWordPressInventory.js";

const ROUTE = "/api/wordpress/elementor-reference-impact";
const SUPPORTED_REST_POST_TYPES = new Set(["page", "post"]);

function authHeaders(username, password) {
  return {
    authorization: `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`,
    accept: "application/json",
    "content-type": "application/json",
    "user-agent": "seoGrowAI/1.4-wordpress-remediation",
  };
}

function connectorInventoryEndpoint(base) {
  return new URL(`${basePath(base)}/wp-json/seogrow/v1/wordpress-public-inventory`, base.origin);
}

function contentEndpoint(base, resource) {
  const restBase = resource.postType === "page" ? "pages" : "posts";
  return new URL(`${basePath(base)}/wp-json/wp/v2/${restBase}/${resource.id}?context=edit`, base.origin);
}

async function wpFetch(url, options = {}) {
  const response = await fetch(url, {
    redirect: "manual",
    ...options,
    signal: AbortSignal.timeout(20_000),
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    await response.body?.cancel();
    throw new Error("WordPress ha restituito un redirect inatteso durante la scansione riferimenti Elementor.");
  }
  return response;
}

async function readJson(response, label) {
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`${label}: risposta JSON non valida (HTTP ${response.status}).`, { cause: error });
  }
  if (!response.ok) {
    throw new Error(`${label}: ${data?.message || data?.code || `HTTP ${response.status}`}`);
  }
  return data;
}

export function extractRestElementorData(payload) {
  if (!payload || typeof payload !== "object" || !payload.meta || typeof payload.meta !== "object") {
    return { ok: false, status: "elementor-meta-unavailable", value: null };
  }
  if (!Object.prototype.hasOwnProperty.call(payload.meta, "_elementor_data")) {
    return { ok: false, status: "elementor-meta-not-exposed", value: null };
  }
  const value = payload.meta._elementor_data;
  if (value === "" || value === null) {
    return { ok: true, status: "no-elementor-data", value: [] };
  }
  if (typeof value !== "string" && !Array.isArray(value) && !(value && typeof value === "object")) {
    return { ok: false, status: "elementor-meta-invalid-type", value: null };
  }
  return { ok: true, status: "elementor-data-readable", value };
}

export async function inspectElementorReferenceImpact({
  siteUrl,
  username,
  applicationPassword,
} = {}) {
  if (!siteUrl || !username || !applicationPassword) {
    throw new Error("URL sito, username e password applicazione WordPress sono obbligatori.");
  }

  const base = await safeBase(siteUrl);
  const headers = authHeaders(username, applicationPassword);
  const inventoryResponse = await wpFetch(connectorInventoryEndpoint(base), { headers });
  const rawInventory = await readJson(inventoryResponse, "WordPress inventory");
  const inventory = validateAuthoritativeWordPressInventory(rawInventory, { siteUrl: base.href });

  if (inventory.verified !== true) {
    return {
      ok: true,
      readOnly: true,
      verified: false,
      inventory,
      unsupportedPostTypes: [],
      affectedPagesEnumerated: false,
      sharedWriteAllowed: false,
      status: "authoritative-inventory-unavailable",
    };
  }

  const unsupportedPostTypes = [...new Set(
    inventory.resources
      .map((resource) => resource.postType)
      .filter((postType) => !SUPPORTED_REST_POST_TYPES.has(postType)),
  )].sort();

  if (unsupportedPostTypes.length > 0) {
    return {
      ok: true,
      readOnly: true,
      verified: false,
      inventory,
      unsupportedPostTypes,
      affectedPagesEnumerated: false,
      sharedWriteAllowed: false,
      status: "unsupported-authoritative-post-types",
      note: "La scansione cross-page corrente supporta solo page e post esposti dal Connector 1.3.0. I custom post type restano fail-closed.",
    };
  }

  const rows = [];
  for (const resource of inventory.resources) {
    try {
      const response = await wpFetch(contentEndpoint(base, resource), { headers });
      const payload = await readJson(response, `WordPress ${resource.postType}:${resource.id}`);
      const extracted = extractRestElementorData(payload);
      if (!extracted.ok) {
        rows.push({
          sourceId: resource.id,
          sourceUrl: resource.url,
          scan: {
            ok: false,
            status: extracted.status,
            malformed: false,
            truncated: false,
            references: [],
            sharedWriteAllowed: false,
          },
        });
        continue;
      }
      rows.push({
        sourceId: resource.id,
        sourceUrl: resource.url,
        scan: scanElementorExplicitReferences(extracted.value),
      });
    } catch (error) {
      rows.push({
        sourceId: resource.id,
        sourceUrl: resource.url,
        scan: {
          ok: false,
          status: "document-read-failed",
          malformed: false,
          truncated: false,
          references: [],
          error: error?.message || "Lettura documento WordPress non riuscita.",
          sharedWriteAllowed: false,
        },
      });
    }
  }

  const impact = aggregateElementorReferenceImpact(rows, {
    expectedDocuments: inventory.resources.length,
  });

  return {
    ok: true,
    readOnly: true,
    verified: impact.complete === true,
    inventory,
    impact,
    unsupportedPostTypes: [],
    affectedPagesEnumerated: impact.affectedPagesEnumerated === true,
    sharedWriteAllowed: false,
    status: impact.complete ? "verified-read-only-cross-page-impact" : "incomplete-cross-page-impact",
  };
}

export function registerRoutes(app) {
  app.post(ROUTE, async (req, res) => {
    try {
      const result = await inspectElementorReferenceImpact(req.body || {});
      res.json(result);
    } catch (error) {
      res.status(400).json({
        ok: false,
        readOnly: true,
        verified: false,
        error: error?.message || "Scansione riferimenti Elementor non riuscita.",
        affectedPagesEnumerated: false,
        sharedWriteAllowed: false,
      });
    }
  });
}

export {
  ROUTE as ELEMENTOR_REFERENCE_IMPACT_ROUTE,
  connectorInventoryEndpoint,
  contentEndpoint,
};
