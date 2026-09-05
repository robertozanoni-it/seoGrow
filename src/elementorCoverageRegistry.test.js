import test from "node:test";
import assert from "node:assert/strict";
import {
  elementorCoverageRegistrySizeForTests,
  registerElementorCoverageAttestation,
  resetElementorCoverageRegistryForTests,
  resolveElementorCoverageAttestation,
  revokeElementorCoverageAttestation,
} from "../server/elementorCoverageRegistry.js";

test.beforeEach(() => resetElementorCoverageRegistryForTests());

const discoveryProof = (totalUrls, overrides = {}) => ({
  method: "crawl+sitemap-reconciled",
  discoveredUrls: totalUrls,
  inspectedUrls: totalUrls,
  failedUrls: 0,
  truncated: false,
  sitemapReconciled: true,
  queueExhausted: true,
  ...overrides,
});

const validRegistration = (overrides = {}) => ({
  provenanceId: "crawl-valid",
  siteUrl: "https://example.com",
  totalUrls: 3,
  complete: true,
  verified: true,
  discoveryProof: discoveryProof(3),
  ...overrides,
});

test("registro accetta solo crawl completi verificati dal backend", () => {
  assert.throws(() => registerElementorCoverageAttestation(validRegistration({ verified: false })), /completi e verificati/i);
  assert.throws(() => registerElementorCoverageAttestation(validRegistration({ siteUrl: "http://example.com" })), /HTTPS valido/i);
});

test("registro rifiuta discovery non riconciliata, troncata o con errori", () => {
  assert.throws(() => registerElementorCoverageAttestation(validRegistration({
    discoveryProof: discoveryProof(3, { method: "link-crawl-only" }),
  })), /crawl\+sitemap/i);

  assert.throws(() => registerElementorCoverageAttestation(validRegistration({
    discoveryProof: discoveryProof(3, { sitemapReconciled: false }),
  })), /non è completa/i);

  assert.throws(() => registerElementorCoverageAttestation(validRegistration({
    discoveryProof: discoveryProof(3, { truncated: true }),
  })), /troncata/i);

  assert.throws(() => registerElementorCoverageAttestation(validRegistration({
    discoveryProof: discoveryProof(3, { failedUrls: 1 }),
  })), /URL fallite/i);
});

test("URL scoperte e ispezionate devono coincidere con il totale attestato", () => {
  assert.throws(() => registerElementorCoverageAttestation(validRegistration({
    discoveryProof: discoveryProof(3, { discoveredUrls: 4 }),
  })), /coincidere con il totale/i);

  assert.throws(() => registerElementorCoverageAttestation(validRegistration({
    discoveryProof: discoveryProof(3, { inspectedUrls: 2 }),
  })), /coincidere con il totale/i);
});

test("attestazione è legata all'host del sito", () => {
  registerElementorCoverageAttestation(validRegistration({
    provenanceId: "crawl-2",
    siteUrl: "https://www.example.com",
    totalUrls: 4,
    discoveryProof: discoveryProof(4),
    now: 1_000,
  }));

  const sameHost = resolveElementorCoverageAttestation({
    provenanceId: "crawl-2",
    siteUrl: "https://example.com/percorso/",
    now: 1_001,
  });
  assert.deepEqual(sameHost, {
    verified: true,
    provenanceId: "crawl-2",
    totalUrls: 4,
    source: "server-crawl-registry",
  });

  assert.equal(resolveElementorCoverageAttestation({
    provenanceId: "crawl-2",
    siteUrl: "https://evil.example.net",
    now: 1_001,
  }), null);
});

test("attestazioni scadute vengono rifiutate e rimosse", () => {
  registerElementorCoverageAttestation(validRegistration({
    provenanceId: "crawl-3",
    totalUrls: 2,
    discoveryProof: discoveryProof(2),
    now: 10_000,
    ttlMs: 60_000,
  }));
  assert.equal(elementorCoverageRegistrySizeForTests(10_001), 1);
  assert.equal(resolveElementorCoverageAttestation({
    provenanceId: "crawl-3",
    siteUrl: "https://example.com",
    now: 70_001,
  }), null);
  assert.equal(elementorCoverageRegistrySizeForTests(70_001), 0);
});

test("revoca rende immediatamente inutilizzabile la provenance", () => {
  registerElementorCoverageAttestation(validRegistration({
    provenanceId: "crawl-4",
    totalUrls: 1,
    discoveryProof: discoveryProof(1),
  }));
  assert.equal(revokeElementorCoverageAttestation("crawl-4"), true);
  assert.equal(resolveElementorCoverageAttestation({
    provenanceId: "crawl-4",
    siteUrl: "https://example.com",
  }), null);
});
