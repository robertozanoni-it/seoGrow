import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  normalizeTaxonomyInspection,
  taxonomyAdapter,
  taxonomyCurrentValue,
  taxonomyPublicVerification,
  validateTaxonomyChange,
} from "../server/wordpressTaxonomyHook.js";

const connector = await readFile(
  new URL("../wordpress-plugin/seogrow-connector/seogrow-connector.php", import.meta.url),
  "utf8",
);
const server = await readFile(new URL("../server/wordpressTaxonomyHook.js", import.meta.url), "utf8");

const rankInspection = () => normalizeTaxonomyInspection({
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
    rankMath: {
      title: "SEO",
      meta_description: "Descrizione SEO",
      canonical: "https://example.com/argomenti/seo/",
      noindex: false,
    },
    yoast: null,
  },
  plugins: { rankMath: true, yoast: false },
}, "https://example.com/argomenti/seo/");

test("Connector 1.3 conserva ispezione esatta e aggiunge solo scrittura tassonomia single-field", () => {
  assert.match(connector, /Version: 1\.3\.0/);
  assert.match(connector, /SEOGROW_CONNECTOR_VERSION = '1\.3\.0'/);
  assert.match(connector, /\/taxonomy-inspect/);
  assert.match(connector, /\/taxonomy-write/);
  assert.match(connector, /get_term_link\(\$term\)/);
  assert.match(connector, /count\(\$matches\) !== 1/);
  assert.match(connector, /current_user_can\('edit_term', \$term->term_id\)/);
  assert.match(connector, /'singleField' => true/);
  assert.match(connector, /'staleChecked' => true/);
});

test("Connector limita la remediation a category/post_tag e a quattro campi SEO espliciti", () => {
  assert.match(connector, /'taxonomy' => array\('category', 'post_tag'\)/);
  assert.match(connector, /array\('title', 'meta_description', 'canonical', 'noindex'\)/);
  assert.match(connector, /update_term_meta\(\$term->term_id, 'rank_math_robots'/);
  assert.match(connector, /update_term_meta\(\$term->term_id, \$keys\[\$field\], \$value\)/);
  assert.match(connector, /WPSEO_Taxonomy_Meta::set_value/);
  assert.match(connector, /taxonomyWriteSingleField' => true/);
});

test("Connector blocca plugin SEO ambiguo, adapter errato e stale state prima della scrittura", () => {
  const ambiguousCheck = connector.indexOf("seogrow_taxonomy_owner_ambiguous");
  const rankWrite = connector.indexOf("function seogrow_connector_taxonomy_write_rank_math");
  assert.ok(ambiguousCheck >= 0 && ambiguousCheck < rankWrite);
  assert.match(connector, /seogrow_taxonomy_adapter_mismatch/);
  assert.match(connector, /seogrow_taxonomy_stale/);
  assert.match(connector, /\$current !== \$expected/);
  assert.match(connector, /seogrow_taxonomy_persistence_unverified/);
});

test("server verifica di nuovo URL e identità prima di abilitare una preview", () => {
  const normalized = rankInspection();
  assert.equal(normalized.term.id, 7);
  assert.equal(normalized.term.taxonomy, "category");
  assert.equal(normalized.ownership, "rank-math-only");
  assert.equal(normalized.writable, true);
  assert.equal(taxonomyAdapter(normalized), "rank-math");
  assert.equal(taxonomyCurrentValue(normalized, "title"), "SEO");
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
    seo: { rankMath: null, yoast: { title: "SEO", noindex: false } },
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

test("due plugin SEO attivi restano ownership ambigua e non sono scrivibili", () => {
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
  assert.equal(taxonomyAdapter(normalized), "");
  assert.match(normalized.nextStep, /nessuna scrittura automatica/i);
});

test("canonical richiede conferma esplicita e resta confinata allo stesso host", () => {
  assert.equal(
    validateTaxonomyChange({
      field: "canonical",
      value: "https://example.com/argomenti/seo/",
      targetUrl: "https://example.com/argomenti/seo/",
      intent: { canonicalTargetConfirmed: true, canonicalTarget: "https://example.com/argomenti/seo/" },
    }),
    "https://example.com/argomenti/seo/",
  );
  assert.throws(() => validateTaxonomyChange({
    field: "canonical",
    value: "https://example.com/altro/",
    targetUrl: "https://example.com/argomenti/seo/",
    intent: {},
  }), /Intento canonical non confermato/i);
  assert.throws(() => validateTaxonomyChange({
    field: "canonical",
    value: "https://external.example/seo/",
    targetUrl: "https://example.com/argomenti/seo/",
    intent: { canonicalTargetConfirmed: true, canonicalTarget: "https://external.example/seo/" },
  }), /stesso host/i);
});

test("noindex richiede intento esplicito mentre il rollback usa lo stale state", () => {
  assert.equal(validateTaxonomyChange({
    field: "noindex",
    value: true,
    targetUrl: "https://example.com/category/seo/",
    intent: { indexingIntent: "noindex" },
  }), true);
  assert.throws(() => validateTaxonomyChange({
    field: "noindex",
    value: true,
    targetUrl: "https://example.com/category/seo/",
    intent: { indexingIntent: "index" },
  }), /Intento di indicizzazione non confermato/i);
  assert.equal(validateTaxonomyChange({
    field: "noindex",
    value: false,
    targetUrl: "https://example.com/category/seo/",
    mode: "rollback",
  }), false);
  assert.match(server, /STALE_ROLLBACK/);
  assert.match(server, /expectedCurrent/);
});

test("preview e apply tassonomie usano token monouso e non accettano payload di scrittura nell'apply", () => {
  assert.match(server, /\/api\/wordpress\/taxonomy-preview/);
  assert.match(server, /\/api\/wordpress\/taxonomy-apply/);
  assert.match(server, /crypto\.randomUUID\(\)/);
  assert.match(server, /APPROVALS\.delete\(token\)/);
  assert.match(server, /approval\.before/);
  assert.match(server, /approval\.after/);
  assert.match(server, /staleChecked/);
});

test("riverifica richiede coerenza sia del dato salvato sia dell'head pubblico", () => {
  assert.deepEqual(
    taxonomyPublicVerification("meta_description", "Descrizione SEO", {
      ok: true,
      isHtml: true,
      metaDescription: "Descrizione SEO",
    }),
    { verified: true, reason: "Meta description pubblica coerente con il valore applicato." },
  );
  assert.equal(taxonomyPublicVerification("noindex", true, { ok: true, isHtml: true, noindex: true }).verified, true);
  assert.equal(taxonomyPublicVerification("canonical", "", { ok: true, isHtml: true, canonical: "https://example.com/" }).verified, false);
  assert.equal(taxonomyPublicVerification("title", "%%term_title%%", { ok: true, isHtml: true, title: "SEO" }).verified, false);
  assert.match(server, /storedMatch/);
  assert.match(server, /publicMatch/);
  assert.match(server, /verificationRequired: true/);
});
