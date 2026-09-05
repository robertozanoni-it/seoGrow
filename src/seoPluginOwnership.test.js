import test from "node:test";
import assert from "node:assert/strict";
import { noindexIntent, resolveSeoPluginOwner } from "./seoPluginOwnership.js";

const entity = (meta) => ({ meta });

test("usa direttamente l'unico plugin che espone il campo", () => {
  assert.deepEqual(
    resolveSeoPluginOwner(entity({ rank_math_description: "Descrizione" }), "meta_description", { metaDescription: "altro" }).owner,
    ["rank_math_description", "Rank Math"],
  );
});

test("con Rank Math e Yoast sceglie solo un match frontend univoco", () => {
  const result = resolveSeoPluginOwner(entity({
    rank_math_description: "Descrizione realmente pubblica",
    _yoast_wpseo_metadesc: "Vecchia descrizione",
  }), "meta_description", { metaDescription: "Descrizione realmente pubblica" });
  assert.deepEqual(result.owner, ["rank_math_description", "Rank Math"]);
  assert.equal(result.evidence, "frontend-value-match");
});

test("non usa priorità arbitraria se entrambi coincidono o nessuno coincide", () => {
  const both = resolveSeoPluginOwner(entity({
    rank_math_title: "Titolo pubblico",
    _yoast_wpseo_title: "Titolo pubblico",
  }), "title", { title: "Titolo pubblico" });
  assert.equal(both.owner, null);
  assert.equal(both.evidence, "multiple-frontend-matches");

  const none = resolveSeoPluginOwner(entity({
    rank_math_title: "%title% | Brand",
    _yoast_wpseo_title: "%%title%% %%sep%% Brand",
  }), "title", { title: "Pagina | Brand" });
  assert.equal(none.owner, null);
  assert.equal(none.evidence, "no-unique-frontend-match");
});

test("canonical normalizza host www ma non inventa equivalenza di percorso", () => {
  const result = resolveSeoPluginOwner(entity({
    rank_math_canonical_url: "https://www.example.com/pagina/",
    _yoast_wpseo_canonical: "https://example.com/altra/",
  }), "canonical", { canonical: "https://example.com/pagina/" });
  assert.deepEqual(result.owner, ["rank_math_canonical_url", "Rank Math"]);
});

test("noindex viene attribuito solo quando l'intento dei due plugin è distinguibile", () => {
  assert.equal(noindexIntent("_yoast_wpseo_meta-robots-noindex", "1"), true);
  assert.equal(noindexIntent("_yoast_wpseo_meta-robots-noindex", "2"), false);
  const result = resolveSeoPluginOwner(entity({
    rank_math_robots: ["index", "follow"],
    "_yoast_wpseo_meta-robots-noindex": "1",
  }), "noindex", { noindex: true });
  assert.deepEqual(result.owner, ["_yoast_wpseo_meta-robots-noindex", "Yoast"]);
});
