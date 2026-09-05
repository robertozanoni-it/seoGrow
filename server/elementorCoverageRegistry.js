const DEFAULT_TTL_MS = 30 * 60_000;
const MAX_ENTRIES = 2_000;
const REGISTRY = new Map();

const safePositiveCount = (value) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};

const safeNonNegativeCount = (value) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
};

const cleanId = (value) => String(value || "").trim().slice(0, 200);

const cleanHost = (value) => {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.hostname.toLowerCase().replace(/^www\./, "") : "";
  } catch {
    return "";
  }
};

function normalizeDiscoveryProof(proof = {}) {
  return {
    method: String(proof?.method || "").trim().slice(0, 80),
    discoveredUrls: safePositiveCount(proof?.discoveredUrls),
    inspectedUrls: safePositiveCount(proof?.inspectedUrls),
    failedUrls: safeNonNegativeCount(proof?.failedUrls),
    truncated: proof?.truncated === true,
    sitemapReconciled: proof?.sitemapReconciled === true,
    queueExhausted: proof?.queueExhausted === true,
  };
}

function purgeExpired(now = Date.now()) {
  for (const [key, entry] of REGISTRY.entries()) {
    if (!entry || entry.expiresAt <= now) REGISTRY.delete(key);
  }
}

export function registerElementorCoverageAttestation({
  provenanceId,
  siteUrl,
  totalUrls,
  complete,
  verified,
  discoveryProof,
  now = Date.now(),
  ttlMs = DEFAULT_TTL_MS,
} = {}) {
  purgeExpired(now);
  const id = cleanId(provenanceId);
  const host = cleanHost(siteUrl);
  const total = safePositiveCount(totalUrls);
  const discovery = normalizeDiscoveryProof(discoveryProof);
  const ttl = Math.min(Math.max(Number(ttlMs) || DEFAULT_TTL_MS, 60_000), 24 * 60 * 60_000);
  if (!id) throw new Error("provenanceId crawl obbligatorio.");
  if (!host) throw new Error("siteUrl HTTPS valido obbligatorio per l'attestazione crawl.");
  if (total === null) throw new Error("totalUrls crawl deve essere un intero positivo.");
  if (complete !== true || verified !== true) {
    throw new Error("Solo crawl completi e verificati dal backend possono essere attestati.");
  }
  if (discovery.method !== "crawl+sitemap-reconciled") {
    throw new Error("L'attestazione richiede discovery crawl+sitemap riconciliata.");
  }
  if (!discovery.sitemapReconciled || !discovery.queueExhausted || discovery.truncated) {
    throw new Error("La discovery del sito non è completa o risulta troncata.");
  }
  if (discovery.failedUrls !== 0) {
    throw new Error("Una discovery con URL fallite non può attestare copertura completa.");
  }
  if (discovery.discoveredUrls !== total || discovery.inspectedUrls !== total) {
    throw new Error("Le URL scoperte e ispezionate devono coincidere con il totale attestato.");
  }

  const entry = Object.freeze({
    provenanceId: id,
    siteHost: host,
    totalUrls: total,
    complete: true,
    verified: true,
    source: "server-crawl-registry",
    discoveryProof: Object.freeze(discovery),
    createdAt: now,
    expiresAt: now + ttl,
  });
  REGISTRY.set(id, entry);

  if (REGISTRY.size > MAX_ENTRIES) {
    const oldest = [...REGISTRY.entries()]
      .toSorted((a, b) => (a[1]?.createdAt || 0) - (b[1]?.createdAt || 0));
    for (const [key] of oldest.slice(0, REGISTRY.size - MAX_ENTRIES)) REGISTRY.delete(key);
  }
  return entry;
}

export function resolveElementorCoverageAttestation({ provenanceId, siteUrl, now = Date.now() } = {}) {
  purgeExpired(now);
  const id = cleanId(provenanceId);
  const host = cleanHost(siteUrl);
  if (!id || !host) return null;
  const entry = REGISTRY.get(id);
  if (!entry || entry.siteHost !== host) return null;
  return {
    verified: true,
    provenanceId: entry.provenanceId,
    totalUrls: entry.totalUrls,
    source: entry.source,
  };
}

export function revokeElementorCoverageAttestation(provenanceId) {
  return REGISTRY.delete(cleanId(provenanceId));
}

export function resetElementorCoverageRegistryForTests() {
  REGISTRY.clear();
}

export function elementorCoverageRegistrySizeForTests(now = Date.now()) {
  purgeExpired(now);
  return REGISTRY.size;
}
