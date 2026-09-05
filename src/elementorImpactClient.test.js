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

test("messaggio ownership conserva come parziali le condizioni non completamente interpretabili", () => {
  const detail = elementorOwnershipDetail({
    _seogrowOwnership: {
      elementorResolvedSourceDocuments: [
        { id: 88, type: "header", title: "Header principale", resolved: true },
      ],
      elementorImpactEvidence: {
        ok: true,
        displayConditionsResolved: false,
        documents: [{ id: 88, ok: true, conditionsObserved: true, displayConditionsResolved: false }],
      },
    },
  });
  assert.match(detail, /condizioni lette \(semantica parziale\/da verificare\)/i);
  assert.match(detail, /semanticamente non risolte/i);
  assert.match(detail, /non modifica automaticamente un template condiviso/i);
});

test("include/general può essere spiegato come intero sito ma la scrittura condivisa resta bloccata", () => {
  const detail = elementorOwnershipDetail({
    _seogrowOwnership: {
      elementorResolvedSourceDocuments: [
        { id: 88, type: "header", title: "Header principale", resolved: true },
      ],
      elementorImpactEvidence: {
        ok: true,
        displayConditionsResolved: true,
        observedUrlCoverage: { inspected: 3, failed: 0 },
        documents: [{
          id: 88,
          ok: true,
          conditionsObserved: true,
          displayConditionsResolved: true,
          conditionInterpretation: { entireSiteIncluded: true },
          observedRenderedCount: 3,
        }],
      },
    },
  });
  assert.match(detail, /ambito intero sito confermato/i);
  assert.match(detail, /osservato su 3 URL del crawl disponibile/i);
  assert.match(detail, /non equivale a una enumerazione completa del sito/i);
  assert.match(detail, /non modifica automaticamente un template condiviso/i);
});

test("applicabilità target risolta viene mostrata senza trasformarsi in autorizzazione di scrittura", () => {
  const detail = elementorOwnershipDetail({
    _seogrowOwnership: {
      elementorResolvedSourceDocuments: [
        { id: 88, type: "header", title: "Header principale", resolved: true },
      ],
      elementorImpactEvidence: {
        ok: true,
        displayConditionsResolved: true,
        targetApplicabilityResolved: true,
        observedUrlCoverage: { inspected: 4, failed: 0 },
        documents: [{
          id: 88,
          ok: true,
          conditionsObserved: true,
          displayConditionsResolved: true,
          targetApplicability: "applies",
          conditionInterpretation: { targetApplicability: "applies", entireSiteIncluded: true },
          observedRenderedCount: 4,
        }],
      },
    },
  });
  assert.match(detail, /condizioni confermano applicazione sulla risorsa target/i);
  assert.match(detail, /applicazione alla risorsa WordPress target è stata valutata/i);
  assert.match(detail, /non modifica automaticamente un template condiviso/i);
});

test("target escluso dalle condizioni viene esplicitato e non mascherato come applicato", () => {
  const detail = elementorOwnershipDetail({
    _seogrowOwnership: {
      elementorResolvedSourceDocuments: [
        { id: 120, type: "popup", title: "Promo", resolved: true },
      ],
      elementorImpactEvidence: {
        ok: true,
        displayConditionsResolved: true,
        targetApplicabilityResolved: true,
        documents: [{
          id: 120,
          ok: true,
          conditionsObserved: true,
          displayConditionsResolved: true,
          conditionInterpretation: { targetApplicability: "excluded" },
        }],
      },
    },
  });
  assert.match(detail, /condizioni escludono la risorsa target/i);
  assert.match(detail, /non modifica automaticamente un template condiviso/i);
});

test("il client conserva il contratto fail-closed e accetta candidate URL solo come diagnostica", () => {
  assert.match(source, /sharedWriteAllowed:\s*false/);
  assert.match(source, /affectedPagesEnumerated:\s*false/);
  assert.match(source, /catch \(error\)[\s\S]*return failedEvidence\(error\)/);
  assert.match(source, /candidateUrls:\s*Array\.isArray\(candidateUrls\)/);
  assert.match(source, /targetEntity:\s*\{/);
  assert.match(source, /id:\s*Number\(entity\?\.id\)/);
  assert.doesNotMatch(source, /sharedWriteAllowed:\s*data/);
  assert.doesNotMatch(source, /affectedPagesEnumerated:\s*data/);
});

test("il live flow passa al diagnostico Elementor le URL del crawl disponibili", () => {
  assert.match(live, /buildElementorImpactCandidateUrls/);
  assert.match(live, /audit:\s*context\.audit\.item/);
  assert.match(live, /issue:\s*currentIssue/);
  assert.match(live, /client:\s*context\.client/);
  assert.match(live, /inspectElementorImpactEvidence\(inspected\.entity, credentials, candidateUrls\)/);
  assert.match(live, /attachElementorImpactEvidence/);
  assert.match(live, /\["content", "h1"\]\.includes\(kind\)/);
});
