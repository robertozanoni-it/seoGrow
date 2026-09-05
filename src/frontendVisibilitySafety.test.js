import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { elementorRenderedDocuments } from "../server/frontendVerificationHook.js";

const server = await readFile(new URL("../server/frontendVerificationHook.js", import.meta.url), "utf8");
const integrity = await readFile(new URL("./remediationIntegrity.js", import.meta.url), "utf8");

test("la verifica frontend dichiara esplicitamente quando serve un browser reale", () => {
  assert.match(server, /requiresBrowserVerification/);
  assert.match(server, /visibilityConfidence/);
  assert.match(server, /verificationSafe/);
  assert.match(server, /contentCoverageStrong: verificationSafe && ownership\.contentCoverageStrong/);
});

test("il frontend espone gli ID dei documenti Elementor effettivamente presenti nel markup", () => {
  const documents = elementorRenderedDocuments(`
    <header data-elementor-type="header" data-elementor-id="88"></header>
    <main data-elementor-id="42" data-elementor-type="wp-page"></main>
    <footer data-elementor-type="footer" data-elementor-id="91"></footer>
    <div data-elementor-id="88" data-elementor-type="header"></div>
  `);
  assert.deepEqual(documents, [
    { id: 42, type: "wp-page" },
    { id: 88, type: "header" },
    { id: 91, type: "footer" },
  ]);
});

test("il contenuto breve non passa a Verificato con visibilità responsive non dimostrata", () => {
  assert.match(integrity, /const visibilitySafe = data\.verificationSafe !== false && data\.requiresBrowserVerification !== true/);
  assert.match(integrity, /const fixed = thresholdReached && modifiedContentVisible && qualityAccepted && visibilitySafe/);
  assert.match(integrity, /Serve una verifica browser prima di dichiarare la correzione risolta/i);
  assert.match(integrity, /needsBrowserVerification: !visibilitySafe/);
});

test("anche la verifica H1 espone il bisogno di browser senza auto-chiudere il problema", () => {
  assert.match(integrity, /const needsBrowserVerification = data\.requiresBrowserVerification === true/);
  assert.match(integrity, /status: "Da verificare"/);
  assert.match(integrity, /il conteggio H1 statico non basta/i);
});