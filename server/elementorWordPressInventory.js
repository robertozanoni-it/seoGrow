const MAX_AUTHORITATIVE_RESOURCES = 30;
const ALLOWED_STATUSES = new Set(["publish"]);

const normalizedHost = (hostname) => String(hostname || "").toLowerCase().replace(/^www\./, "");

function normalizePublicUrl(value, siteUrl) {
  try {
    const site = new URL(String(siteUrl || ""));
    const url = new URL(String(value || ""), site);
    if (url.protocol !== "https:") return "";
    if (normalizedHost(url.hostname) !== normalizedHost(site.hostname)) return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function safePositiveInt(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalizeResource(item, siteUrl) {
  if (!item || typeof item !== "object") return null;
  const id = safePositiveInt(item.id);
  const postType = String(item.postType || "").trim().toLowerCase().slice(0, 80);
  const status = String(item.status || "").trim().toLowerCase();
  const url = normalizePublicUrl(item.url, siteUrl);
  if (!id || !postType || !ALLOWED_STATUSES.has(status) || !url) return null;
  return { id, postType, status, url };
}

export function validateAuthoritativeWordPressInventory(payload, { siteUrl, maxResources = MAX_AUTHORITATIVE_RESOURCES } = {}) {
  const source = String(payload?.source || "");
  const readOnly = payload?.readOnly === true;
  const complete = payload?.complete === true;
  const truncated = payload?.truncated === true;
  const connectorVersion = String(payload?.connectorVersion || "").trim();
  const inventoryScope = String(payload?.inventoryScope || "");
  const total = safePositiveInt(payload?.totalResources);
  const rawResources = Array.isArray(payload?.resources) ? payload.resources : [];
  const limit = Number.isSafeInteger(Number(maxResources)) && Number(maxResources) > 0
    ? Number(maxResources)
    : MAX_AUTHORITATIVE_RESOURCES;

  const resources = [];
  const identityKeys = new Set();
  let invalidResources = 0;
  let duplicateResources = 0;
  for (const raw of rawResources) {
    const item = normalizeResource(raw, siteUrl);
    if (!item) {
      invalidResources += 1;
      continue;
    }
    const key = `${item.postType}:${item.id}`;
    if (identityKeys.has(key)) {
      duplicateResources += 1;
      continue;
    }
    identityKeys.add(key);
    resources.push(item);
  }

  const contractTrusted =
    source === "seogrow-connector" &&
    readOnly &&
    inventoryScope === "all-public-queryable-post-types" &&
    /^1\.3(?:\.|$)/.test(connectorVersion);
  const overLimit = rawResources.length > limit || (total !== null && total > limit);
  const countMatches = total !== null && total === rawResources.length && resources.length === rawResources.length;
  const verified =
    contractTrusted &&
    complete &&
    !truncated &&
    !overLimit &&
    invalidResources === 0 &&
    duplicateResources === 0 &&
    countMatches &&
    resources.length > 0;

  let status = "invalid-contract";
  let reason = "Il payload non proviene da un contratto Connector autorevole e read-only supportato.";
  if (contractTrusted && (truncated || overLimit)) {
    status = "truncated";
    reason = "L’inventario WordPress supera il limite supportato o risulta troncato.";
  } else if (contractTrusted && !complete) {
    status = "incomplete";
    reason = "Il Connector non dichiara completo l’inventario WordPress.";
  } else if (contractTrusted && (invalidResources > 0 || duplicateResources > 0)) {
    status = "invalid-resources";
    reason = "L’inventario contiene risorse non valide o identità duplicate.";
  } else if (contractTrusted && !countMatches) {
    status = "count-mismatch";
    reason = "Il totale dichiarato non coincide esattamente con le risorse restituite.";
  } else if (verified) {
    status = "verified-authoritative";
    reason = "Il Connector ha restituito un inventario completo, read-only e coerente delle risorse pubbliche WordPress supportate.";
  }

  return {
    verified,
    authoritative: verified,
    status,
    reason,
    source,
    connectorVersion,
    inventoryScope,
    complete,
    truncated: truncated || overLimit,
    totalResources: total,
    resources,
    invalidResources,
    duplicateResources,
    countMatches,
    maxResources: limit,
    sharedWriteAllowed: false,
  };
}

export function reconcileAuthoritativeInventoryWithPublicCoverage(inventory, publicCoverage) {
  if (inventory?.verified !== true || publicCoverage?.publicCoverageReconciled !== true) {
    return {
      verified: false,
      status: "evidence-incomplete",
      reason: "Servono sia inventario WordPress autorevole sia coverage pubblica riconciliata.",
      publicUrlsOutsideInventory: [],
      inventoryUrlsMissingFromPublicCoverage: [],
      sharedWriteAllowed: false,
    };
  }

  const inventoryUrls = new Set((inventory.resources || []).map((item) => item.url));
  const publicUrls = new Set(Array.isArray(publicCoverage.sitemapUrls) ? publicCoverage.sitemapUrls : []);
  const publicUrlsOutsideInventory = [...publicUrls].filter((url) => !inventoryUrls.has(url)).toSorted();
  const inventoryUrlsMissingFromPublicCoverage = [...inventoryUrls].filter((url) => !publicUrls.has(url)).toSorted();
  const exactMatch = publicUrlsOutsideInventory.length === 0 && inventoryUrlsMissingFromPublicCoverage.length === 0;

  let status = "verified-complete";
  let reason = "Inventario WordPress autorevole e coverage pubblica coincidono esattamente.";
  if (publicUrlsOutsideInventory.length > 0) {
    status = "public-routes-outside-post-type-inventory";
    reason = "La coverage pubblica contiene URL che non appartengono all’inventario dei post type pubblici/queryable. Possono includere tassonomie, archivi o route custom: la completezza globale resta non attestabile.";
  } else if (inventoryUrlsMissingFromPublicCoverage.length > 0) {
    status = "inventory-routes-missing-from-public-coverage";
    reason = "Una o più risorse WordPress pubblicate dell’inventario autorevole non compaiono nella coverage pubblica riconciliata.";
  }

  return {
    verified: exactMatch,
    status,
    reason,
    totalUrls: inventoryUrls.size,
    publicUrlCount: publicUrls.size,
    publicUrlsOutsideInventory,
    inventoryUrlsMissingFromPublicCoverage,
    scope: {
      inventory: "all-public-queryable-post-types",
      publicCoverage: "sitemap-and-crawl-public-routes",
      globallyComplete: exactMatch,
    },
    sharedWriteAllowed: false,
  };
}

export { MAX_AUTHORITATIVE_RESOURCES as ELEMENTOR_AUTHORITATIVE_INVENTORY_MAX_RESOURCES };
