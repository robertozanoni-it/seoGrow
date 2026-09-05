import test from "node:test";
import assert from "node:assert/strict";
import { countTextWords, chooseElementorContentCandidate } from "./wordpressOwnership.js";

test("countTextWords conserva il significato delle HTML entities", () => {
  assert.equal(countTextWords("SEO&nbsp;Grow &amp; WordPress"), 4);
  assert.equal(countTextWords("uno&#32;due&#x20;tre"), 3);
});

test("Elementor può essere identificato da probe completi anche senza copertura pagina maggioritaria", () => {
  const result = chooseElementorContentCandidate(
    [{ id: "widget-a", item: {}, value: "contenuto ".repeat(20), words: 20 }],
    [{
      contentProbeVisible: true,
      contentCoverageStrong: false,
      contentProbeCount: 3,
      contentProbeMatches: 3,
      expectedWords: 20,
    }],
  );
  assert.equal(result.candidate?.id, "widget-a");
});
