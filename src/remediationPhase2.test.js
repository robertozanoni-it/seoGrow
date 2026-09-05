import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const live = await readFile(new URL("./WordPressLiveRemediationControl.jsx", import.meta.url), "utf8");
const location = await readFile(new URL("./locationEvents.js", import.meta.url), "utf8");
const rollbackRouter = await readFile(new URL("./liveRollbackRouter.js", import.meta.url), "utf8");
const rollbackServer = await readFile(new URL("../server/wordpressLiveRollbackHook.js", import.meta.url), "utf8");
const corrections = await readFile(new URL("./CorrectionsWorkspace.jsx", import.meta.url), "utf8");
const store = await readFile(new URL("./remediationStore.js", import.meta.url), "utf8");
const guard = await readFile(new URL("./legacyRemediationGuard.js", import.meta.url), "utf8");

test("bulk live lavora sui soli problemi attivi e non sull'intero storico audit", () => {
  assert.match(live, /const activeIssues = issues\.filter/);
  assert.match(live, /all\s*\? context\.activeIssues/);
  assert.doesNotMatch(live, /const selected = all \? context\.issues/);
});

test("il bulk live non transazionale non può applicare più elementi", () => {
  assert.match(guard, /const count = liveBatchCount/);
  assert.match(guard, /if \(count <= 1\) return/);
  assert.match(guard, /Applicazione bulk live bloccata per sicurezza/);
});

test("apply invalida preview stale su client auditType e analyzedAt", () => {
  assert.match(live, /item\.contextSnapshot\?\.auditType !== liveContext\.audit\?\.type/);
  assert.match(live, /contextSnapshot\?\.analyzedAt/);
  assert.match(live, /status: "stale"/);
});

test("preview approvabile mantiene il payload completo", () => {
  assert.doesNotMatch(live, /compactPreviewValue/);
  assert.match(live, /payload completo che verrà approvato/);
  assert.match(live, /after\[key\] = changes\[key\]/);
});

test("gli errori di prepare hanno categorie distinte", () => {
  for (const status of ["ownership_error", "auth_error", "timeout_error", "generation_error", "adapter_error"]) {
    assert.match(live, new RegExp(status));
  }
  assert.doesNotMatch(live, /status: "unsupported"/);
});

test("Rank Math e Yoast simultanei non vengono risolti per priorità arbitraria", () => {
  assert.match(live, /if \(matches\.length > 1\)/);
  assert.match(live, /non sceglie un plugin SEO per priorità arbitraria/);
});

test("pending generation non usa più fallback FIFO", () => {
  assert.match(location, /return index >= 0 \? pendingGenerations\.splice\(index, 1\)\[0\] : null/);
  assert.doesNotMatch(location, /pendingGenerations\.shift\(\) \|\| null/);
});

test("riverifica crawl non usa una pagina diversa come fallback", () => {
  assert.match(location, /La pagina target non è presente nel nuovo crawl/);
  assert.doesNotMatch(location, /\|\| data\.pages\?\.\[0\]/);
});

test("rollback invia expectedCurrent e il server blocca lo stale state", () => {
  assert.match(corrections, /expectedCurrent/);
  assert.match(rollbackRouter, /expectedCurrent: body\.expectedCurrent/);
  assert.match(rollbackServer, /assertExpectedCurrent/);
  assert.match(rollbackServer, /STALE_ROLLBACK/);
  assert.match(rollbackServer, /staleChecked: true/);
});

test("IndexedDB resta source of truth quando localStorage fallisce", () => {
  assert.match(store, /writeJsonBestEffort/);
  assert.match(store, /IndexedDB resta la source of truth/);
  assert.match(store, /export async function rebuildRemediationIndex/);
});
