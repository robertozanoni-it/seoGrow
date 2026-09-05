import test from "node:test";
import assert from "node:assert/strict";
import { elementorSourceTypeEvidence } from "../server/wordpressInspectFastHook.js";

test("tipo Elementor condiviso esposto e coerente conferma la sorgente", () => {
  const evidence = elementorSourceTypeEvidence("header", {
    id: 88,
    meta: { _elementor_template_type: "header" },
  });
  assert.deepEqual(evidence, {
    requestedType: "header",
    observedType: "header",
    status: "verified",
    verified: true,
  });
});

test("tipo Elementor condiviso in conflitto resta ownership mismatch", () => {
  const evidence = elementorSourceTypeEvidence("header", {
    id: 88,
    meta: { _elementor_template_type: "footer" },
  });
  assert.equal(evidence.status, "mismatch");
  assert.equal(evidence.verified, false);
  assert.equal(evidence.requestedType, "header");
  assert.equal(evidence.observedType, "footer");
});

test("assenza del tipo Elementor non viene convertita in conferma implicita", () => {
  const evidence = elementorSourceTypeEvidence("single", { id: 120, meta: {} });
  assert.equal(evidence.status, "not-exposed");
  assert.equal(evidence.verified, null);
  assert.equal(evidence.observedType, "");
});

test("riferimento template generico conserva il tipo osservato senza falsa comparazione", () => {
  const evidence = elementorSourceTypeEvidence("template", {
    id: 123,
    meta: { _elementor_template_type: "section" },
  });
  assert.equal(evidence.status, "observed-noncomparable");
  assert.equal(evidence.verified, null);
  assert.equal(evidence.observedType, "section");
});
