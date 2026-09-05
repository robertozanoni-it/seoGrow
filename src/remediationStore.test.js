import test from "node:test";
import assert from "node:assert/strict";
import { stableIssueKey } from "./remediationStore.js";

test("stableIssueKey non cambia quando varia un conteggio dinamico sulla stessa URL", () => {
  const first = stableIssueKey({
    issueLabel: "Contenuto breve: 90 parole",
    sourceUrl: "https://example.it/pagina/",
  });
  const second = stableIssueKey({
    issueLabel: "Contenuto breve: 176 parole",
    sourceUrl: "https://example.it/pagina/",
  });
  assert.equal(first, second);
});

test("slash e non slash non vengono fusi senza prova di identità", () => {
  const first = stableIssueKey({
    issueType: "thin-content",
    sourceUrl: "https://example.it/pagina/",
  });
  const second = stableIssueKey({
    issueType: "thin-content",
    sourceUrl: "https://example.it/pagina",
  });
  assert.notEqual(first, second);
});

test("alias diversi dello stesso ID WordPress convergono", () => {
  const first = stableIssueKey({
    issueType: "thin-content",
    siteUrl: "https://example.it",
    resource: "posts",
    entityId: 42,
    sourceUrl: "https://example.it/pagina/",
  });
  const second = stableIssueKey({
    issueType: "thin-content",
    siteUrl: "https://www.example.it/",
    resource: "posts",
    entityId: 42,
    sourceUrl: "https://example.it/pagina",
  });
  assert.equal(first, second);
});

test("stableIssueKey mantiene distinti problemi diversi sulla stessa URL", () => {
  const title = stableIssueKey({ issueType: "title", sourceUrl: "https://example.it/pagina" });
  const h1 = stableIssueKey({ issueType: "h1", sourceUrl: "https://example.it/pagina" });
  assert.notEqual(title, h1);
});

test("link rotti con destinazioni diverse rimangono distinti", () => {
  const a = stableIssueKey({
    issueType: "broken-external-link",
    sourceUrl: "https://example.it/pagina",
    issue: { type: "broken-external-link", targetUrl: "https://a.example/manca" },
  });
  const b = stableIssueKey({
    issueType: "broken-external-link",
    sourceUrl: "https://example.it/pagina",
    issue: { type: "broken-external-link", targetUrl: "https://b.example/manca" },
  });
  assert.notEqual(a, b);
});
