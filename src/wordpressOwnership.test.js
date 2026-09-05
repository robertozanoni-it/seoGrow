import test from "node:test";
import assert from "node:assert/strict";
import {
  countTextWords,
  chooseElementorContentCandidate,
  hasElementorDocument,
  inspectEditableElementor,
} from "./wordpressOwnership.js";

test("countTextWords conserva il significato delle HTML entities", () => {
  assert.equal(countTextWords("SEO&nbsp;Grow &amp; WordPress"), 4);
  assert.equal(countTextWords("uno&#32;due&#x20;tre"), 3);
});

test("Elementor può essere identificato da probe completi anche senza copertura pagina maggioritaria", () => {
  const result = chooseElementorContentCandidate(
    [{ id: "widget-a", item: {}, value: "contenuto ".repeat(20), words: 20 }],
    [{
      contentProbeVisible: true,
      contentCoverageStrong: false,
      contentProbeCount: 3,
      contentProbeMatches: 3,
      expectedWords: 20,
    }],
  );
  assert.equal(result.candidate?.id, "widget-a");
});

test("Theme Builder o popup condivisi bloccano il fallback core quando l'ownership frontend non è ancora risolta", () => {
  const entity = {
    content: { raw: "Contenuto core locale" },
    meta: {},
    _seogrowOwnership: {
      elementorSharedTemplateTypes: ["single", "popup"],
      elementorEvidenceStatus: "shared-templates-present-unresolved",
    },
  };
  assert.equal(hasElementorDocument(entity), true);
  const state = inspectEditableElementor("content", entity);
  assert.equal(state.state, "valid");
  assert.equal(state.hasDocument, true);
  assert.equal(state.widgets.length, 0);
  assert.deepEqual(state.sharedReferences.map((item) => item.templateType), ["single", "popup"]);
  assert.equal(state.impact.status, "shared-risk-unresolved");
  assert.equal(state.impact.requiresImpactReview, true);
  assert.equal(state.impact.sharedWriteAllowed, false);
  assert.equal(state.impact.displayConditionsResolved, false);
});

test("documenti Elementor condivisi effettivamente renderizzati bloccano i candidati locali e conservano gli ID", () => {
  const entity = {
    meta: {
      _elementor_data: JSON.stringify([
        {
          id: "local-text",
          widgetType: "text-editor",
          settings: { editor: "Testo locale modificabile con abbastanza parole per essere candidato." },
          elements: [],
        },
      ]),
    },
    _seogrowOwnership: {
      elementorSharedTemplateTypes: ["header", "footer", "popup"],
      elementorEvidenceStatus: "rendered-shared-documents",
      elementorLocalDocumentRendered: true,
      elementorExternalRenderedDocuments: [
        { id: 88, type: "header" },
        { id: 91, type: "footer" },
      ],
    },
  };
  const state = inspectEditableElementor("content", entity);
  assert.equal(state.state, "valid");
  assert.equal(state.hasDocument, true);
  assert.equal(state.widgets.length, 0);
  assert.deepEqual(state.sharedReferences, [
    { type: "rendered-document", templateType: "header", id: "88" },
    { type: "rendered-document", templateType: "footer", id: "91" },
  ]);
  assert.equal(state.impact.status, "source-partially-identified");
  assert.equal(state.impact.sources.length, 2);
  assert.equal(state.impact.sources.every((item) => item.risk === "high"), true);
  assert.equal(state.impact.affectedPagesEnumerated, false);
  assert.equal(state.impact.sharedWriteAllowed, false);
});

test("riferimenti locali precisi evitano di sostituire l'evidenza con blocchi generici site-wide", () => {
  const entity = {
    meta: {
      _elementor_data: JSON.stringify([
        {
          id: "shared-template",
          widgetType: "template",
          settings: { template_id: 123 },
          elements: [],
        },
      ]),
    },
    _seogrowOwnership: {
      elementorSharedTemplateTypes: ["header", "footer", "popup", "single"],
      elementorEvidenceStatus: "rendered-shared-documents",
      elementorLocalSourceReferences: [
        { id: 123, type: "template", origin: "local-reference" },
      ],
      elementorExternalRenderedDocuments: [],
      elementorResolvedSourceDocuments: [
        { id: 123, type: "template", resolved: true, title: "CTA condivisa", origins: ["local-reference"] },
      ],
    },
  };
  const state = inspectEditableElementor("content", entity);
  assert.deepEqual(state.sharedReferences, [
    { type: "template", templateType: "reusable", id: "123" },
  ]);
  assert.equal(state.impact.status, "source-identified");
  assert.equal(state.impact.sources[0].scope, "reusable-template");
  assert.equal(state.impact.sources[0].title, "CTA condivisa");
  assert.equal(state.impact.sharedWriteAllowed, false);
});

test("template condivisi presenti altrove nel sito non sopprimono i widget locali quando il frontend mostra solo la pagina corrente", () => {
  const entity = {
    meta: {
      _elementor_data: JSON.stringify([
        {
          id: "local-text",
          widgetType: "text-editor",
          settings: { editor: "Testo locale statico modificabile e attribuibile al documento corrente." },
          elements: [],
        },
      ]),
    },
    _seogrowOwnership: {
      elementorSharedTemplateTypes: ["header", "footer", "popup"],
      elementorEvidenceStatus: "local-document-only-observed",
      elementorLocalDocumentRendered: true,
      elementorExternalRenderedDocuments: [],
    },
  };
  const state = inspectEditableElementor("content", entity);
  assert.equal(state.state, "valid");
  assert.equal(state.sharedReferences.length, 0);
  assert.equal(state.widgets.length, 1);
  assert.equal(state.widgets[0].id, "local-text");
  assert.equal(state.impact.status, "local-only-observed");
  assert.equal(state.impact.requiresImpactReview, false);
  assert.equal(state.impact.sharedWriteAllowed, false);
});

test("un Template widget riutilizzato rende ambiguo il documento e sopprime i candidati locali", () => {
  const entity = {
    meta: {
      _elementor_data: JSON.stringify([
        {
          id: "local-text",
          widgetType: "text-editor",
          settings: { editor: "Testo locale modificabile con abbastanza parole per essere candidato." },
          elements: [],
        },
        {
          id: "shared-template",
          widgetType: "template",
          settings: { template_id: 123 },
          elements: [],
        },
      ]),
    },
  };
  const state = inspectEditableElementor("content", entity);
  assert.equal(state.state, "valid");
  assert.equal(state.hasDocument, true);
  assert.equal(state.widgets.length, 0);
  assert.equal(state.sharedReferences[0]?.type, "template");
  assert.equal(state.sharedReferences[0]?.id, "123");
});

test("un documento Elementor solo locale conserva i widget statici candidati", () => {
  const entity = {
    meta: {
      _elementor_data: JSON.stringify([
        {
          id: "local-text",
          widgetType: "text-editor",
          settings: { editor: "Testo locale statico modificabile e attribuibile al documento corrente." },
          elements: [],
        },
      ]),
    },
  };
  const state = inspectEditableElementor("content", entity);
  assert.equal(state.state, "valid");
  assert.equal(state.sharedReferences.length, 0);
  assert.equal(state.widgets.length, 1);
  assert.equal(state.widgets[0].id, "local-text");
  assert.equal(state.impact.sharedWriteAllowed, false);
});
