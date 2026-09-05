import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readServer = (name) => readFile(new URL(`../server/${name}`, import.meta.url), "utf8");

const bootstrap = await readServer("remediationBootstrap.js");
const serverIndex = await readServer("index.js");
const migratedHooks = await Promise.all([
  "wordpressConnectionHook.js",
  "wordpressLiveApprovalHook.js",
  "wordpressLiveRollbackHook.js",
  "wordpressSeoAdapterV2Hook.js",
  "frontendVerificationHook.js",
  "wordpressInspectFastHook.js",
  "elementorImpactHook.js",
  "wordpressTaxonomyHook.js",
  "wordpressPatchV2Hook.js",
  "elementorPublicCoverageHook.js",
  "elementorCoverageAttestationHook.js",
].map(readServer));

test("server/index registra esplicitamente le route remediation prima del fallback API", () => {
  assert.match(bootstrap, /function registerRemediationRoutes/);
  assert.doesNotMatch(bootstrap, /express\.application|remediationBootstrapUsePatched/);
  assert.match(serverIndex, /import \{ registerRemediationRoutes \} from "\.\/remediationBootstrap\.js"/);
  const registration = serverIndex.indexOf("registerRemediationRoutes(app);");
  const fallback = serverIndex.indexOf('app.use("/api"');
  assert.ok(registration >= 0, "registrazione remediation assente");
  assert.ok(fallback >= 0, "fallback API assente");
  assert.ok(registration < fallback, "le route remediation devono precedere il fallback API");
});

test("il bootstrap espone le capability reali del runtime V2", () => {
  assert.match(bootstrap, /\/api\/wordpress\/remediation-capabilities/);
  assert.match(bootstrap, /engine: "v2"/);
  assert.match(bootstrap, /"connection-check"/);
  assert.match(bootstrap, /"inspect-fast"/);
  assert.match(bootstrap, /"inspect-taxonomy"/);
  assert.match(bootstrap, /"elementor-impact-read-only"/);
  assert.match(bootstrap, /"elementor-impact-server-attested-coverage"/);
  assert.match(bootstrap, /"elementor-public-coverage-read-only"/);
  assert.match(bootstrap, /"wordpress-public-inventory-read-only"/);
  assert.match(bootstrap, /"elementor-coverage-attestation"/);
  assert.match(bootstrap, /elementorImpactMode: "read-only-server-attested-coverage-no-shared-write"/);
  assert.match(bootstrap, /elementorPublicCoverageMode: "sitemap-crawl-reconciled-non-authoritative-no-shared-write"/);
  assert.match(bootstrap, /elementorCoverageAttestationMode: "connector-inventory-plus-public-coverage-exact-match-no-shared-write"/);
  assert.match(bootstrap, /taxonomyMode: "single-field-explicit-approval-stale-safe"/);
  assert.match(bootstrap, /"live-preview"/);
  assert.match(bootstrap, /"live-apply"/);
  assert.match(bootstrap, /"live-rollback"/);
  assert.match(bootstrap, /draftCopyCompatibility: false/);
});

test("tutti gli hook remediation attivi esportano route esplicite senza patchare express.application", () => {
  assert.equal(migratedHooks.length, 11);
  for (const source of migratedHooks) {
    assert.match(source, /function registerRoutes\(app\)/);
    assert.match(source, /export\s+(?:function\s+registerRoutes\s*\(|\{[^}]*registerRoutes)/);
    assert.doesNotMatch(source, /express\.application\.(?:use|listen)/);
    assert.doesNotMatch(source, /import express from "express"/);
  }
});

test("il bootstrap non carica più gli endpoint remediation superseded", () => {
  for (const legacyModule of ["wordpressSeoAdapterHook", "wordpressDraftCopyHook", "wordpressRemediationHook"]) {
    assert.doesNotMatch(bootstrap, new RegExp(legacyModule));
  }
});
