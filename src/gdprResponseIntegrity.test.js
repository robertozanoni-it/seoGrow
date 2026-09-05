import test from "node:test";
import assert from "node:assert/strict";
import { isGdprUrl, normalizeGdprResponse } from "./gdprResponseIntegrity.js";

const jsonResponse = (value) => new Response(JSON.stringify(value), {
  status: 200,
  headers: { "content-type": "application/json" },
});

test("riconosce le URL GDPR senza classificare contenuti normali", () => {
  assert.equal(isGdprUrl("https://example.it/privacy-policy/"), true);
  assert.equal(isGdprUrl("https://example.it/cookie-policy"), true);
  assert.equal(isGdprUrl("https://example.it/blog/privacy-per-aziende"), false);
});

test("audit pagina GDPR resta fuori dai problemi SEO", async () => {
  const response = await normalizeGdprResponse(
    jsonResponse({ url: "https://example.it/privacy-policy/", score: 42, issues: [{ type: "short-content" }] }),
    "/api/audit",
    { body: JSON.stringify({ url: "https://example.it/privacy-policy/" }) },
  );
  const data = await response.json();
  assert.equal(data.score, 100);
  assert.deepEqual(data.issues, []);
  assert.equal(data.gdprReview.managedSeparately, true);
});

test("site analysis esclude solo i problemi appartenenti alle pagine GDPR", async () => {
  const response = await normalizeGdprResponse(jsonResponse({
    pagesChecked: 2,
    pagesFailed: 0,
    pages: [
      { url: "https://example.it/privacy-policy/", contentExcerpt: "Gestisci i cookie con Complianz" },
      { url: "https://example.it/servizio/", contentExcerpt: "Servizio reale" },
    ],
    issues: [
      { type: "short-content", severity: "alta", url: "https://example.it/privacy-policy/" },
      { type: "h1", severity: "media", url: "https://example.it/servizio/" },
    ],
  }), "/api/site-analysis", {});
  const data = await response.json();
  assert.equal(data.issues.length, 1);
  assert.equal(data.issues[0].type, "h1");
  assert.equal(data.gdprReview.excludedSeoIssues, 1);
  assert.equal(data.gdprReview.bannerDetected, true);
  assert.deepEqual(data.gdprReview.pagesDetected, ["https://example.it/privacy-policy/"]);
});

test("le risposte non audit non vengono riscritte", async () => {
  const original = jsonResponse({ ok: true });
  const result = await normalizeGdprResponse(original, "/api/session", {});
  assert.equal(result, original);
});
