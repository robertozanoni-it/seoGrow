import test from "node:test";
import assert from "node:assert/strict";
import { nestedRollbackChanges, rollbackRequest } from "./rollbackPayload.js";

test("il rollback ricostruisce i meta annidati senza alterare lo snapshot stale", () => {
  const before = {
    title: "Prima",
    "meta.rank_math_title": "SEO prima",
    "meta.rank_math_robots": ["index", "follow"],
  };
  const after = {
    title: "Dopo",
    "meta.rank_math_title": "SEO dopo",
    "meta.rank_math_robots": ["index", "follow"],
  };
  const payload = rollbackRequest({
    siteUrl: "https://example.it",
    sourceUrl: "https://example.it/pagina/",
    resource: "pages",
    entityId: 42,
    username: "editor",
    before,
    after,
  }, { applicationPassword: "app-password" });

  assert.deepEqual(payload.changes, {
    title: "Prima",
    meta: {
      rank_math_title: "SEO prima",
      rank_math_robots: ["index", "follow"],
    },
  });
  assert.deepEqual(payload.expectedCurrent, after);
  assert.equal(payload.siteUrl, "https://example.it");
  assert.equal(payload.targetUrl, "https://example.it/pagina/");
  assert.equal(payload.id, 42);
});

test("nestedRollbackChanges non accetta implicitamente campi extra sotto meta", () => {
  assert.deepEqual(nestedRollbackChanges({ excerpt: "x", "meta.foo": "bar" }), {
    excerpt: "x",
    meta: { foo: "bar" },
  });
});

test("rollbackRequest usa i campi WordPress V2 come fallback", () => {
  const payload = rollbackRequest({
    sourceUrl: "https://example.it/post/",
    wordpressResource: "posts",
    wordpressId: 9,
    before: { excerpt: "prima" },
    after: { excerpt: "dopo" },
  }, { username: "fallback", applicationPassword: "secret" });
  assert.equal(payload.resource, "posts");
  assert.equal(payload.id, 9);
  assert.equal(payload.username, "fallback");
  assert.equal(payload.applicationPassword, "secret");
});
