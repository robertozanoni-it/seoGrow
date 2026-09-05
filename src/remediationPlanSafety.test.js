import test from "node:test";
import assert from "node:assert/strict";
import {
  detectPreviewConflicts,
  remediationContextDecision,
  remediationResource,
} from "./remediationPlanSafety.js";

test("due alias dello stesso post WordPress confliggono se cambiano diversamente lo stesso campo", () => {
  const resource = remediationResource({
    inspected: { resource: "posts", entity: { id: 42 } },
    targetUrl: "https://example.it/pagina/",
  });
  const conflicts = detectPreviewConflicts([
    { status: "preview", resourceIdentity: resource, issue: { label: "Title duplicato" }, plan: { changes: { title: "Titolo A" } } },
    { status: "preview", resourceIdentity: resource, issue: { label: "Title duplicato" }, plan: { changes: { title: "Titolo B" } } },
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].field, "title");
});

test("stessa risorsa e stesso valore non produce conflitto", () => {
  const resource = "wp:site:posts:42";
  const conflicts = detectPreviewConflicts([
    { status: "preview", resourceIdentity: resource, plan: { changes: { meta: { rank_math_title: "Titolo" } } } },
    { status: "preview", resourceIdentity: resource, plan: { changes: { meta: { rank_math_title: "Titolo" } } } },
  ]);
  assert.equal(conflicts.length, 0);
});

test("canonical differente senza prova resta bloccata", () => {
  const decision = remediationContextDecision(
    { type: "canonical", label: "Canonical differente dall’URL analizzato" },
    { url: "https://example.it/a" },
    "https://example.it/a",
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "CANONICAL_CONTEXT_REQUIRED");
});

test("canonical rotta confermata può procedere solo se l'URL finale coincide", () => {
  assert.equal(remediationContextDecision(
    { type: "canonical", label: "Canonical rotta (404)" },
    { url: "https://example.it/a" },
    "https://example.it/a",
  ).allowed, true);
  assert.equal(remediationContextDecision(
    { type: "canonical", label: "Canonical rotta (404)" },
    { url: "https://example.it/b" },
    "https://example.it/a",
  ).allowed, false);
});

test("noindex richiede conferma esplicita dell'intento", () => {
  assert.equal(remediationContextDecision({ type: "indexability", label: "Pagina impostata noindex" }, {}, "https://example.it/a").allowed, false);
  assert.equal(remediationContextDecision({ type: "indexability", label: "Pagina impostata noindex", indexIntentConfirmed: true }, {}, "https://example.it/a").allowed, true);
});
