import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateElementorReferenceImpact,
  scanElementorExplicitReferences,
} from "../server/elementorReferenceImpact.js";

function sortReferences(rows) {
  return [...rows].sort((a, b) => `${a.id}:${a.key}`.localeCompare(`${b.id}:${b.key}`));
}

test("parser riconosce solo template_id e templateID espliciti", () => {
  const scan = scanElementorExplicitReferences(JSON.stringify([
    {
      id: "widget-a",
      settings: {
        template_id: "42",
        templateId: 999,
        random_id: 42,
      },
      elements: [
        { settings: { templateID: 77 } },
      ],
    },
  ]));
  assert.equal(scan.ok, true);
  assert.deepEqual(sortReferences(scan.references), sortReferences([
    { id: 42, key: "template_id", referenceKind: "template-widget" },
    { id: 77, key: "templateID", referenceKind: "global-widget" },
  ]));
  assert.equal(scan.sharedWriteAllowed, false);
});

test("JSON Elementor malformato fallisce chiuso", () => {
  const scan = scanElementorExplicitReferences("[{oops]");
  assert.equal(scan.ok, false);
  assert.equal(scan.status, "malformed-elementor-data");
  assert.equal(scan.malformed, true);
  assert.equal(scan.references.length, 0);
});

test("limite nodi produce truncation e non completezza", () => {
  const scan = scanElementorExplicitReferences({
    a: { b: { c: { d: { settings: { template_id: 10 } } } } },
  }, { maxNodes: 3 });
  assert.equal(scan.ok, false);
  assert.equal(scan.truncated, true);
  assert.equal(scan.status, "truncated");
});

test("riferimenti duplicati della stessa forma vengono deduplicati", () => {
  const scan = scanElementorExplicitReferences([
    { settings: { template_id: 42 } },
    { settings: { template_id: 42 } },
    { settings: { templateID: 42 } },
  ]);
  assert.deepEqual(sortReferences(scan.references), sortReferences([
    { id: 42, key: "template_id", referenceKind: "template-widget" },
    { id: 42, key: "templateID", referenceKind: "global-widget" },
  ]));
});

test("aggregazione enumera le pagine referenti solo con tutte le scansioni complete", () => {
  const rows = [
    {
      sourceId: 1,
      sourceUrl: "https://example.com/a/",
      scan: scanElementorExplicitReferences([{ settings: { template_id: 42 } }]),
    },
    {
      sourceId: 2,
      sourceUrl: "https://example.com/b/",
      scan: scanElementorExplicitReferences([{ settings: { template_id: 42, templateID: 77 } }]),
    },
  ];
  const result = aggregateElementorReferenceImpact(rows, { expectedDocuments: 2 });
  assert.equal(result.ok, true);
  assert.equal(result.affectedPagesEnumerated, true);
  assert.deepEqual(result.references, [
    {
      templateId: 42,
      sources: [
        { sourceId: 1, sourceUrl: "https://example.com/a/", key: "template_id", referenceKind: "template-widget" },
        { sourceId: 2, sourceUrl: "https://example.com/b/", key: "template_id", referenceKind: "template-widget" },
      ],
    },
    {
      templateId: 77,
      sources: [
        { sourceId: 2, sourceUrl: "https://example.com/b/", key: "templateID", referenceKind: "global-widget" },
      ],
    },
  ]);
  assert.equal(result.sharedWriteAllowed, false);
});

test("documento mancante, malformato o troncato impedisce l'enumerazione completa", () => {
  const good = {
    sourceId: 1,
    sourceUrl: "https://example.com/a/",
    scan: scanElementorExplicitReferences([{ settings: { template_id: 42 } }]),
  };
  const malformed = {
    sourceId: 2,
    sourceUrl: "https://example.com/b/",
    scan: scanElementorExplicitReferences("{oops"),
  };
  const result = aggregateElementorReferenceImpact([good, malformed], { expectedDocuments: 3 });
  assert.equal(result.ok, false);
  assert.equal(result.affectedPagesEnumerated, false);
  assert.equal(result.malformedDocuments, 1);
  assert.equal(result.sharedWriteAllowed, false);
});
