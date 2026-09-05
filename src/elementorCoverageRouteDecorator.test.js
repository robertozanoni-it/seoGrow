import test from "node:test";
import assert from "node:assert/strict";
import {
  finalizeElementorImpactCoverage,
  registerElementorImpactRoutesWithCoverage,
} from "../server/elementorCoverageRouteDecorator.js";
import {
  registerElementorCoverageAttestation,
  resetElementorCoverageRegistryForTests,
} from "../server/elementorCoverageRegistry.js";

test.beforeEach(() => resetElementorCoverageRegistryForTests());

const discoveryProof = (totalUrls) => ({
  method: "crawl+sitemap-reconciled",
  discoveredUrls: totalUrls,
  inspectedUrls: totalUrls,
  failedUrls: 0,
  truncated: false,
  sitemapReconciled: true,
  queueExhausted: true,
});

const registerTrusted = (siteUrl = "https://example.com") => registerElementorCoverageAttestation({
  provenanceId: "crawl-verified-1",
  siteUrl,
  totalUrls: 3,
  complete: true,
  verified: true,
  discoveryProof: discoveryProof(3),
});

const basePayload = (overrides = {}) => ({
  ok: true,
  readOnly: true,
  displayConditionsResolved: true,
  observedUrlCoverage: {
    provided: 3,
    accepted: 3,
    inspected: 3,
    failed: 0,
    completeSiteEnumeration: false,
  },
  documents: [{
    id: 88,
    ok: true,
    type: "header",
    displayConditionsResolved: true,
    affectedPagesEnumerated: false,
    sharedWriteAllowed: false,
    observedCandidateCoverage: { inspected: 3, failed: 0, candidateUrls: 3, completeSiteEnumeration: false },
  }],
  affectedPagesEnumerated: false,
  sharedWriteAllowed: false,
  ...overrides,
});

const verifiedRequest = () => ({
  siteUrl: "https://example.com",
  candidateUrls: [
    "https://example.com/",
    "https://example.com/a/",
    "https://example.com/b/",
  ],
  coverageProof: {
    source: "verified-complete-crawl",
    totalUrls: 3,
    complete: true,
    verified: true,
    provenanceId: "crawl-verified-1",
  },
});

test("claim client senza attestazione server resta non completo", () => {
  const result = finalizeElementorImpactCoverage(basePayload(), verifiedRequest());
  assert.equal(result.observedUrlCoverage.completeSiteEnumeration, false);
  assert.equal(result.observedUrlCoverage.coverageStatus, "server-verification-missing");
  assert.equal(result.affectedPagesEnumerated, false);
  assert.equal(result.documents[0].affectedPagesEnumerated, false);
  assert.equal(result.sharedWriteAllowed, false);
});

test("attestazione server valida promuove solo l'enumerazione, mai la scrittura condivisa", () => {
  registerTrusted();
  const result = finalizeElementorImpactCoverage(basePayload(), verifiedRequest());
  assert.equal(result.observedUrlCoverage.completeSiteEnumeration, true);
  assert.equal(result.observedUrlCoverage.coverageStatus, "verified-complete");
  assert.equal(result.observedUrlCoverage.serverVerified, true);
  assert.equal(result.observedUrlCoverage.provenanceMatches, true);
  assert.equal(result.affectedPagesEnumerated, true);
  assert.equal(result.documents[0].affectedPagesEnumerated, true);
  assert.equal(result.documents[0].sharedWriteAllowed, false);
  assert.equal(result.sharedWriteAllowed, false);
});

test("coverage completa non basta se le Display Conditions restano non risolte", () => {
  registerTrusted();
  const result = finalizeElementorImpactCoverage(basePayload({
    displayConditionsResolved: false,
    documents: [{
      id: 88,
      ok: true,
      displayConditionsResolved: false,
      sharedWriteAllowed: false,
      affectedPagesEnumerated: false,
    }],
  }), verifiedRequest());
  assert.equal(result.observedUrlCoverage.completeSiteEnumeration, true);
  assert.equal(result.affectedPagesEnumerated, false);
  assert.equal(result.documents[0].affectedPagesEnumerated, false);
  assert.equal(result.sharedWriteAllowed, false);
});

test("host diverso non può riutilizzare la provenance di un altro sito", () => {
  registerTrusted();
  const request = verifiedRequest();
  request.siteUrl = "https://other.example.net";
  const result = finalizeElementorImpactCoverage(basePayload(), request);
  assert.equal(result.observedUrlCoverage.completeSiteEnumeration, false);
  assert.equal(result.observedUrlCoverage.coverageStatus, "server-verification-missing");
});

test("decoratore registra solo la route Elementor e ripristina esattamente app.post", async () => {
  const registrations = [];
  const app = {
    post(path, ...handlers) {
      registrations.push({ path, handlers });
      return this;
    },
  };
  const originalPost = app.post;
  const firstMiddleware = (_req, _res, next) => next();
  const finalHandler = (_req, res) => res.json(basePayload());
  const module = {
    registerRoutes(target) {
      target.post("/api/wordpress/elementor-impact-inspect", firstMiddleware, finalHandler);
      target.post("/api/wordpress/not-elementor", finalHandler);
    },
  };

  registerElementorImpactRoutesWithCoverage(app, module);
  assert.equal(registrations.length, 2);
  assert.equal(registrations[0].path, "/api/wordpress/elementor-impact-inspect");
  assert.equal(registrations[1].path, "/api/wordpress/not-elementor");
  assert.equal(registrations[0].handlers[0], firstMiddleware);
  assert.notEqual(registrations[0].handlers[1], finalHandler);
  assert.equal(registrations[1].handlers[0], finalHandler);
  assert.equal(app.post, originalPost);

  let jsonPayload = null;
  const res = { json(payload) { jsonPayload = payload; return payload; } };
  await registrations[0].handlers[1]({ body: verifiedRequest() }, res, () => {});
  assert.equal(jsonPayload.sharedWriteAllowed, false);
  assert.equal(jsonPayload.affectedPagesEnumerated, false);
});
