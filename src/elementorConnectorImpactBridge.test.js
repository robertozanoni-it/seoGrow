import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeConnectorImpactEvidence } from "../server/elementorImpactHook.js";

const serverSource = await readFile(new URL("../server/elementorImpactHook.js", import.meta.url), "utf8");

const requested = [{ id: 88, type: "header", origins: ["frontend-rendered"] }];

test("bridge Connector preserva type, condizioni e applicabilità target in sola lettura", () => {
  const rows = normalizeConnectorImpactEvidence({
    ok: true,
    readOnly: true,
    sharedWriteAllowed: false,
    documents: [{
      ok: true,
      id: 88,
      type: "header",
      title: "Header principale",
      status: "publish",
      link: "https://example.com/?elementor_library=header-principale",
      conditionsObserved: true,
      conditions: ["include/general", "exclude/singular/page/99"],
      readOnly: true,
      sharedWriteAllowed: false,
    }],
  }, requested, { id: 42, type: "page" });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].ok, true);
  assert.equal(rows[0].type, "header");
  assert.equal(rows[0].typeEvidence.status, "verified");
  assert.equal(rows[0].conditionsSource, "seogrow-connector-read-only");
  assert.equal(rows[0].displayConditionsResolved, true);
  assert.equal(rows[0].targetApplicability, "applies");
  assert.equal(rows[0].sharedWriteAllowed, false);
  assert.equal(rows[0].affectedPagesEnumerated, false);
});

test("bridge rifiuta contratti Connector che non dichiarano esplicitamente read-only", () => {
  assert.throws(() => normalizeConnectorImpactEvidence({
    ok: true,
    readOnly: false,
    sharedWriteAllowed: false,
    documents: [],
  }, requested, { id: 42, type: "page" }), /contratto Elementor impact read-only non valido/i);

  assert.throws(() => normalizeConnectorImpactEvidence({
    ok: true,
    readOnly: true,
    sharedWriteAllowed: true,
    documents: [],
  }, requested, { id: 42, type: "page" }), /contratto Elementor impact read-only non valido/i);
});

test("bridge rifiuta duplicati e documenti mancanti invece di scegliere il primo record", () => {
  const duplicate = normalizeConnectorImpactEvidence({
    ok: true,
    readOnly: true,
    sharedWriteAllowed: false,
    documents: [
      { ok: true, id: 88, type: "header", readOnly: true, sharedWriteAllowed: false },
      { ok: true, id: 88, type: "header", readOnly: true, sharedWriteAllowed: false },
    ],
  }, requested, { id: 42, type: "page" });
  assert.equal(duplicate[0].ok, false);
  assert.match(duplicate[0].error, /più record/i);

  const missing = normalizeConnectorImpactEvidence({
    ok: true,
    readOnly: true,
    sharedWriteAllowed: false,
    documents: [],
  }, requested, { id: 42, type: "page" });
  assert.equal(missing[0].ok, false);
  assert.match(missing[0].error, /non ha restituito/i);
});

test("bridge blocca conflitto tra tipo frontend e tipo Elementor letto dal Connector", () => {
  const rows = normalizeConnectorImpactEvidence({
    ok: true,
    readOnly: true,
    sharedWriteAllowed: false,
    documents: [{
      ok: true,
      id: 88,
      type: "footer",
      conditionsObserved: true,
      conditions: ["include/general"],
      readOnly: true,
      sharedWriteAllowed: false,
    }],
  }, requested, { id: 42, type: "page" });
  assert.equal(rows[0].ok, false);
  assert.equal(rows[0].typeEvidence.status, "mismatch");
  assert.equal(rows[0].displayConditionsResolved, false);
  assert.equal(rows[0].targetApplicability, "unknown");
});

test("server preferisce il Connector aggiornato e usa il REST Elementor diretto solo come fallback 404", () => {
  assert.match(serverSource, /\/wp-json\/seogrow\/v1\/elementor-impact-inspect/);
  assert.match(serverSource, /if \(response\.status === 404\)/);
  assert.match(serverSource, /evidenceSource = "seogrow-connector-read-only"/);
  assert.match(serverSource, /evidenceSource = "wordpress-rest-edit-fallback"/);
  assert.match(serverSource, /sharedWriteAllowed:\s*false/);
  assert.match(serverSource, /affectedPagesEnumerated:\s*false/);
});
