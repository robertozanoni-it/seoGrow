import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSiteAnalysis } from "./seoResponseIntegrity.js";

test("429 e 5xx non restano tra i link interrotti confermati", () => {
  const result = normalizeSiteAnalysis({
    pagesChecked: 3,
    pages: [{ url: "https://example.com/" }],
    brokenLinks: [
      { url: "https://example.com/manca", status: 404, sources: ["https://example.com/"] },
      { url: "https://example.com/limitata", status: 429, temporary: true, sources: ["https://example.com/"] },
    ],
    brokenExternalLinks: [
      { url: "https://external.example/error", status: 503, temporary: true, sources: ["https://example.com/"] },
    ],
    failures: [{ url: "https://example.com/private", reason: "Esclusa da robots.txt" }],
    issues: [
      { type: "broken-link", severity: "alta", label: "Link interno interrotto (404)", targetUrl: "https://example.com/manca", detail: "HTTP 404" },
      { type: "broken-link", severity: "media", label: "Link interno interrotto (429)", targetUrl: "https://example.com/limitata", detail: "HTTP 429 · possibile errore temporaneo" },
      { type: "broken-external-link", severity: "media", label: "Link esterno non raggiungibile (503)", targetUrl: "https://external.example/error", detail: "HTTP 503 · possibile errore temporaneo" },
    ],
  });

  assert.deepEqual(result.brokenLinks.map((item) => item.status), [404]);
  assert.equal(result.brokenExternalLinks.length, 0);
  assert.equal(result.linkVerificationWarnings.length, 2);
  assert.deepEqual(result.issues.map((item) => item.label), ["Link interno interrotto (404)"]);
  assert.equal(result.pagesFailed, 0);
  assert.equal(result.crawlExclusions.length, 1);
});

test("canonical differente e noindex restano segnali da confermare e non penalizzano lo score", () => {
  const result = normalizeSiteAnalysis({
    score: 70,
    pagesChecked: 20,
    issues: [
      { type: "canonical", severity: "media", label: "Canonical differente dall’URL analizzato", url: "https://example.com/a", detail: "https://example.com/b" },
      { type: "indexability", severity: "media", label: "Pagina impostata noindex", url: "https://example.com/category/news", detail: "noindex" },
      { type: "broken-link", severity: "alta", label: "Link interno interrotto (404)", targetUrl: "https://example.com/manca", detail: "HTTP 404" },
    ],
    brokenLinks: [{ url: "https://example.com/manca", status: 404, sources: ["https://example.com/"] }],
  });

  assert.equal(result.issues.length, 1);
  assert.equal(result.reviewItems.length, 2);
  assert.ok(result.reviewItems.every((item) => item.diagnosisState === "needs-confirmation"));
  assert.equal(result.scoreSource, "seogrow-derived");
  assert.match(result.scoreMethodology, /non è un voto Google/i);
});

test("canonical rotta 404 rimane problema confermato", () => {
  const result = normalizeSiteAnalysis({
    pagesChecked: 2,
    issues: [
      { type: "canonical", severity: "alta", label: "Canonical rotta (404)", url: "https://example.com/a", detail: "Canonical HTTP 404" },
    ],
  });
  assert.equal(result.issues.length, 1);
  assert.equal(result.reviewItems.length, 0);
});
