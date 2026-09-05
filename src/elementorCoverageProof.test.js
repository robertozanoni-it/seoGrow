import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateElementorCoverageProof,
  normalizeElementorCoverageProof,
} from "../server/elementorCoverageProof.js";

test("coverage manuale resta parziale anche se tutte le URL sono state ispezionate", () => {
  const result = evaluateElementorCoverageProof({
    proof: { source: "manual-candidate-set", totalUrls: 3, complete: true, verified: true, provenanceId: "manual" },
    provided: 3,
    accepted: 3,
    inspected: 3,
    failed: 0,
  });
  assert.equal(result.completeSiteEnumeration, false);
  assert.equal(result.status, "partial");
  assert.equal(result.sharedWriteAllowed, false);
});

test("complete-crawl dichiarato ma non verificato non diventa enumerazione completa", () => {
  const result = evaluateElementorCoverageProof({
    proof: { source: "complete-crawl", totalUrls: 3, complete: true, verified: false, provenanceId: "crawl-123" },
    provided: 3,
    accepted: 3,
    inspected: 3,
    failed: 0,
  });
  assert.equal(result.completeSiteEnumeration, false);
  assert.equal(result.status, "declared-complete-unverified");
});

test("verified-complete-crawl richiede provenance e totale esatto", () => {
  const missingProvenance = evaluateElementorCoverageProof({
    proof: { source: "verified-complete-crawl", totalUrls: 3, complete: true, verified: true },
    provided: 3,
    accepted: 3,
    inspected: 3,
    failed: 0,
  });
  assert.equal(missingProvenance.completeSiteEnumeration, false);
  assert.equal(missingProvenance.status, "verification-missing");

  const mismatch = evaluateElementorCoverageProof({
    proof: { source: "verified-complete-crawl", totalUrls: 4, complete: true, verified: true, provenanceId: "crawl-456" },
    provided: 3,
    accepted: 3,
    inspected: 3,
    failed: 0,
  });
  assert.equal(mismatch.completeSiteEnumeration, false);
  assert.equal(mismatch.status, "count-mismatch");
});

test("URL rifiutate o fallite bloccano la completezza", () => {
  const rejected = evaluateElementorCoverageProof({
    proof: { source: "verified-complete-crawl", totalUrls: 3, complete: true, verified: true, provenanceId: "crawl-789" },
    provided: 3,
    accepted: 2,
    inspected: 2,
    failed: 0,
  });
  assert.equal(rejected.completeSiteEnumeration, false);
  assert.equal(rejected.status, "truncated");

  const failed = evaluateElementorCoverageProof({
    proof: { source: "verified-complete-crawl", totalUrls: 3, complete: true, verified: true, provenanceId: "crawl-789" },
    provided: 3,
    accepted: 3,
    inspected: 2,
    failed: 1,
  });
  assert.equal(failed.completeSiteEnumeration, false);
  assert.equal(failed.status, "inspection-incomplete");
});

test("set oltre il limite tecnico non può mai risultare completo", () => {
  const result = evaluateElementorCoverageProof({
    proof: { source: "verified-complete-crawl", totalUrls: 31, complete: true, verified: true, provenanceId: "crawl-large" },
    provided: 31,
    accepted: 30,
    inspected: 30,
    failed: 0,
  });
  assert.equal(result.truncated, true);
  assert.equal(result.completeSiteEnumeration, false);
  assert.equal(result.status, "truncated");
});

test("solo coverage verificata, esatta e interamente ispezionata diventa completa", () => {
  const result = evaluateElementorCoverageProof({
    proof: { source: "verified-complete-crawl", totalUrls: 3, complete: true, verified: true, provenanceId: "crawl-proof-001" },
    provided: 3,
    accepted: 3,
    inspected: 3,
    failed: 0,
  });
  assert.equal(result.completeSiteEnumeration, true);
  assert.equal(result.status, "verified-complete");
  assert.equal(result.sharedWriteAllowed, false);
});

test("proof sconosciuto viene degradato a manual-candidate-set", () => {
  assert.equal(normalizeElementorCoverageProof({ source: "trusted-because-client-says-so" }).source, "manual-candidate-set");
});
