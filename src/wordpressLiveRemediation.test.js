import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const client = await readFile(new URL("./WordPressLiveRemediationControlV2.jsx", import.meta.url), "utf8");
const ownership = await readFile(new URL("./wordpressOwnership.js", import.meta.url), "utf8");
const server = await readFile(new URL("../server/wordpressLiveApprovalHook.js", import.meta.url), "utf8");
const rollback = await readFile(new URL("./rollbackPayload.js", import.meta.url), "utf8");
const corrections = await readFile(new URL("./CorrectionsWorkspace.jsx", import.meta.url), "utf8");
const main = await readFile(new URL("./main.jsx", import.meta.url), "utf8");

test("la remediation live V2 richiede anteprima e approvazione esplicita", () => {
  assert.match(client, /\/api\/wordpress\/live-preview/);
  assert.match(client, /Approva e applica questa modifica/);
  assert.match(client, /window\.confirm/);
  assert.match(client, /\/api\/wordpress\/live-apply/);
  assert.match(client, /await saveCorrection\(record\)/);
});

test("l'ispezione V2 passa sempre la base WordPress separata dal permalink target", () => {
  assert.match(client, /siteUrl:\s*credentials\.url[\s\S]*url:\s*targetUrl/);
  assert.match(client, /\/api\/wordpress\/inspect-fast/);
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

test("i blocchi Elementor spiegano gli ID dei documenti condivisi quando disponibili", () => {
  assert.match(client, /elementorResolvedExternalDocuments/);
  assert.match(client, /documenti Elementor condivisi/);
  assert.match(client, /non modifica automaticamente un template condiviso/);
});

test("il rollback V2 ricostruisce i meta annidati e conserva lo snapshot stale-safe", () => {
  assert.match(rollback, /key\.startsWith\("meta\."\)/);
  assert.match(rollback, /direct\.meta = meta/);
  assert.match(rollback, /expectedCurrent: after/);
  assert.match(corrections, /\/api\/wordpress\/live-rollback/);
  assert.doesNotMatch(main, /liveRollbackRouter/);
});