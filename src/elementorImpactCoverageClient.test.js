import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./elementorImpactClient.js", import.meta.url), "utf8");

test("il client non tronca le URL prima del backend", () => {
  assert.match(source, /candidateUrls:\s*Array\.isArray\(candidateUrls\)\s*\?\s*candidateUrls\s*:\s*\[\]/);
  assert.doesNotMatch(source, /candidateUrls\.slice\(0,\s*30\)/);
});

test("il client trasmette coverageProof separato dalle URL", () => {
  assert.match(source, /coverageProof:\s*normalizeCoverageProofForRequest\(coverageProof\)/);
  assert.match(source, /source:\s*"manual-candidate-set"/);
  assert.match(source, /verified:\s*coverageProof\.verified\s*===\s*true/);
  assert.match(source, /provenanceId/);
});

test("la provenance client non può abilitare scritture condivise", () => {
  assert.match(source, /sharedWriteAllowed:\s*false/);
  assert.doesNotMatch(source, /sharedWriteAllowed:\s*coverageProof/);
  assert.doesNotMatch(source, /sharedWriteAllowed:\s*data/);
});
