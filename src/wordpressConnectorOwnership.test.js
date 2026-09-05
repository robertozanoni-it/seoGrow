import test from "node:test";
import assert from "node:assert/strict";
import { basePath, filterConnectorOwnedMeta } from "../server/wordpressInspectFastHook.js";

test("senza conferma del Connector i meta protetti non diventano scrivibili", () => {
  const entity = filterConnectorOwnedMeta({
    id: 42,
    meta: {
      _elementor_data: "[]",
      rank_math_title: "Rank title",
      _yoast_wpseo_title: "Yoast title",
      custom_public_meta: "resta",
    },
  }, null);
  assert.equal(entity.meta._elementor_data, undefined);
  assert.equal(entity.meta.rank_math_title, undefined);
  assert.equal(entity.meta._yoast_wpseo_title, undefined);
  assert.equal(entity.meta.custom_public_meta, "resta");
});

test("il Connector espone a SeoGrow solo il plugin SEO realmente attivo", () => {
  const source = {
    meta: {
      rank_math_title: "Rank title",
      rank_math_description: "Rank description",
      _yoast_wpseo_title: "Yoast title",
      _yoast_wpseo_metadesc: "Yoast description",
    },
  };
  const rank = filterConnectorOwnedMeta(source, { rankMath: true, yoast: false, elementor: false });
  assert.equal(rank.meta.rank_math_title, "Rank title");
  assert.equal(rank.meta._yoast_wpseo_title, undefined);

  const yoast = filterConnectorOwnedMeta(source, { rankMath: false, yoast: true, elementor: false });
  assert.equal(yoast.meta.rank_math_title, undefined);
  assert.equal(yoast.meta._yoast_wpseo_title, "Yoast title");
});

test("due plugin SEO attivi restano entrambi visibili così il client può bloccare l'ambiguità", () => {
  const entity = filterConnectorOwnedMeta({
    meta: { rank_math_title: "Rank", _yoast_wpseo_title: "Yoast" },
  }, { rankMath: true, yoast: true, elementor: false });
  assert.equal(entity.meta.rank_math_title, "Rank");
  assert.equal(entity.meta._yoast_wpseo_title, "Yoast");
});

test("l'ispezione WordPress conserva la sottocartella dell'installazione", () => {
  assert.equal(basePath(new URL("https://example.com/wordpress/")), "/wordpress");
  assert.equal(basePath(new URL("https://example.com/")), "");
});
