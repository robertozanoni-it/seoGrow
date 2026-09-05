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

test("Theme Builder o popup condivisi bloccano il fallback core anche senza _elementor_data locale", () => {
  const entity = {
    content: { raw: "Contenuto core locale" },
    meta: {},
    _seogrowOwnership: {
      elementorSharedTemplateTypes: ["single", "popup"],
    },
  };
  assert.equal(hasElementorDocument(entity), true);
  const state = inspectEditableElementor("content", entity);
  assert.equal(state.state, "valid");
  assert.equal(state.hasDocument, true);
  assert.equal(state.widgets.length, 0);
  assert.deepEqual(state.sharedReferences.map((item) => item.templateType), ["single", "popup"]);
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
});
