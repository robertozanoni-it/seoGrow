import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const live = await readFile(new URL("./WordPressLiveRemediationControlV2.jsx", import.meta.url), "utf8");
const host = await readFile(new URL("./RemediationHost.jsx", import.meta.url), "utf8");
const main = await readFile(new URL("./main.jsx", import.meta.url), "utf8");
const location = await readFile(new URL("./locationEvents.js", import.meta.url), "utf8");
const rollbackRouter = await readFile(new URL("./liveRollbackRouter.js", import.meta.url), "utf8");
const rollbackServer = await readFile(new URL("../server/wordpressLiveRollbackHook.js", import.meta.url), "utf8");
const corrections = await readFile(new URL("./CorrectionsWorkspace.jsx", import.meta.url), "utf8");
const store = await readFile(new URL("./remediationStore.js", import.meta.url), "utf8");

test("bulk preview V2 lavora sui soli problemi attivi e non sull'intero storico audit", () => {
  assert.match(live, /const activeIssues = issues\.filter/);
  assert.match(live, /const selected = all \? context\.activeIssues/);
  assert.doesNotMatch(live, /const selected = all \? context\.issues/);
});

test("il bulk live non transazionale è stato sostituito da approvazione singola", () => {
  assert.match(live, /const applyOne = async/);
  assert.match(live, /Approva e applica questa modifica/);
  assert.match(live, /Le anteprime si applicano una alla volta per sicurezza/);
  assert.doesNotMatch(live, /Approva e applica al sito live \(/);
});

test("apply invalida preview stale su client auditType e analyzedAt", () => {
  assert.match(live, /item\.contextSnapshot\?\.auditType !== liveContext\.audit\?\.type/);
  assert.match(live, /contextSnapshot\?\.analyzedAt/);
  assert.match(live, /status: "stale"/);
});

test("preview approvabile mantiene il payload completo", () => {
  assert.match(live, /Prima → Dopo · payload completo/);
  assert.match(live, /previewText\(item\.data\.previewBefore\)/);
  assert.match(live, /previewText\(item\.data\.previewAfter\)/);
  assert.doesNotMatch(live, /compactPreviewValue|differenceWindow/);
});

test("gli errori di prepare V2 hanno categorie distinte", () => {
  for (const status of ["quality_error", "context_error", "ownership_error", "auth_error", "timeout_error", "generation_error", "adapter_error"]) {
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

test("il runtime principale non monta più motore, guard e observer legacy", () => {
  assert.doesNotMatch(main, /AuditUnifiedRemediation/);
  assert.doesNotMatch(main, /legacyRemediationGuard/);
  assert.doesNotMatch(main, /remediationCompletionUxPatch|remediationUiOrderPatch|remediationReportUx/);
  assert.match(main, /RemediationRuntime/);
  assert.doesNotMatch(host, /MutationObserver|window\.fetch\s*=/);
});
