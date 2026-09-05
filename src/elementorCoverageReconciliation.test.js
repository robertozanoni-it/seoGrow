import test from "node:test";
import assert from "node:assert/strict";
import {
  extractSitemapLocs,
  normalizeCoverageUrl,
  reconcileElementorCoverage,
} from "../server/elementorCoverageReconciliation.js";

const siteUrl = "https://www.example.com";
const urls = [
  "https://example.com/",
  "https://example.com/a/",
  "https://example.com/b/",
];

test("normalizzazione coverage accetta solo HTTPS same-host", () => {
  assert.equal(normalizeCoverageUrl("https://example.com/a/#x", siteUrl), "https://example.com/a/");
  assert.equal(normalizeCoverageUrl("http://example.com/a/", siteUrl), "");
  assert.equal(normalizeCoverageUrl("https://evil.example.net/a/", siteUrl), "");
});

test("parser sitemap deduplica loc e decodifica entity XML", () => {
  const xml = `<?xml version="1.0"?><urlset>
    <url><loc>https://example.com/</loc></url>
    <url><loc>https://www.example.com/a/?x=1&amp;y=2</loc></url>
    <url><loc>https://example.com/</loc></url>
    <url><loc>https://evil.example.net/</loc></url>
  </urlset>`;
  assert.deepEqual(extractSitemapLocs(xml, siteUrl), [
    "https://example.com/",
    "https://www.example.com/a/?x=1&y=2",
  ]);
});

test("coverage completa richiede uguaglianza esatta tra sitemap, crawl e discovery", () => {
  const result = reconcileElementorCoverage({
    siteUrl,
    sitemapUrls: urls,
    crawledUrls: urls,
    discoveredUrls: urls,
    failures: [],
    queueDrained: true,
    sitemapReconciled: true,
    truncated: false,
  });
  assert.equal(result.verified, true);
  assert.equal(result.status, "verified-complete");
  assert.equal(result.discoveryMethod, "crawl+sitemap-reconciled");
  assert.equal(result.totalUrls, 3);
});

test("URL interna scoperta ma assente dalla sitemap blocca l'attestazione", () => {
  const result = reconcileElementorCoverage({
    siteUrl,
    sitemapUrls: urls,
    crawledUrls: urls,
    discoveredUrls: [...urls, "https://example.com/hidden/"],
    queueDrained: true,
    sitemapReconciled: true,
  });
  assert.equal(result.verified, false);
  assert.equal(result.status, "undocumented-discovery");
});

test("sitemap non interamente ispezionata resta mismatch", () => {
  const result = reconcileElementorCoverage({
    siteUrl,
    sitemapUrls: urls,
    crawledUrls: urls.slice(0, 2),
    discoveredUrls: urls,
    queueDrained: true,
    sitemapReconciled: true,
  });
  assert.equal(result.verified, false);
  assert.equal(result.status, "set-mismatch");
});

test("errori, coda residua e truncation falliscono chiusi", () => {
  assert.equal(reconcileElementorCoverage({
    siteUrl,
    sitemapUrls: urls,
    crawledUrls: urls,
    discoveredUrls: urls,
    failures: [{ url: urls[2] }],
    queueDrained: true,
    sitemapReconciled: true,
  }).status, "crawl-failures");

  assert.equal(reconcileElementorCoverage({
    siteUrl,
    sitemapUrls: urls,
    crawledUrls: urls,
    discoveredUrls: urls,
    queueDrained: false,
    sitemapReconciled: true,
  }).status, "queue-not-drained");

  assert.equal(reconcileElementorCoverage({
    siteUrl,
    sitemapUrls: urls,
    crawledUrls: urls,
    discoveredUrls: urls,
    queueDrained: true,
    sitemapReconciled: true,
    truncated: true,
  }).status, "truncated");
});

test("più di 30 URL non può diventare coverage completa Elementor", () => {
  const large = Array.from({ length: 31 }, (_, index) => `https://example.com/p-${index}/`);
  const result = reconcileElementorCoverage({
    siteUrl,
    sitemapUrls: large,
    crawledUrls: large,
    discoveredUrls: large,
    queueDrained: true,
    sitemapReconciled: true,
  });
  assert.equal(result.verified, false);
  assert.equal(result.status, "truncated");
});
