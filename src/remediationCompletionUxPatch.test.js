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
  assert.match(source, /RESOLVED_EVIDENCE_KEY/);
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

test("la remediation mostra quale problema è selezionato", () => {
  assert.match(source, /Problema selezionato/);
  assert.match(source, /wp-live-selected-issue-label/);
  assert.match(source, /Prepara solo il problema selezionato/);
  assert.match(source, /seogrow-remediation-open/);
});

test("il pulsante bulk mostra il numero totale dei problemi dell'audit", () => {
  assert.match(source, /syncBulkActionTotal/);
  assert.match(source, /auditIssueRows\(\)\.length/);
  assert.match(source, /seogrow-bulk-total/);
  assert.match(source, /problemi nell'audit corrente/);
});

test("problemi risolti e problemi bloccati sono visivamente distinti", () => {
  assert.match(css, /\.wp-live-remediation\.panel/);
  assert.match(css, /rgba\(240, 253, 244/);
  assert.match(css, /seogrow-issue-resolved/);
  assert.match(css, /seogrow-issue-resolved button/);
  assert.match(css, /display: none !important/);
  assert.match(css, /wp-live-preview-row\.unsupported/);
  assert.match(source, /seogrow-blocked-badge/);
  assert.match(source, /Non corretto/);
});

test("il messaggio distingue la verifica automatica dal nuovo audit storico", () => {
  assert.match(source, /SeoGrow riverifica automaticamente il frontend/);
  assert.match(source, /nuovo audit serve soltanto ad aggiornare il report storico/);
  assert.match(main, /remediationCompletionUxPatch/);
});
