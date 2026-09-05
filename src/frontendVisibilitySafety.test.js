import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const server = await readFile(new URL("../server/frontendVerificationHook.js", import.meta.url), "utf8");
const integrity = await readFile(new URL("./remediationIntegrity.js", import.meta.url), "utf8");

test("la verifica frontend dichiara esplicitamente quando serve un browser reale", () => {
  assert.match(server, /requiresBrowserVerification/);
  assert.match(server, /visibilityConfidence/);
  assert.match(server, /verificationSafe/);
  assert.match(server, /contentCoverageStrong: verificationSafe && ownership\.contentCoverageStrong/);
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
