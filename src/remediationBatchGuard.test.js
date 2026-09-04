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

test("il batch guard lascia passare contenuti pubblicati verso la remediation in bozza", () => {
  const body = extract("shouldBlockGenerationForStatus");
  assert.match(body, /trash/);
  assert.doesNotMatch(body, /normalized !== "draft"/);
  assert.match(source, /UNSAFE_SOURCE_STATUS/);
});

test("il batch guard ricava il target dal contesto remediation", () => {
  const body = extract("remediationTargetFromGenerateBody");
  assert.match(body, /Remediation WordPress/);
  assert.match(body, /context\?\.issue\?\.targetUrl/);
  assert.match(source, /Correzione \$\{Math\.min\(done \+ 1, total\), total\}\/\$\{total\}/);
});
