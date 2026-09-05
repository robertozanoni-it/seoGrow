import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./remediationCompletionUxPatch.js", import.meta.url), "utf8");
const css = await readFile(new URL("./remediationCompletionUxPatch.css", import.meta.url), "utf8");
const main = await readFile(new URL("./main.jsx", import.meta.url), "utf8");

test("un problema già risolto viene chiuso come task e non resta Da fare", () => {
  assert.match(source, /status: "Completato"/);
  assert.match(source, /completedAt: now/);
  assert.match(source, /\.wp-live-preview-row\.resolved/);
  assert.match(source, /Chiusa automaticamente: SeoGrow ha confermato/);
});

test("un nuovo task attivo prevale su una vecchia risoluzione", () => {
  assert.match(source, /hasActiveTask/);
  assert.match(source, /!hasActiveTask && \(hasCompletedTask \|\| verifiedCorrection\)/);
});

test("la remediation mostra quale problema è selezionato", () => {
  assert.match(source, /Problema selezionato/);
  assert.match(source, /wp-live-selected-issue-label/);
  assert.match(source, /Prepara solo il problema selezionato/);
  assert.match(source, /seogrow-remediation-open/);
});

test("la sezione live e le righe risolte usano un background verde", () => {
  assert.match(css, /\.wp-live-remediation\.panel/);
  assert.match(css, /rgba\(240, 253, 244/);
  assert.match(css, /seogrow-issue-resolved/);
  assert.match(css, /wp-connector-control/);
});

test("il messaggio distingue la verifica automatica dal nuovo audit storico", () => {
  assert.match(source, /SeoGrow riverifica automaticamente il frontend/);
  assert.match(source, /nuovo audit serve soltanto ad aggiornare il report storico/);
  assert.match(main, /remediationCompletionUxPatch/);
});
