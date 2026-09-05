import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./elementorImpactClient.js", import.meta.url), "utf8");

test("il client non tronca le URL prima del backend", () => {
  assert.match(source, /let effectiveCandidateUrls = Array\.isArray\(candidateUrls\) \? candidateUrls : \[\]/);
  assert.match(source, /candidateUrls:\s*effectiveCandidateUrls/);
  assert.doesNotMatch(source, /candidateUrls\.slice\(0,\s*30\)/);
});

test("il client trasmette coverageProof separato dalle URL", () => {
  assert.match(source, /coverageProof:\s*normalizeCoverageProofForRequest\(effectiveCoverageProof\)/);
  assert.match(source, /source:\s*"manual-candidate-set"/);
  assert.match(source, /verified:\s*coverageProof\.verified\s*===\s*true/);
  assert.match(source, /provenanceId/);
});

test("senza proof esplicita il client tenta attestazione server e usa solo una provenance verificata", () => {
  assert.match(source, /\/api\/wordpress\/elementor-coverage-attest/);
  assert.match(source, /if \(!response\.ok \|\| data\?\.verified !== true\) return null/);
  assert.match(source, /source:\s*"verified-complete-crawl"/);
  assert.match(source, /totalUrls !== candidateUrls\.length/);
  assert.match(source, /effectiveCandidateUrls = attested\.candidateUrls/);
  assert.match(source, /effectiveCoverageProof = attested\.coverageProof/);
});

test("attestazione non disponibile ricade sul set diagnostico esistente", () => {
  assert.match(source, /if \(!effectiveCoverageProof\)/);
  assert.match(source, /if \(attested\)/);
  assert.match(source, /return null;/);
  assert.match(source, /manual-candidate-set/);
});

test("la provenance client non può abilitare scritture condivise", () => {
  assert.match(source, /sharedWriteAllowed:\s*false/);
  assert.doesNotMatch(source, /sharedWriteAllowed:\s*coverageProof/);
  assert.doesNotMatch(source, /sharedWriteAllowed:\s*data/);
});
