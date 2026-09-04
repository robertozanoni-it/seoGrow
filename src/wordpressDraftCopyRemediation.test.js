import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const serverSource = await readFile(
  new URL("../server/wordpressDraftCopyHook.js", import.meta.url),
  "utf8",
);
const clientSource = await readFile(
  new URL("./wordpressDraftCopyRemediation.js", import.meta.url),
  "utf8",
);

test("la remediation di contenuti pubblicati crea una nuova bozza senza pubblicare", () => {
  assert.match(serverSource, /status:\s*"draft"/);
  assert.match(serverSource, /remediate-draft-copy/);
  assert.match(serverSource, /createdDraft:\s*true/);
  assert.match(serverSource, /contenuto pubblicato originale non è stato modificato/);
  assert.doesNotMatch(serverSource, /status:\s*"publish"/);
});

test("il client instrada solo contenuti non draft verso la creazione bozza", () => {
  assert.match(clientSource, /status !== "draft"/);
  assert.match(clientSource, /remediate-draft-copy/);
  assert.match(clientSource, /x-seogrow-rollback/);
});
