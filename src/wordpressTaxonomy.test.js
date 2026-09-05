import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeTaxonomyInspection } from "../server/wordpressTaxonomyHook.js";

const connector = await readFile(
  new URL("../wordpress-plugin/seogrow-connector/seogrow-connector.php", import.meta.url),
  "utf8",
);
const server = await readFile(new URL("../server/wordpressTaxonomyHook.js", import.meta.url), "utf8");

test("Connector 1.2 espone solo ispezione tassonomia read-only con identità da get_term_link", () => {
  assert.match(connector, /Version: 1\.2\.0/);
  assert.match(connector, /SEOGROW_CONNECTOR_VERSION = '1\.2\.0'/);
  assert.match(connector, /\/taxonomy-inspect/);
  assert.match(connector, /'readOnly' => true/);
  assert.match(connector, /get_term_link\(\$term\)/);
  assert.match(connector, /count\(\$matches\) !== 1/);
  assert.match(connector, /current_user_can\('edit_term', \$term->term_id\)/);
  assert.doesNotMatch(connector, /update_term_meta\s*\(/);
  assert.doesNotMatch(connector, /WPSEO_Taxonomy_Meta::set_value/);
});

test("Connector limita la prima fase a category e post_tag e legge entrambi gli adapter SEO senza scegliere", () => {
  assert.match(connector, /'taxonomy' => array\('category', 'post_tag'\)/);
  assert.match(connector, /rank_math_title/);
  assert.match(connector, /rank_math_description/);
  assert.match(connector, /rank_math_canonical_url/);
  assert.match(connector, /rank_math_robots/);
  assert.match(connector, /WPSEO_Taxonomy_Meta::get_term_meta/);
  assert.match(connector, /'rankMath' => \$has_rank_math/);
  assert.match(connector, /'yoast' => \$has_yoast/);
});

test("server verifica di nuovo URL e identità prima di accettare il contratto Connector", () => {
  const normalized = normalizeTaxonomyInspection({
    ok: true,
    readOnly: true,
    resource: "taxonomy",
    term: {
      id: 7,
      taxonomy: "category",
      slug: "seo",
      name: "SEO",
      description: "Categoria SEO",
      link: "https://example.com/argomenti/seo/",
    },
    seo: {
      rankMath: { title: "SEO" },
      yoast: null,
    },
    plugins: { rankMath: true, yoast: false },
  }, "https://example.com/argomenti/seo/");

  assert.equal(normalized.term.id, 7);
  assert.equal(normalized.term.taxonomy, "category");
  assert.equal(normalized.ownership, "rank-math-only");
  assert.equal(normalized.writable, false);
});

test("server rifiuta alias, host diverso e tassonomie non supportate", () => {
  const base = {
    ok: true,
    readOnly: true,
    resource: "taxonomy",
    term: {
      id: 9,
      taxonomy: "post_tag",
      slug: "seo",
      name: "SEO",
      link: "https://example.com/tag/seo/",
    },
    seo: {},
    plugins: { rankMath: false, yoast: true },
  };
  assert.throws(
    () => normalizeTaxonomyInspection(base, "https://example.com/tag/seo-diverso/"),
    /non coincide esattamente/i,
  );
  assert.throws(
    () => normalizeTaxonomyInspection(base, "https://www.example.com/tag/seo/"),
    /non coincide esattamente/i,
  );
  assert.throws(
    () => normalizeTaxonomyInspection({ ...base, term: { ...base.term, taxonomy: "author" } }, base.term.link),
    /Identità tassonomia.*non valida/i,
  );
});

test("due plugin SEO attivi restano ownership ambigua e nessuna scrittura è esposta", () => {
  const normalized = normalizeTaxonomyInspection({
    ok: true,
    readOnly: true,
    resource: "taxonomy",
    term: {
      id: 10,
      taxonomy: "category",
      slug: "marketing",
      name: "Marketing",
      link: "https://example.com/category/marketing/",
    },
    seo: {
      rankMath: { title: "RM" },
      yoast: { title: "Yoast" },
    },
    plugins: { rankMath: true, yoast: true },
  }, "https://example.com/category/marketing/");
  assert.equal(normalized.ownership, "ambiguous");
  assert.equal(normalized.writable, false);
  assert.match(normalized.nextStep, /Confermare quale plugin SEO possiede/i);
  assert.match(server, /SeoGrow Connector 1\.2\.0 o superiore/);
});
