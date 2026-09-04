import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const server = await readFile(new URL("../server/wordpressLiveApprovalHook.js", import.meta.url), "utf8");

test("le anteprime live durano abbastanza per un batch completo", () => {
  assert.match(server, /const TTL_MS = 30 \* 60_000/);
});

test("il lock stale riguarda i campi target e non ogni modifica indipendente alla pagina", () => {
  const snapshot = server.match(/function snapshotHash\([\s\S]*?return crypto\.createHash/);
  assert.ok(snapshot, "snapshotHash deve essere presente");
  assert.match(snapshot[0], /selected:\s*selectedState\(entity, changes\)/);
  assert.doesNotMatch(snapshot[0], /modified:/);
  assert.match(server, /Il campo WordPress da modificare è cambiato dopo l'anteprima/);
});
