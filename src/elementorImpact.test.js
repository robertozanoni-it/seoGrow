import test from "node:test";
import assert from "node:assert/strict";
import { summarizeElementorImpact } from "./elementorImpact.js";

test("un documento Elementor solo locale non viene confuso con impatto condiviso", () => {
  const impact = summarizeElementorImpact({
    elementorEvidenceStatus: "local-document-only-observed",
    elementorSharedTemplateTypes: ["header", "footer"],
    elementorResolvedSourceDocuments: [],
  });
  assert.equal(impact.status, "local-only-observed");
  assert.equal(impact.requiresImpactReview, false);
  assert.equal(impact.affectedPagesEnumerated, false);
  assert.equal(impact.sharedWriteAllowed, false);
});

test("header e footer renderizzati sono sorgenti condivise ad alto impatto", () => {
  const impact = summarizeElementorImpact({
    elementorEvidenceStatus: "rendered-shared-documents",
    elementorResolvedSourceDocuments: [
      { id: 88, type: "header", title: "Header principale", resolved: true, origins: ["frontend-rendered"] },
      { id: 91, type: "footer", title: "Footer principale", resolved: true, origins: ["frontend-rendered"] },
    ],
  });
  assert.equal(impact.status, "source-identified");
  assert.equal(impact.requiresImpactReview, true);
  assert.equal(impact.sources.length, 2);
  assert.equal(impact.sources[0].scope, "shared-layout");
  assert.equal(impact.sources[0].risk, "high");
  assert.equal(impact.displayConditionsResolved, false);
  assert.equal(impact.sharedWriteAllowed, false);
});

test("evidenza server risolta non viene degradata da una seconda osservazione runtime dello stesso documento", () => {
  const impact = summarizeElementorImpact({
    elementorEvidenceStatus: "rendered-shared-documents",
    elementorResolvedSourceDocuments: [
      { id: 123, type: "template", title: "CTA condivisa", resolved: true, origins: ["local-reference"] },
      { id: 123, type: "template", resolved: false, origins: ["local-runtime-reference"] },
    ],
  });
  assert.equal(impact.status, "source-identified");
  assert.equal(impact.sources.length, 1);
  assert.equal(impact.sources[0].resolved, true);
  assert.equal(impact.sources[0].title, "CTA condivisa");
  assert.deepEqual(impact.sources[0].origins, ["local-reference", "local-runtime-reference"]);
});

test("le Display Conditions risolte dal server restano visibili nel modello di ownership", () => {
  const impact = summarizeElementorImpact({
    elementorEvidenceStatus: "rendered-shared-documents",
    elementorResolvedSourceDocuments: [
      { id: 88, type: "header", title: "Header principale", resolved: true, origins: ["frontend-rendered"] },
      { id: 91, type: "footer", title: "Footer principale", resolved: true, origins: ["frontend-rendered"] },
    ],
    elementorImpactEvidence: {
      ok: true,
      displayConditionsResolved: true,
      affectedPagesEnumerated: false,
      observedUrlCoverage: {
        inspected: 12,
        failed: 0,
        completeSiteEnumeration: false,
      },
      documents: [
        {
          id: 88,
          ok: true,
          displayConditionsResolved: true,
          conditionsObserved: true,
          conditionInterpretation: { semanticStatus: "resolved", entireSiteIncluded: true },
          observedRenderedCount: 12,
          observedRenderedUrls: ["https://example.com/", "https://example.com/contatti/"],
        },
        {
          id: 91,
          ok: true,
          displayConditionsResolved: true,
          conditionsObserved: true,
          conditionInterpretation: { semanticStatus: "resolved", entireSiteIncluded: true },
          observedRenderedCount: 12,
          observedRenderedUrls: ["https://example.com/", "https://example.com/contatti/"],
        },
      ],
    },
  });

  assert.equal(impact.displayConditionsResolved, true);
  assert.equal(impact.affectedPagesEnumerated, false);
  assert.equal(impact.sharedWriteAllowed, false);
  assert.equal(impact.impactConfidence, "conditions-resolved-scope-not-enumerated");
  assert.equal(impact.sources[0].entireSiteIncluded, true);
  assert.equal(impact.sources[0].observedRenderedCount, 12);
  assert.deepEqual(impact.observedUrlCoverage, {
    inspected: 12,
    failed: 0,
    completeSiteEnumeration: false,
  });
  assert.match(impact.summary, /Display Conditions note risultano semanticamente risolte/i);
});

test("evidenza condizioni parziale non autorizza né dichiara risoluzione globale", () => {
  const impact = summarizeElementorImpact({
    elementorEvidenceStatus: "rendered-shared-documents",
    elementorResolvedSourceDocuments: [
      { id: 88, type: "header", resolved: true, origins: ["frontend-rendered"] },
      { id: 91, type: "footer", resolved: true, origins: ["frontend-rendered"] },
    ],
    elementorImpactEvidence: {
      ok: true,
      displayConditionsResolved: false,
      documents: [
        { id: 88, ok: true, displayConditionsResolved: true, conditionsObserved: true },
        { id: 91, ok: true, displayConditionsResolved: false, conditionsObserved: true },
      ],
    },
  });

  assert.equal(impact.displayConditionsResolved, false);
  assert.equal(impact.affectedPagesEnumerated, false);
  assert.equal(impact.sharedWriteAllowed, false);
  assert.equal(impact.impactConfidence, "source-identified-scope-not-enumerated");
});

test("popup e template riutilizzati restano bloccati finché condizioni e raggio non sono dimostrati", () => {
  const impact = summarizeElementorImpact({
    elementorEvidenceStatus: "rendered-shared-documents",
    elementorResolvedSourceDocuments: [
      { id: 120, type: "popup", resolved: true, origins: ["frontend-rendered"] },
      { id: 130, type: "template", resolved: false, origins: ["local-reference"] },
    ],
  });
  assert.equal(impact.status, "source-partially-identified");
  assert.deepEqual(impact.sources.map((item) => item.scope), ["conditional-overlay", "reusable-template"]);
  assert.equal(impact.requiresImpactReview, true);
  assert.equal(impact.affectedPagesEnumerated, false);
  assert.equal(impact.displayConditionsResolved, false);
});

test("la sola presenza di template condivisi nel sito resta rischio irrisolto, non prova di applicazione", () => {
  const impact = summarizeElementorImpact({
    elementorEvidenceStatus: "shared-templates-present-unresolved",
    elementorSharedTemplateTypes: ["single", "popup"],
  });
  assert.equal(impact.status, "shared-risk-unresolved");
  assert.equal(impact.requiresImpactReview, true);
  assert.deepEqual(impact.siteWideTypes, ["single", "popup"]);
  assert.match(impact.summary, /non ha identificato con certezza/i);
});
