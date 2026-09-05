import test from "node:test";
import assert from "node:assert/strict";
import {
  remediationTargetFromGenerateBody,
  shouldBlockGenerationForStatus,
} from "./remediationBatchGuard.js";

const source = await import("node:fs/promises").then(({ readFile }) =>
  readFile(new URL("./remediationBatchGuard.js", import.meta.url), "utf8"),
);

test("il batch guard blocca solo gli stati WordPress non sicuri", () => {
  assert.equal(shouldBlockGenerationForStatus("trash"), true);
  assert.equal(shouldBlockGenerationForStatus("auto-draft"), true);
  assert.equal(shouldBlockGenerationForStatus("inherit"), true);
  assert.equal(shouldBlockGenerationForStatus("publish"), false);
  assert.equal(shouldBlockGenerationForStatus("draft"), false);
  assert.match(source, /UNSAFE_SOURCE_STATUS/);
});

test("il batch guard ricava il target dal contesto remediation", () => {
  const targetUrl = "https://example.com/pagina/?utm_source=test";
  const body = JSON.stringify({
    topic: "Remediation WordPress content",
    context: JSON.stringify({ issue: { targetUrl } }),
  });

  assert.equal(remediationTargetFromGenerateBody(body), targetUrl);
  assert.equal(
    remediationTargetFromGenerateBody(JSON.stringify({ topic: "Altro", context: "{}" })),
    "",
  );
  assert.match(source, /Correzione \$\{Math\.min\(done \+ 1, total\)\}\/\$\{total\}/);
});
