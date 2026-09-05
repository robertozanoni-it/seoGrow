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

test("route di attestazione applica rate limit per client e host e risponde 429 fail-closed", () => {
  assert.match(source, /RATE_WINDOW_MS = 10 \* 60_000/);
  assert.match(source, /RATE_MAX = 12/);
  assert.match(source, /requestClientIdentity/);
  assert.match(source, /normalizedRequestHost/);
  assert.match(source, /checkRateLimit\(req\)/);
  assert.match(source, /res\.status\(429\)\.json/);
  assert.match(source, /Retry-After/);
  assert.match(source, /completeSiteEnumeration:\s*false/);
  assert.match(source, /sharedWriteAllowed:\s*false/);
});

test("cache dell'attestazione conserva solo esiti negativi diagnostici a TTL breve", () => {
  assert.match(source, /NEGATIVE_CACHE_TTL_MS = 30_000/);
  assert.match(source, /if \(!value \|\| value\.verified === true \|\| value\.ok !== true\) return/);
  assert.match(source, /cacheType:\s*"short-lived-negative-diagnostic"/);
  assert.match(source, /provenanceId:\s*""/);
  assert.match(source, /completeSiteEnumeration:\s*false/);
  assert.match(source, /affectedPagesEnumerated:\s*false/);
  assert.match(source, /sharedWriteAllowed:\s*false/);
});

test("cache e rate limit non usano username o password applicativa come chiave", () => {
  const rateKeyStart = source.indexOf("function rateKey");
  const negativeKeyStart = source.indexOf("function negativeCacheKey");
  const rateKeyEnd = source.indexOf("function checkRateLimit", rateKeyStart);
  const negativeKeyEnd = source.indexOf("function readNegativeCache", negativeKeyStart);
  assert.ok(rateKeyStart >= 0 && rateKeyEnd > rateKeyStart);
  assert.ok(negativeKeyStart >= 0 && negativeKeyEnd > negativeKeyStart);
  const rateKeyBlock = source.slice(rateKeyStart, rateKeyEnd);
  const negativeKeyBlock = source.slice(negativeKeyStart, negativeKeyEnd);
  assert.doesNotMatch(rateKeyBlock, /username|applicationPassword|password/i);
  assert.doesNotMatch(negativeKeyBlock, /username|applicationPassword|password/i);
});
