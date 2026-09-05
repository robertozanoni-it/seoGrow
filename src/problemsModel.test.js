import test from "node:test";
import assert from "node:assert/strict";
import { buildUnifiedProblems } from "./problemsModel.js";

const issue = {
  type: "duplicate-title",
  severity: "alta",
  label: "Title duplicato",
  targetUrl: "https://example.it/pagina/",
  detail: "Condivide il title con un'altra pagina.",
};

test("una verifica più vecchia di un audit recente diventa ricomparso", () => {
  const result = buildUnifiedProblems({
    clientId: 1,
    siteHistory: [{ analyzedAt: "2026-09-05T10:00:00Z", pagesChecked: 10, issues: [issue] }],
    corrections: [{
      id: "c1",
      clientId: 1,
      issueType: "duplicate-title",
      issueLabel: "Title duplicato",
      sourceUrl: "https://example.it/pagina/",
      status: "Verificato",
      verifiedAt: "2026-09-05T09:00:00Z",
    }],
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].problemState, "reappeared");
});

test("task completata non trasforma il problema in risolto", () => {
  const result = buildUnifiedProblems({
    clientId: 1,
    siteHistory: [{ analyzedAt: "2026-09-05T10:00:00Z", issues: [issue] }],
    tasks: [{
      id: "analysis-1",
      sourceClientId: "1",
      kind: "duplicate-title",
      title: "Title duplicato",
      sourceUrl: "https://example.it/pagina/",
      status: "Completato",
      completedAt: "2026-09-05T10:10:00Z",
      priority: "Alta",
    }],
  });
  assert.equal(result.rows[0].problemState, "open");
  assert.equal(result.rows[0].interventionState, "task_completed");
});

test("audit pagina successivo non elimina la copertura del crawl sito", () => {
  const pageIssue = { type: "h1", label: "0 H1 rilevati", severity: "alta", targetUrl: "https://example.it/seconda" };
  const result = buildUnifiedProblems({
    clientId: 1,
    siteHistory: [{ analyzedAt: "2026-09-05T09:00:00Z", pagesChecked: 25, issues: [issue] }],
    pageHistory: [{ analyzedAt: "2026-09-05T11:00:00Z", url: "https://example.it/seconda", issues: [pageIssue] }],
  });
  assert.equal(result.coverage.sitePages, 25);
  assert.equal(result.rows.length, 2);
  assert.ok(result.rows.some((row) => row.auditScopes.includes("site")));
  assert.ok(result.rows.some((row) => row.auditScopes.includes("page")));
});

test("task legacy senza ID cliente non viene associata per nome", () => {
  const result = buildUnifiedProblems({
    clientId: 1,
    tasks: [{ id: "legacy", client: "Cliente", title: "Problema", kind: "audit", sourceUrl: "https://example.it", status: "Da fare" }],
  });
  assert.equal(result.rows.length, 0);
  assert.equal(result.warnings.length, 1);
});

test("più link rotti sulla stessa pagina restano separati", () => {
  const result = buildUnifiedProblems({
    clientId: 1,
    siteHistory: [{
      analyzedAt: "2026-09-05T10:00:00Z",
      issues: [
        { type: "broken-external-link", label: "Link esterno non raggiungibile (404)", url: "https://example.it/pagina", targetUrl: "https://a.example/manca", severity: "alta" },
        { type: "broken-external-link", label: "Link esterno non raggiungibile (404)", url: "https://example.it/pagina", targetUrl: "https://b.example/manca", severity: "alta" },
      ],
    }],
  });
  assert.equal(result.rows.length, 2);
});
