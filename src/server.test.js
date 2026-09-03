import test from "node:test";
import assert from "node:assert/strict";

process.env.APP_API_TOKEN = "a".repeat(64);
process.env.CREDENTIAL_ENCRYPTION_KEY = "b".repeat(64);
const {
  app,
  canonicalCrawlUrl,
  isPrivateAddress,
  markdownToWordPress,
  pageLinks,
  robotsAllows,
  wordpressEndpoint,
} = await import("../server/index.js");

test("la pulizia WordPress rimuove tag e protocolli pericolosi", () => {
  const clean = markdownToWordPress(
    '<p>Test</p><script src="https://evil.test/x.js"><a href=javascript:alert(1)>male</a>',
  );
  assert.doesNotMatch(clean, /script|javascript:/i);
  assert.match(clean, /<p>Test<\/p>/);
});

test("l’endpoint WordPress normalizza wp-admin e le sottocartelle", () => {
  const endpoint = wordpressEndpoint(
    new URL("https://example.it/blog/wp-admin/"),
    "posts",
  );
  assert.equal(endpoint.href, "https://example.it/blog/wp-json/wp/v2/posts");
});

test("il crawler conserva lo slash finale significativo", () => {
  assert.equal(
    canonicalCrawlUrl("https://example.it/servizio/?utm_source=test"),
    "https://example.it/servizio/",
  );
});

test("robots.txt applica la regola più specifica", () => {
  const robots = "User-agent: *\nDisallow: /privato\nAllow: /privato/pubblico";
  assert.equal(robotsAllows(robots, "seogrowai", "/privato/test"), false);
  assert.equal(robotsAllows(robots, "seogrowai", "/privato/pubblico"), true);
});

test("blocca indirizzi IPv4 mappati e reti riservate", () => {
  assert.equal(isPrivateAddress("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateAddress("100.64.0.1"), true);
  assert.equal(isPrivateAddress("198.51.100.2"), true);
  assert.equal(isPrivateAddress("8.8.8.8"), false);
  assert.equal(isPrivateAddress("::ffff:7f00:1"), true);
  assert.equal(isPrivateAddress("64:ff9b::a00:1"), true);
  assert.equal(isPrivateAddress("fe80::1"), true);
  assert.equal(isPrivateAddress("fec0::1"), true);
});

test("estrae link usando base href e ignora script e commenti", () => {
  const links = pageLinks(
    '<base href="https://example.it/blog/"><a href="articolo">ok</a><!-- <a href="/falso"> --><script><a href="/script"></script>',
    "https://example.it/",
  );
  assert.deepEqual(links, ["https://example.it/blog/articolo"]);
});

test("conserva tabelle HTML e converte blocchi di codice", () => {
  assert.match(markdownToWordPress("<table><tr><td>Dato</td></tr></table>"), /<table>/);
  assert.match(markdownToWordPress("```js\nalert(1)\n```"), /<pre><code>alert\(1\)<\/code><\/pre>/);
});

test("le route locali espongono health ma proteggono la sessione", async () => {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    assert.equal((await fetch(`${base}/api/session`)).status, 401);
    for (const [path, method] of [
      ["/api/audit", "POST"],
      ["/api/site-analysis", "POST"],
      ["/api/generate", "POST"],
      ["/api/wordpress/draft", "POST"],
      ["/api/google/properties", "GET"],
      ["/api/dataforseo/rankings", "POST"],
    ]) {
      const response = await fetch(`${base}${path}`, {
        method,
        ...(method === "POST"
          ? {
              headers: { "content-type": "application/json" },
              body: "{}",
            }
          : {}),
      });
      assert.equal(response.status, 401, `${method} ${path} deve richiedere il token locale`);
    }
    assert.equal(
      (
        await fetch(`${base}/api/session`, {
          headers: { "x-seogrow-token": "a".repeat(64) },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(`${base}/api/session`, {
          headers: {
            origin: "http://evil.example",
            "x-seogrow-token": "a".repeat(64),
          },
        })
      ).status,
      403,
    );
    const openAi = await fetch(`${base}/api/openai/status`, {
      headers: { "x-seogrow-token": "a".repeat(64) },
    });
    assert.equal(openAi.status, 200);
    assert.equal(typeof (await openAi.json()).monthlyCost, "number");
    const invalidGeo = await fetch(`${base}/api/geo/audit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-seogrow-token": "a".repeat(64),
      },
      body: JSON.stringify({ url: "https://example.it", pageUrls: "non-elenco" }),
    });
    assert.equal(invalidGeo.status, 400);
    assert.match((await invalidGeo.json()).error, /elenco/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
