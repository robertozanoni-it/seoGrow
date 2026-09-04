import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./remediationIntegrity.js", import.meta.url), "utf8");

test("la riverifica remediation sincronizza lo stato delle Task", () => {
  assert.match(source, /removeVerifiedTask/);
  assert.match(source, /reopenTask/);
  assert.match(source, /before\?\.status === "Verificato"/);
  assert.match(source, /after\.status === "Verificato"/);
});
