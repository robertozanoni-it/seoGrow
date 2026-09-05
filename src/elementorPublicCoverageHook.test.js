import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extractInternalLinks } from "../server/elementorPublicCoverageHook.js";

const source = await readFile(new URL("../server/elementorPublicCoverageHook.js", import.meta.url), "utf8");

test("coverage pubblica è strettamente read-only e non può dichiarare complete site enumeration", () => {
  assert.match(source, /\/api\/wordpress\/elementor-public-coverage/);
  assert.match(source, /publicCoverageReconciled:/);
  assert.match(source, /authoritativeWordPressInventoryVerified:\s*false/);
  assert.match(source, /completeSiteEnumeration:\s*false/);
  assert.match(source, /affectedPagesEnumerated:\s*false/);
  assert.match(source, /sharedWriteAllowed:\s*false/);
  assert.doesNotMatch(source, /completeSiteEnumeration:\s*true/);
  assert.doesNotMatch(source, /sharedWriteAllowed:\s*true/);
  assert.doesNotMatch(source, /registerElementorCoverageAttestation/);
});

test("estrazione link ignora markup inerte, protocolli non web e host esterni", () => {
  const html = `
    <a href="/a/">A</a>
    <a href="https://www.example.com/b/#x">B</a>
    <a href="https://evil.example.net/x/">evil</a>
    <a href="mailto:test@example.com">mail</a>
    <script><a href="/fake/">fake</a></script>
    <template><a href="/fake-template/">fake</a></template>
  `;
  assert.deepEqual(extractInternalLinks(html, "https://example.com/page/", "https://example.com"), [
    "https://example.com/a/",
    "https://www.example.com/b/",
  ]);
});
