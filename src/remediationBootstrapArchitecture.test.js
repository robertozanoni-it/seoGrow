import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readServer = (name) => readFile(new URL(`../server/${name}`, import.meta.url), "utf8");

const bootstrap = await readServer("remediationBootstrap.js");
const migratedHooks = await Promise.all([
  "wordpressLiveApprovalHook.js",
  "wordpressLiveRollbackHook.js",
  "wordpressSeoAdapterHook.js",
  "wordpressSeoAdapterV2Hook.js",
  "wordpressDraftCopyHook.js",
  "frontendVerificationHook.js",
].map(readServer));

test("il bootstrap remediation centralizza la compatibilità Express", () => {
  assert.match(bootstrap, /function registerRemediationRoutes/);
  assert.match(bootstrap, /seogrow\.remediationBootstrapUsePatched/);
  assert.match(bootstrap, /seogrow\.remediationBootstrapListenPatched/);
  assert.match(bootstrap, /args\[0\] === "\/api"/);
});

test("gli hook migrati esportano route esplicite senza patchare express.application", () => {
  for (const source of migratedHooks) {
    assert.match(source, /function registerRoutes\(app\)/);
    assert.match(source, /export \{[^}]*registerRoutes/);
    assert.doesNotMatch(source, /express\.application\.(?:use|listen)/);
    assert.doesNotMatch(source, /import express from "express"/);
  }
});
