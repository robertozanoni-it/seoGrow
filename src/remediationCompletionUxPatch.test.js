import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./remediationCompletionUxPatch.js", import.meta.url), "utf8");
const css = await readFile(new URL("./remediationCompletionUxPatch.css", import.meta.url), "utf8");
const main = await readFile(new URL("./main.jsx", import.meta.url), "utf8");
const host = await readFile(new URL("./RemediationHost.jsx", import.meta.url), "utf8");
const live = await readFile(new URL("./WordPressLiveRemediationControlV2.jsx", import.meta.url), "utf8");

test("il modulo legacy documenta ancora la vecchia chiusura task ma non è montato", () => {
  assert.match(source, /status: "Completato"/);
  assert.match(source, /completedAt: now/);
  assert.match(source, /\.wp-live-preview-row\.resolved/);
  assert.match(source, /Chiusa automaticamente: SeoGrow ha confermato/);
  assert.match(source, /RESOLVED_EVIDENCE_KEY/);
  assert.doesNotMatch(main, /remediationCompletionUxPatch/);
});

test("una task completata manualmente non basta a dichiarare risolto un problema SEO", () => {
  assert.match(source, /autoVerifiedTask/);
  assert.match(source, /hasVerifiedEvidence/);
  assert.match(source, /!hasActiveTask && hasVerifiedEvidence/);
  assert.doesNotMatch(source, /hasCompletedTask\s*\|\|\s*verifiedCorrection/);
});

test("una nuova task successiva alla verifica non viene chiusa da una vecchia correzione", () => {
  assert.match(source, /latestVerifiedAt/);
  assert.match(source, /taskTime\(task\) <= latestVerifiedAt/);
  assert.match(source, /activeTasks\.every/);
});

test("la selezione del problema attivo è ora responsabilità dell'host nativo", () => {
  assert.match(host, /Problema da correggere/);
  assert.match(host, /audit-issue-select/);
  assert.match(host, /activeEntries/);
  assert.match(host, /record\.status === "Verificato"/);
  assert.match(live, /Prepara solo questo problema/);
});

test("il bulk V2 usa il numero implicito dei soli problemi attivi", () => {
  assert.match(host, /activeEntries\.length/);
  assert.match(live, /context\.activeIssues/);
  assert.match(live, /Prepara le anteprime dei problemi attivi/);
});

test("i problemi verificati sono esclusi dai problemi attivi tramite dati, non tramite DOM", () => {
  assert.match(host, /verifiedKeys\.has\(entry\.key\)/);
  assert.match(host, /disabled=\{verifiedKeys\.has\(entry\.key\)\}/);
  assert.doesNotMatch(host, /row\.hidden|aria-hidden|style\.setProperty/);
});

test("il CSS legacy resta disponibile ma il runtime V2 classifica i blocchi esplicitamente", () => {
  assert.match(css, /\.wp-live-remediation\.panel/);
  assert.match(live, /quality_error/);
  assert.match(live, /context_error/);
  assert.match(live, /ownership_error/);
  assert.match(live, /adapter_error/);
});

test("il runtime corrente separa applicazione e verifica senza riattivare la patch legacy", () => {
  assert.match(live, /Scrittura e risoluzione SEO restano stati distinti/);
  assert.match(live, /Stato: Da verificare/);
  assert.doesNotMatch(main, /remediationCompletionUxPatch/);
  assert.match(main, /RemediationRuntime/);
});
