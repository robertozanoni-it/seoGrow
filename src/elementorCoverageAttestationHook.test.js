import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../server/elementorCoverageAttestationHook.js", import.meta.url),
  "utf8",
);

test("attestazione combina coverage pubblica e inventario Connector autorevole", () => {
  assert.match(source, /inspectElementorPublicCoverage/);
  assert.match(source, /validateAuthoritativeWordPressInventory/);
  assert.match(source, /reconcileAuthoritativeInventoryWithPublicCoverage/);
  assert.match(source, /wordpress-public-inventory/);
});

test("registro provenance viene scritto solo dopo riconciliazione verificata", () => {
  const guard = source.indexOf("if (reconciliation.verified !== true)");
  const register = source.indexOf("registerElementorCoverageAttestation({");
  assert.ok(guard >= 0 && register > guard);
  assert.match(source, /provenanceId = `elementor-coverage:\$\{randomUUID\(\)\}`/);
  assert.match(source, /method: "crawl\+sitemap-reconciled"/);
  assert.match(source, /queueExhausted: publicProof\.queueDrained === true/);
});

test("attestazione non abilita mai scrittura Elementor condivisa", () => {
  assert.doesNotMatch(source, /sharedWriteAllowed:\s*true/);
  assert.match(source, /sharedWriteAllowed:\s*false/);
  assert.match(source, /affectedPagesEnumerated:\s*false/);
});

test("route di attestazione richiede credenziali ma non le restituisce", () => {
  assert.match(source, /siteUrl,\s*username,\s*applicationPassword/);
  assert.match(source, /URL sito, username e password applicazione WordPress sono obbligatori/);
  assert.doesNotMatch(source, /return\s*\{[^}]*applicationPassword/s);
  assert.match(source, /\/api\/wordpress\/elementor-coverage-attest/);
});
