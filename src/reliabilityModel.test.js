import test from "node:test";
import assert from "node:assert/strict";
import {
  correctionEvent,
  deriveProblemState,
  exactProblemStatus,
  issueIdentity,
  latestAudit,
  normalizeClientId,
  resourceIdentity,
  taskEvent,
} from "./reliabilityModel.js";

test("Completato non equivale a Verificato e Non verificato non contiene Verificato", () => {
  assert.equal(exactProblemStatus("Completato"), "task_completed");
  assert.equal(exactProblemStatus("Non verificato"), "unverified");
  assert.equal(exactProblemStatus("Verificato"), "verified");
});

test("una task completata non risolve il problema SEO", () => {
  const state = deriveProblemState([
    { kind: "audit_detected", at: "2026-09-05T09:00:00Z" },
    { kind: "task_completed", at: "2026-09-05T09:10:00Z" },
  ]);
  assert.equal(state.problemState, "open");
  assert.equal(state.interventionState, "task_completed");
});

test("un audit più recente riapre una correzione precedentemente verificata", () => {
  const state = deriveProblemState([
    { kind: "correction_verified", at: "2026-09-05T09:00:00Z" },
    { kind: "audit_detected", at: "2026-09-05T10:00:00Z" },
  ]);
  assert.equal(state.problemState, "reappeared");
});

test("rollback riporta il problema ad aperto", () => {
  const state = deriveProblemState([
    { kind: "correction_verified", at: "2026-09-05T09:00:00Z" },
    { kind: "rollback", at: "2026-09-05T10:00:00Z" },
  ]);
  assert.equal(state.problemState, "open");
  assert.equal(state.interventionState, "rolled_back");
});

test("gli eventi correzione usano il timestamp coerente con lo stato finale", () => {
  const rollback = correctionEvent({
    status: "Ripristinato",
    verifiedAt: "2026-09-05T09:00:00Z",
    appliedAt: "2026-09-05T08:30:00Z",
    rollbackAt: "2026-09-05T11:00:00Z",
  });
  assert.equal(rollback.kind, "rollback");
  assert.equal(rollback.at, "2026-09-05T11:00:00Z");

  const applied = correctionEvent({
    status: "Da verificare",
    createdAt: "2026-09-05T08:00:00Z",
    updatedAt: "2026-09-05T10:00:00Z",
    appliedAt: "2026-09-05T09:30:00Z",
  });
  assert.equal(applied.kind, "correction_applied");
  assert.equal(applied.at, "2026-09-05T09:30:00Z");
});

test("una task completata usa completedAt e non un updatedAt precedente", () => {
  const event = taskEvent({
    status: "Completato",
    createdAt: "2026-09-05T08:00:00Z",
    updatedAt: "2026-09-05T09:00:00Z",
    completedAt: "2026-09-05T11:30:00Z",
  });
  assert.equal(event.kind, "task_completed");
  assert.equal(event.at, "2026-09-05T11:30:00Z");
});

test("alias con lo stesso ID WordPress condividono la stessa risorsa", () => {
  const a = resourceIdentity({ siteUrl: "https://www.example.it", wordpressResource: "posts", wordpressId: 42, sourceUrl: "https://example.it/a" });
  const b = resourceIdentity({ siteUrl: "https://example.it/", wordpressResource: "posts", wordpressId: 42, sourceUrl: "https://example.it/a/" });
  assert.equal(a, b);
});

test("senza prova di alias lo slash resta significativo", () => {
  const a = resourceIdentity({ sourceUrl: "https://example.it/a" });
  const b = resourceIdentity({ sourceUrl: "https://example.it/a/" });
  assert.notEqual(a, b);
});

test("link rotti diversi sulla stessa pagina restano problemi distinti", () => {
  const base = { issueType: "broken-external-link", sourceUrl: "https://example.it/pagina" };
  const a = issueIdentity({ ...base, issue: { type: "broken-external-link", targetUrl: "https://a.example/manca" } });
  const b = issueIdentity({ ...base, issue: { type: "broken-external-link", targetUrl: "https://b.example/manca" } });
  assert.notEqual(a, b);
});

test("ID cliente stringa e numerico convergono senza fallback silenzioso", () => {
  assert.equal(normalizeClientId("12"), 12);
  assert.equal(normalizeClientId(12), 12);
  assert.equal(normalizeClientId("cliente"), null);
});

test("l'ultimo audit dipende dalla data e non dall'ordine array", () => {
  const entries = [
    { type: "site", item: { analyzedAt: "2026-09-04T10:00:00Z" } },
    { type: "page", item: { analyzedAt: "2026-09-05T10:00:00Z" } },
    { type: "site", item: { analyzedAt: "2026-09-05T09:00:00Z" } },
  ];
  assert.equal(latestAudit(entries).type, "page");
  assert.equal(latestAudit(entries, { scope: "site" }).item.analyzedAt, "2026-09-05T09:00:00Z");
});
