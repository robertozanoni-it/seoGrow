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
