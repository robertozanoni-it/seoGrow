import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  attachElementorImpactEvidence,
  elementorSourceDocuments,
  elementorOwnershipDetail,
} from "./elementorImpactClient.js";

const source = await readFile(new URL("./elementorImpactClient.js", import.meta.url), "utf8");
const live = await readFile(new URL("./WordPressLiveRemediationControlV2.jsx", import.meta.url), "utf8");

test("client Elementor deduplica le sorgenti e preferisce quelle già risolte dal server", () => {
  const documents = elementorSourceDocuments({
    _seogrowOwnership: {
      elementorResolvedSourceDocuments: [
        { id: 88, type: "header", origins: ["frontend-rendered"] },
        { id: 88, type: "header", origins: ["local-reference"] },
        { id: 120, type: "popup", origins: ["frontend-rendered"] },
      ],
      elementorExternalRenderedDocuments: [{ id: 999, type: "footer" }],
    },
  });
  assert.deepEqual(documents, [
    { id: 88, type: "header", origins: ["frontend-rendered", "local-reference"] },
    { id: 120, type: "popup", origins: ["frontend-rendered"] },
  ]);
});

test("evidenza read-only viene allegata senza alterare l'identità WordPress", () => {
  const entity = { id: 42, meta: { _elementor_data: "[]" }, _seogrowOwnership: { elementorEvidenceStatus: "rendered-shared-documents" } };
  const evidence = { ok: true, readOnly: true, documents: [{ id: 88, conditionsObserved: true }] };
  const returned = attachElementorImpactEvidence(entity, evidence);
  assert.equal(returned, entity);
  assert.equal(entity.id, 42);
  assert.equal(entity.meta._elementor_data, "[]");
  assert.equal(entity._seogrowOwnership.elementorImpactEvidence, evidence);
});

test("messaggio ownership non trasforma condizioni lette in semantica risolta", () => {
  const detail = elementorOwnershipDetail({
    _seogrowOwnership: {
      elementorResolvedSourceDocuments: [
        { id: 88, type: "header", title: "Header principale", resolved: true },
      ],
      elementorImpactEvidence: {
        ok: true,
        documents: [{ id: 88, ok: true, conditionsObserved: true }],
      },
    },
  });
  assert.match(detail, /condizioni lette \(semantica da verificare\)/i);
  assert.match(detail, /non ne considera ancora risolta la semantica/i);
  assert.match(detail, /non modifica automaticamente un template condiviso/i);
});

test("il client forza sempre il contratto fail-closed anche se una risposta tentasse di dichiarare il contrario", () => {
  assert.match(source, /sharedWriteAllowed:\s*false/);
  assert.match(source, /displayConditionsResolved:\s*false/);
  assert.match(source, /affectedPagesEnumerated:\s*false/);
  assert.match(source, /catch \(error\)[\s\S]*return failedEvidence\(error\)/);
  assert.doesNotMatch(source, /sharedWriteAllowed:\s*data/);
});

test("il live flow richiede impact evidence read-only prima di valutare content e H1 condivisi", () => {
  assert.match(live, /inspectElementorImpactEvidence/);
  assert.match(live, /attachElementorImpactEvidence/);
  assert.match(live, /\["content", "h1"\]\.includes\(kind\)/);
  assert.match(live, /const impactEvidence = await inspectElementorImpactEvidence/);
});
