import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { issueFamily, issueKey } from "./issueIdentity.js";

const audit = await readFile(new URL("./AuditWorkspaceV2.jsx", import.meta.url), "utf8");
const live = await readFile(new URL("./WordPressLiveRemediationControlV2.jsx", import.meta.url), "utf8");
const taskResolution = await readFile(new URL("./taskResolution.js", import.meta.url), "utf8");
const integrity = await readFile(new URL("./remediationIntegrityV2.js", import.meta.url), "utf8");
const css = await readFile(new URL("./WordPressLiveRemediationV2.css", import.meta.url), "utf8");
const main = await readFile(new URL("./main.jsx", import.meta.url), "utf8");

test("l'identità short-content non cambia quando cambia il numero di parole", () => {
  const first = { type: "thin", label: "Contenuto breve per pagina content: 90 parole" };
  const second = { type: "thin", label: "Contenuto breve per pagina content: 176 parole" };
  assert.equal(issueFamily(first), "short-content");
  assert.equal(issueFamily(second), "short-content");
  assert.equal(issueKey(first, "https://example.it/pagina/"), issueKey(second, "https://example.it/pagina"));
});

test("un problema verificato completa la task senza cancellarne lo storico", () => {
  assert.match(taskResolution, /status: "Completato"/);
  assert.match(taskResolution, /completedAt:/);
  assert.doesNotMatch(taskResolution, /tasks\.filter\([^]*status !== "Completato"/);
  assert.match(integrity, /completeTaskForIssue/);
  assert.match(integrity, /rememberResolvedIssue/);
});

test("la lista audit è derivata dai soli problemi attivi", () => {
  assert.match(audit, /activeIssueEntries/);
  assert.match(audit, /!isIssueResolved/);
  assert.match(audit, /Problemi da correggere/);
  assert.match(audit, /activeEntries\.map/);
  assert.match(audit, /risolti dopo l’audit/);
});

test("la remediation mostra un problema selezionato reale e il totale attivo", () => {
  assert.match(live, /Prepara solo il problema selezionato/);
  assert.match(live, /Prepara anteprima di tutte le correzioni \(\$\{activeCount\}\)/);
  assert.match(live, /activeIssues/);
  assert.match(live, /!isIssueResolved/);
  assert.match(main, /AuditRemediationShell/);
  assert.match(main, /WordPressLiveRemediationControlV2/);
});

test("gli stati bloccati ed errore sono distinti visivamente dal successo", () => {
  assert.match(css, /wp-live-preview-row\.blocked/);
  assert.match(css, /wp-live-preview-row\.error/);
  assert.match(css, /wp-live-preview-row\.resolved/);
  assert.match(live, /NON CORRETTO/);
});

test("la riverifica richiede evidenza frontend e un nuovo controllo SEO", () => {
  assert.match(integrity, /inspectFrontend/);
  assert.match(integrity, /freshAudit/);
  assert.match(integrity, /positiveFrontendEvidence/);
  assert.match(integrity, /familyIssuePresent/);
  assert.match(integrity, /status: "Verificato"/);
});

test("un errore operativo di riverifica non retrocede una correzione già verificata", () => {
  assert.match(integrity, /if \(record\.status === "Verificato"\)/);
  assert.match(integrity, /lastVerificationError/);
  const verifiedCatch = integrity.slice(integrity.lastIndexOf('if (record.status === "Verificato")'));
  assert.doesNotMatch(verifiedCatch.slice(0, verifiedCatch.indexOf("return updateCorrection") + 500), /status: "Da verificare"/);
});
