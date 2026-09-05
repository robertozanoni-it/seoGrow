import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateElementorCoverageProof,
  normalizeElementorCoverageAttestation,
  normalizeElementorCoverageProof,
} from "../server/elementorCoverageProof.js";

const trustedAttestation = (overrides = {}) => ({
  verified: true,
  provenanceId: "crawl-proof-001",
  totalUrls: 3,
  source: "server-crawl-registry",
  ...overrides,
});

test("coverage manuale resta parziale anche se tutte le URL sono state ispezionate", () => {
  const result = evaluateElementorCoverageProof({
    proof: { source: "manual-candidate-set", totalUrls: 3, complete: true, verified: true, provenanceId: "manual" },
    serverAttestation: trustedAttestation({ provenanceId: "manual" }),
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

test("claim verified del client non vale senza attestazione server", () => {
  const result = evaluateElementorCoverageProof({
    proof: {
      source: "verified-complete-crawl",
      totalUrls: 3,
      complete: true,
      verified: true,
      provenanceId: "client-claims-trusted",
    },
    provided: 3,
    accepted: 3,
    inspected: 3,
    failed: 0,
  });
  assert.equal(result.clientVerifiedClaim, true);
  assert.equal(result.serverVerified, false);
  assert.equal(result.completeSiteEnumeration, false);
  assert.equal(result.status, "server-verification-missing");
});

test("attestazione server richiede provenance e fonte autorizzata", () => {
  const missingProvenance = evaluateElementorCoverageProof({
    proof: { source: "verified-complete-crawl", totalUrls: 3, complete: true, provenanceId: "crawl-proof-001" },
    serverAttestation: trustedAttestation({ provenanceId: "" }),
    provided: 3,
    accepted: 3,
    inspected: 3,
    failed: 0,
  });
  assert.equal(missingProvenance.completeSiteEnumeration, false);
  assert.equal(missingProvenance.status, "server-verification-missing");

  const wrongSource = evaluateElementorCoverageProof({
    proof: { source: "verified-complete-crawl", totalUrls: 3, complete: true, provenanceId: "crawl-proof-001" },
    serverAttestation: trustedAttestation({ source: "client-payload" }),
    provided: 3,
    accepted: 3,
    inspected: 3,
    failed: 0,
  });
  assert.equal(wrongSource.completeSiteEnumeration, false);
  assert.equal(wrongSource.status, "attestation-source-untrusted");
});

test("provenance client e server devono coincidere", () => {
  const result = evaluateElementorCoverageProof({
    proof: { source: "verified-complete-crawl", totalUrls: 3, complete: true, provenanceId: "crawl-A" },
    serverAttestation: trustedAttestation({ provenanceId: "crawl-B" }),
    provided: 3,
    accepted: 3,
    inspected: 3,
    failed: 0,
  });
  assert.equal(result.completeSiteEnumeration, false);
  assert.equal(result.status, "provenance-mismatch");
});

test("totale dichiarato e attestato devono coincidere con le URL ricevute", () => {
  const clientMismatch = evaluateElementorCoverageProof({
    proof: { source: "verified-complete-crawl", totalUrls: 4, complete: true, provenanceId: "crawl-proof-001" },
    serverAttestation: trustedAttestation(),
    provided: 3,
    accepted: 3,
    inspected: 3,
    failed: 0,
  });
  assert.equal(clientMismatch.completeSiteEnumeration, false);
  assert.equal(clientMismatch.status, "count-mismatch");

  const serverMismatch = evaluateElementorCoverageProof({
    proof: { source: "verified-complete-crawl", totalUrls: 3, complete: true, provenanceId: "crawl-proof-001" },
    serverAttestation: trustedAttestation({ totalUrls: 4 }),
    provided: 3,
    accepted: 3,
    inspected: 3,
    failed: 0,
  });
  assert.equal(serverMismatch.completeSiteEnumeration, false);
  assert.equal(serverMismatch.status, "count-mismatch");
});

test("URL rifiutate o fallite bloccano la completezza", () => {
  const rejected = evaluateElementorCoverageProof({
    proof: { source: "verified-complete-crawl", totalUrls: 3, complete: true, provenanceId: "crawl-proof-001" },
    serverAttestation: trustedAttestation(),
    provided: 3,
    accepted: 2,
    inspected: 2,
    failed: 0,
  });
  assert.equal(rejected.completeSiteEnumeration, false);
  assert.equal(rejected.status, "truncated");

  const failed = evaluateElementorCoverageProof({
    proof: { source: "verified-complete-crawl", totalUrls: 3, complete: true, provenanceId: "crawl-proof-001" },
    serverAttestation: trustedAttestation(),
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
    proof: { source: "verified-complete-crawl", totalUrls: 31, complete: true, provenanceId: "crawl-large" },
    serverAttestation: trustedAttestation({ provenanceId: "crawl-large", totalUrls: 31 }),
    provided: 31,
    accepted: 30,
    inspected: 30,
    failed: 0,
  });
  assert.equal(result.truncated, true);
  assert.equal(result.completeSiteEnumeration, false);
  assert.equal(result.status, "truncated");
});

test("solo coverage attestata dal server, esatta e interamente ispezionata diventa completa", () => {
  const result = evaluateElementorCoverageProof({
    proof: { source: "verified-complete-crawl", totalUrls: 3, complete: true, verified: true, provenanceId: "crawl-proof-001" },
    serverAttestation: trustedAttestation(),
    provided: 3,
    accepted: 3,
    inspected: 3,
    failed: 0,
  });
  assert.equal(result.completeSiteEnumeration, true);
  assert.equal(result.status, "verified-complete");
  assert.equal(result.serverVerified, true);
  assert.equal(result.attestationSourceTrusted, true);
  assert.equal(result.provenanceMatches, true);
  assert.equal(result.sharedWriteAllowed, false);
});

test("proof sconosciuto viene degradato e attestation sconosciuta non è trusted", () => {
  assert.equal(normalizeElementorCoverageProof({ source: "trusted-because-client-says-so" }).source, "manual-candidate-set");
  assert.equal(normalizeElementorCoverageAttestation({ verified: true, source: "client" }).source, "client");
});
