import test from "node:test";
import assert from "node:assert/strict";
import { stableIssueKey } from "./remediationStore.js";

test("stableIssueKey non cambia quando varia un conteggio dinamico nel label", () => {
  const first = stableIssueKey({
    issueLabel: "Contenuto breve: 90 parole",
    sourceUrl: "https://example.it/pagina/",
  });
  const second = stableIssueKey({
    issueLabel: "Contenuto breve: 176 parole",
    sourceUrl: "https://example.it/pagina",
  });
  assert.equal(first, second);
});

test("stableIssueKey usa il tipo stabile quando disponibile", () => {
  const first = stableIssueKey({
    issueType: "thin-content",
    issueLabel: "90 parole",
    sourceUrl: "https://www.example.it/pagina/",
  });
  const second = stableIssueKey({
    issueType: "thin-content",
    issueLabel: "176 parole",
    sourceUrl: "https://example.it/pagina",
  });
  assert.equal(first, second);
});

test("stableIssueKey mantiene distinti problemi diversi sulla stessa URL", () => {
  const title = stableIssueKey({
    issueType: "title",
    sourceUrl: "https://example.it/pagina",
  });
  const h1 = stableIssueKey({
    issueType: "h1",
    sourceUrl: "https://example.it/pagina",
  });
  assert.notEqual(title, h1);
});
