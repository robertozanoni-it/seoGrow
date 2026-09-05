import { pinnedHttpsFetch } from "./pinnedHttpsFetch.js";
import {
  ELEMENTOR_RECONCILIATION_MAX_URLS,
  extractSitemapLocs,
  normalizeCoverageUrl,
  reconcileElementorCoverage,
} from "./elementorCoverageReconciliation.js";

const ROUTE = "/api/wordpress/elementor-public-coverage";
const MAX_SITEMAPS = 10;

const sameSiteUrl = (value, siteUrl) => normalizeCoverageUrl(value, siteUrl);

async function fetchText(url, { maxBytes = 2 * 1024 * 1024, timeout = 15_000 } = {}) {
  const response = await pinnedHttpsFetch(url, {
    timeout,
    maxBytes,
    headers: {
      accept: "application/xml,text/xml,text/html;q=0.8,*/*;q=0.2",
      "user-agent": "seoGrowAI/1.4-elementor-public-coverage",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} per ${url}`);
  return await response.text();
}

function extractInternalLinks(html, pageUrl, siteUrl) {
  const source = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(?:script|style|template|noscript)\b[^>]*>[\s\S]*?<\/(?:script|style|template|noscript)>/gi, " ");
  const urls = new Set();
  for (const match of source.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const raw = String(match[1] || "").trim();
    if (!raw || /^(?:#|mailto:|tel:|javascript:|data:)/i.test(raw)) continue;
    try {
      const absolute = new URL(raw, pageUrl).href;
      const normalized = sameSiteUrl(absolute, siteUrl);
      if (normalized) urls.add(normalized);
    } catch {
      // URL malformata: non diventa evidenza.
    }
  }
  return [...urls];
}

async function readSitemapTree(siteUrl, explicitSitemapUrl = "") {
  const site = new URL(siteUrl);
  const initialCandidates = explicitSitemapUrl
    ? [sameSiteUrl(explicitSitemapUrl, siteUrl)]
    : [
        new URL("/sitemap.xml", site).href,
        new URL("/sitemap_index.xml", site).href,
      ];
  const pending = initialCandidates.filter(Boolean);
  const fetched = new Set();
  const pageUrls = new Set();
  const failures = [];

  while (pending.length && fetched.size < MAX_SITEMAPS) {
    const sitemapUrl = pending.shift();
    if (!sitemapUrl || fetched.has(sitemapUrl)) continue;
    fetched.add(sitemapUrl);
    try {
      const xml = await fetchText(sitemapUrl);
      const locs = extractSitemapLocs(xml, siteUrl, {
        maxUrls: ELEMENTOR_RECONCILIATION_MAX_URLS + MAX_SITEMAPS + 1,
      });
      if (/<sitemapindex\b/i.test(xml)) {
        for (const loc of locs) {
          if (pending.length + fetched.size >= MAX_SITEMAPS) break;
          if (!fetched.has(loc)) pending.push(loc);
        }
      } else if (/<urlset\b/i.test(xml)) {
        for (const loc of locs) pageUrls.add(loc);
      } else {
        failures.push({ url: sitemapUrl, reason: "Formato sitemap non riconosciuto" });
      }
    } catch (error) {
      failures.push({ url: sitemapUrl, reason: error?.message || "Sitemap non leggibile" });
      if (!explicitSitemapUrl && fetched.size === 1 && pending.length) continue;
    }
  }

  return {
    sitemapUrls: [...pageUrls],
    sitemapFiles: [...fetched],
    failures,
    truncated: pending.length > 0 || pageUrls.size > ELEMENTOR_RECONCILIATION_MAX_URLS,
  };
}

export async function inspectElementorPublicCoverage({ siteUrl, sitemapUrl = "" } = {}) {
  const normalizedSite = sameSiteUrl(siteUrl, siteUrl);
  if (!normalizedSite) throw new Error("siteUrl HTTPS pubblico valido obbligatorio.");

  const sitemap = await readSitemapTree(normalizedSite, sitemapUrl);
  const candidateUrls = sitemap.sitemapUrls.slice(0, ELEMENTOR_RECONCILIATION_MAX_URLS);
  const crawledUrls = [];
  const discoveredUrls = new Set(candidateUrls);
  const failures = [...sitemap.failures];

  for (const url of candidateUrls) {
    try {
      const html = await fetchText(url, { maxBytes: 8 * 1024 * 1024, timeout: 15_000 });
      crawledUrls.push(url);
      for (const discovered of extractInternalLinks(html, url, normalizedSite)) {
        discoveredUrls.add(discovered);
      }
    } catch (error) {
      failures.push({ url, reason: error?.message || "Pagina non ispezionabile" });
    }
  }

  const reconciliation = reconcileElementorCoverage({
    siteUrl: normalizedSite,
    sitemapUrls: sitemap.sitemapUrls,
    crawledUrls,
    discoveredUrls: [...discoveredUrls],
    failures,
    queueDrained: true,
    sitemapReconciled: sitemap.sitemapUrls.length > 0 && sitemap.failures.length === 0,
    truncated: sitemap.truncated,
  });

  return {
    ok: true,
    readOnly: true,
    siteUrl: normalizedSite,
    sitemapFiles: sitemap.sitemapFiles,
    sitemapUrls: sitemap.sitemapUrls,
    crawledUrls,
    discoveredUrls: [...discoveredUrls],
    failures,
    publicCoverageReconciled: reconciliation.verified,
    reconciliation,
    authoritativeWordPressInventoryVerified: false,
    completeSiteEnumeration: false,
    affectedPagesEnumerated: false,
    sharedWriteAllowed: false,
    note: reconciliation.verified
      ? "Coverage pubblica sitemap+crawl riconciliata. Non equivale ancora a inventario WordPress autorevole: completeSiteEnumeration resta false."
      : reconciliation.reason,
  };
}

export function registerRoutes(app) {
  app.post(ROUTE, async (req, res) => {
    try {
      const result = await inspectElementorPublicCoverage(req.body || {});
      res.json(result);
    } catch (error) {
      res.status(400).json({
        ok: false,
        readOnly: true,
        error: error?.message || "Verifica coverage pubblica Elementor non riuscita.",
        completeSiteEnumeration: false,
        affectedPagesEnumerated: false,
        sharedWriteAllowed: false,
      });
    }
  });
}

export { ROUTE as ELEMENTOR_PUBLIC_COVERAGE_ROUTE, extractInternalLinks, readSitemapTree };
