import test from "node:test";
import assert from "node:assert/strict";

const source = await import("node:fs/promises").then(({ readFile }) =>
  readFile(new URL("./remediationBatchGuard.js", import.meta.url), "utf8"),
);

const extract = (name) => {
  const patterns = {
    shouldBlockGenerationForStatus:
      /export function shouldBlockGenerationForStatus\(status\) \{([\s\S]*?)\n\}/,
    remediationTargetFromGenerateBody:
      /export function remediationTargetFromGenerateBody\(body\) \{([\s\S]*?)\n\}/,
  };
  const match = source.match(patterns[name]);
  assert.ok(match, `${name} deve essere presente`);
  return match[1];
};

test("il batch guard blocca contenuti WordPress non draft prima della generazione AI", () => {
  const body = extract("shouldBlockGenerationForStatus");
  assert.match(body, /normalized !== "draft"/);
  assert.match(source, /DRAFT_REQUIRED/);
  assert.match(source, /Remediation automatica bloccata/);
});

test("il batch guard ricava il target dal contesto remediation", () => {
  const body = extract("remediationTargetFromGenerateBody");
  assert.match(body, /Remediation WordPress/);
  assert.match(body, /context\?\.issue\?\.targetUrl/);
  assert.match(source, /Correzione \$\{Math\.min\(done \+ 1, total\), total\}\/\$\{total\}/);
});
