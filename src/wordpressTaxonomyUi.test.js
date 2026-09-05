import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ui = await readFile(new URL("./WordPressTaxonomyRemediationControl.jsx", import.meta.url), "utf8");
const runtime = await readFile(new URL("./RemediationRuntime.jsx", import.meta.url), "utf8");
const integrity = await readFile(new URL("./remediationIntegrity.js", import.meta.url), "utf8");
const rollback = await readFile(new URL("../server/wordpressLiveRollbackHook.js", import.meta.url), "utf8");

test("la UI tassonomie usa il contratto preview/apply e conferme esplicite", () => {
  assert.match(ui, /\/api\/wordpress\/inspect-taxonomy/);
  assert.match(ui, /\/api\/wordpress\/taxonomy-preview/);
  assert.match(ui, /\/api\/wordpress\/taxonomy-apply/);
  assert.match(ui, /canonicalTargetConfirmed: true/);
  assert.match(ui, /indexingIntent/);
  assert.match(ui, /saveCorrection/);
  assert.match(ui, /resource: "taxonomy"/);
  assert.match(ui, /taxonomyField: field/);
});

test("la remediation tassonomie è montata nel runtime Audit SEO senza sostituire il flusso V2 pagine", () => {
  assert.match(runtime, /WordPressTaxonomyRemediationControl/);
  assert.match(runtime, /WordPressLiveRemediationControlV2/);
});

test("lo storico può riverificare e rollbackare le tassonomie con stale-state", () => {
  assert.match(integrity, /record\.resource === "taxonomy"/);
  assert.match(integrity, /\/api\/wordpress\/taxonomy-verify/);
  assert.match(rollback, /rollbackTaxonomy/);
  assert.match(rollback, /sameFieldValue\(field, current, expected\)/);
  assert.match(rollback, /singleField/);
});
