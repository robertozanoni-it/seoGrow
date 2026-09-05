import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const shell = await readFile(new URL("./AuditRemediationShell.jsx", import.meta.url), "utf8");
const live = await readFile(new URL("./WordPressLiveRemediationControlV2.jsx", import.meta.url), "utf8");
const ownership = await readFile(new URL("./wordpressOwnershipV2.js", import.meta.url), "utf8");
const seoServer = await readFile(new URL("../server/wordpressSeoAdapterV2Hook.js", import.meta.url), "utf8");
const verifyServer = await readFile(new URL("../server/frontendVerificationV2Hook.js", import.meta.url), "utf8");
const bootstrap = await readFile(new URL("../server/remediationBootstrap.js", import.meta.url), "utf8");
const main = await readFile(new URL("./main.jsx", import.meta.url), "utf8");

test("il flusso live V2 sostituisce le vecchie azioni di correzione", () => {
  assert.match(shell, /Un solo flusso/);
  assert.match(live, /Anteprima → approvazione → applicazione → riverifica/);
  assert.doesNotMatch(main, /remediationUiOrderPatch/);
  assert.doesNotMatch(main, /AuditUnifiedRemediation from/);
  assert.match(main, /AuditRemediationShell/);
  assert.match(main, /WordPressLiveRemediationControlV2/);
});

test("la generazione SEO usa direttamente l'endpoint robusto V2", () => {
  assert.match(live, /\/api\/wordpress\/generate-seo-value-v2/);
  assert.match(seoServer, /collectOutputText/);
  assert.match(seoServer, /parseStructuredValue/);
  assert.match(seoServer, /max_output_tokens:\s*retry\s*\?\s*1200\s*:\s*900/);
  assert.match(seoServer, /deterministicMetaDescription/);
  assert.doesNotMatch(main, /wordpressSeoRuntimePatch/);
  assert.match(bootstrap, /wordpressSeoAdapterV2Hook/);
});

test("Elementor viene scelto solo con ownership univoca e il core resta bloccato", () => {
  assert.match(ownership, /hasElementorDocument/);
  assert.match(ownership, /fallback su post_content è bloccato/);
  assert.match(ownership, /confirmed\.length === 1/);
  assert.match(ownership, /Più text-editor Elementor/);
  assert.match(live, /inspectEditableElementor/);
});

test("la verifica frontend V2 espone prove per contenuto title description H1 canonical e indexability", () => {
  assert.match(verifyServer, /contentProbeAllMatched/);
  assert.match(verifyServer, /titleMatchesExpected/);
  assert.match(verifyServer, /descriptionMatchesExpected/);
  assert.match(verifyServer, /h1TextMatchesExpected/);
  assert.match(verifyServer, /canonical/);
  assert.match(verifyServer, /indexable/);
  assert.match(bootstrap, /frontendVerificationV2Hook/);
});

test("il bulk live applica rollback compensativo dopo un errore parziale", () => {
  assert.match(live, /rollbackApplied/);
  assert.match(live, /live-rollback-v2/);
  assert.match(live, /Batch annullato senza modifiche residue/);
  assert.match(live, /rollback compensativo fallito/);
});
