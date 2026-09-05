import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readServer = (name) => readFile(new URL(`../server/${name}`, import.meta.url), "utf8");

const bootstrap = await readServer("remediationBootstrap.js");
const migratedHooks = await Promise.all([
  "wordpressLiveApprovalHook.js",
  "wordpressLiveRollbackHook.js",
  "wordpressSeoAdapterV2Hook.js",
  "frontendVerificationHook.js",
  "wordpressInspectFastHook.js",
  "wordpressPatchV2Hook.js",
].map(readServer));

test("il bootstrap remediation usa una sola compatibilità Express prima del fallback API", () => {
  assert.match(bootstrap, /function registerRemediationRoutes/);
  assert.match(bootstrap, /seogrow\.remediationBootstrapUsePatched/);
  assert.match(bootstrap, /args\[0\] === "\/api"/);
  assert.doesNotMatch(bootstrap, /remediationBootstrapListenPatched|express\.application\.listen/);
});

test("tutti gli hook remediation attivi esportano route esplicite senza patchare express.application", () => {
  assert.equal(migratedHooks.length, 6);
  for (const source of migratedHooks) {
    assert.match(source, /function registerRoutes\(app\)/);
    assert.match(source, /export \{[^}]*registerRoutes/);
    assert.doesNotMatch(source, /express\.application\.(?:use|listen)/);
    assert.doesNotMatch(source, /import express from "express"/);
  }
});

test("il bootstrap non carica più gli endpoint remediation superseded", () => {
  for (const legacyModule of ["wordpressSeoAdapterHook", "wordpressDraftCopyHook", "wordpressRemediationHook"]) {
    assert.doesNotMatch(bootstrap, new RegExp(legacyModule));
  }
});
