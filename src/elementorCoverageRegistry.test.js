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

test("registro accetta solo crawl completi verificati dal backend", () => {
  assert.throws(() => registerElementorCoverageAttestation({
    provenanceId: "crawl-1",
    siteUrl: "https://example.com",
    totalUrls: 3,
    complete: true,
    verified: false,
  }), /completi e verificati/i);

  assert.throws(() => registerElementorCoverageAttestation({
    provenanceId: "crawl-1",
    siteUrl: "http://example.com",
    totalUrls: 3,
    complete: true,
    verified: true,
  }), /HTTPS valido/i);
});

test("attestazione è legata all'host del sito", () => {
  registerElementorCoverageAttestation({
    provenanceId: "crawl-2",
    siteUrl: "https://www.example.com",
    totalUrls: 4,
    complete: true,
    verified: true,
    now: 1_000,
  });

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
  registerElementorCoverageAttestation({
    provenanceId: "crawl-3",
    siteUrl: "https://example.com",
    totalUrls: 2,
    complete: true,
    verified: true,
    now: 10_000,
    ttlMs: 60_000,
  });
  assert.equal(elementorCoverageRegistrySizeForTests(10_001), 1);
  assert.equal(resolveElementorCoverageAttestation({
    provenanceId: "crawl-3",
    siteUrl: "https://example.com",
    now: 70_001,
  }), null);
  assert.equal(elementorCoverageRegistrySizeForTests(70_001), 0);
});

test("revoca rende immediatamente inutilizzabile la provenance", () => {
  registerElementorCoverageAttestation({
    provenanceId: "crawl-4",
    siteUrl: "https://example.com",
    totalUrls: 1,
    complete: true,
    verified: true,
  });
  assert.equal(revokeElementorCoverageAttestation("crawl-4"), true);
  assert.equal(resolveElementorCoverageAttestation({
    provenanceId: "crawl-4",
    siteUrl: "https://example.com",
  }), null);
});
