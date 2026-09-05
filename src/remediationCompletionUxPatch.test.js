import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("./main.jsx", import.meta.url), "utf8");
const host = await readFile(new URL("./RemediationHost.jsx", import.meta.url), "utf8");
const live = await readFile(new URL("./WordPressLiveRemediationControlV2.jsx", import.meta.url), "utf8");
const integrity = await readFile(new URL("./remediationIntegrity.js", import.meta.url), "utf8");

test("la chiusura dei problemi è responsabilità del runtime nativo, non di patch DOM legacy", () => {
  assert.match(host, /record\.status === "Verificato"/);
  assert.match(host, /verifiedKeys\.has\(entry\.key\)/);
  assert.match(integrity, /removeVerifiedTask\(after\)/);
  assert.doesNotMatch(main, /AuditUnifiedRemediation|legacyRemediationGuard|remediationCompletionUxPatch|remediationUiOrderPatch/);
});

test("la selezione del problema attivo deriva dai dati e non nasconde righe via DOM", () => {
  assert.match(host, /Problema da correggere/);
  assert.match(host, /audit-issue-select/);
  assert.match(host, /activeEntries/);
  assert.match(host, /disabled=\{verifiedKeys\.has\(entry\.key\)\}/);
  assert.doesNotMatch(host, /row\.hidden|aria-hidden|style\.setProperty|MutationObserver/);
});

test("il bulk V2 prepara soltanto problemi attivi e applica una modifica alla volta", () => {
  assert.match(host, /activeEntries\.length/);
  assert.match(live, /context\.activeIssues/);
  assert.match(live, /Prepara le anteprime dei problemi attivi/);
  assert.match(live, /const applyOne = async/);
  assert.match(live, /Le anteprime si applicano una alla volta per sicurezza/);
});

test("il runtime corrente separa scrittura WordPress e verifica SEO", () => {
  assert.match(live, /Scrittura e risoluzione SEO restano stati distinti/);
  assert.match(live, /Stato: Da verificare/);
  assert.match(integrity, /status:\s*fixed\s*\?\s*"Verificato"\s*:\s*"Da verificare"/);
  assert.match(integrity, /frontendConfirmed:\s*fixed/);
  assert.match(integrity, /verifiedAt:\s*fixed\s*\?/);
  assert.match(integrity, /status:\s*"Da verificare"/);
});

test("gli errori remediation sono classificati esplicitamente nel V2", () => {
  for (const state of ["quality_error", "context_error", "ownership_error", "auth_error", "timeout_error", "generation_error", "adapter_error"]) {
    assert.match(live, new RegExp(state));
  }
});
