import assert from "node:assert/strict";
import test from "node:test";
import { trimGenerateContext, withExplicitWordPressSiteUrl } from "./api.js";

test("la riduzione del contesto remediation conserva JSON valido", () => {
  const context = JSON.stringify({
    issue: { type: "thin", label: "Contenuto breve" },
    page: {
      title: "Titolo pagina",
      excerpt: "Estratto",
      content: `<p>${"contenuto lungo ".repeat(1200)}</p>`,
    },
  });
  const body = JSON.stringify({
    topic: "Remediation WordPress content",
    type: "Correggi il contenuto",
    context,
  });

  const trimmed = trimGenerateContext(body);
  const payload = JSON.parse(trimmed);
  const parsedContext = JSON.parse(payload.context);

  assert.equal(parsedContext.issue.label, "Contenuto breve");
  assert.equal(parsedContext.page.title, "Titolo pagina");
  assert.match(parsedContext.page.content, /contenuto ridotto automaticamente da SeoGrow/);
  assert.ok(payload.context.length <= 10_500);
});

test("inspect-fast riceve siteUrl esplicito separato dal permalink target", () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    querySelector: () => ({ value: "https://example.it/wordpress/" }),
  };
  try {
    const prepared = withExplicitWordPressSiteUrl("/api/wordpress/inspect-fast", {
      method: "POST",
      body: JSON.stringify({
        url: "https://example.it/wordpress/pagina/",
        username: "editor",
        applicationPassword: "secret",
      }),
    });
    const payload = JSON.parse(prepared.body);
    assert.equal(payload.siteUrl, "https://example.it/wordpress/");
    assert.equal(payload.url, "https://example.it/wordpress/pagina/");
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
