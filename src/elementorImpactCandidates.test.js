import test from "node:test";
import assert from "node:assert/strict";
import { buildElementorImpactCandidateUrls } from "./elementorImpactCandidates.js";

test("le URL candidate Elementor includono target, crawl e issue senza duplicati", () => {
  const urls = buildElementorImpactCandidateUrls({
    issue: { targetUrl: "https://example.com/pagina/" },
    audit: {
      url: "https://example.com/",
      pages: [
        { url: "https://example.com/pagina/" },
        { url: "https://example.com/due/" },
        "https://example.com/tre/",
      ],
      issues: [
        { url: "https://example.com/quattro/" },
        { targetUrl: "https://example.com/due/" },
      ],
    },
    client: { url: "https://example.com/" },
  });
  assert.deepEqual(urls, [
    "https://example.com/pagina/",
    "https://example.com/",
    "https://example.com/due/",
    "https://example.com/tre/",
    "https://example.com/quattro/",
  ]);
});

test("le candidate Elementor sono sempre limitate a 30 prima del filtro same-host server", () => {
  const urls = buildElementorImpactCandidateUrls({
    audit: { pages: Array.from({ length: 50 }, (_, index) => ({ url: `https://example.com/${index}/` })) },
  });
  assert.equal(urls.length, 30);
  assert.equal(urls[0], "https://example.com/0/");
  assert.equal(urls.at(-1), "https://example.com/29/");
});
