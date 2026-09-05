import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const client = await readFile(new URL("./WordPressLiveRemediationControl.jsx", import.meta.url), "utf8");
const ownership = await readFile(new URL("./wordpressOwnership.js", import.meta.url), "utf8");
const server = await readFile(new URL("../server/wordpressLiveApprovalHook.js", import.meta.url), "utf8");
const rollback = await readFile(new URL("./liveRollbackRouter.js", import.meta.url), "utf8");

test("la remediation live richiede anteprima e approvazione esplicita", () => {
  assert.match(client, /live-preview/);
  assert.match(client, /Approva e applica al sito live/);
  assert.match(client, /window\.confirm/);
  assert.match(client, /live-apply/);
  assert.match(client, /saveCorrection/);
});

test("il server usa token monouso e rifiuta anteprime stale", () => {
  assert.match(server, /APPROVALS\.set/);
  assert.match(server, /APPROVALS\.delete/);
  assert.match(server, /APPROVAL_EXPIRED/);
  assert.match(server, /STALE_PREVIEW/);
  assert.match(server, /snapshotHash/);
});

test("la scrittura live non cambia lo status WordPress", () => {
  assert.match(server, /body: JSON\.stringify\(approval\.changes\)/);
  assert.doesNotMatch(server, /status:\s*"publish"/);
});

test("Elementor viene modificato solo tramite il meta REST dedicato", () => {
  assert.match(client, /changes:\s*\{ meta: \{ _elementor_data:/);
  assert.match(client, /header_size = "h1"/);
  assert.match(client, /header_size = "h2"/);
  assert.match(ownership, /item\.widgetType === "text-editor"/);
  assert.match(ownership, /item\.widgetType === "heading"/);
  assert.match(ownership, /hasElementorDocument/);
});

test("il rollback ricostruisce i campi meta annidati", () => {
  assert.match(rollback, /key\.startsWith\("meta\."\)/);
  assert.match(rollback, /live-rollback/);
  assert.match(rollback, /direct\.meta = meta/);
});
