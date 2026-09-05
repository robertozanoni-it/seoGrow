import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  basePath,
  elementorLibraryEndpoint,
  elementorLibraryRestDescriptor,
  elementorOwnershipEvidence,
  filterConnectorOwnedMeta,
} from "../server/wordpressInspectFastHook.js";

const inspectSource = await readFile(new URL("../server/wordpressInspectFastHook.js", import.meta.url), "utf8");

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

test("due plugin SEO attivi restano entrambi visibili senza prova frontend univoca", () => {
  const entity = filterConnectorOwnedMeta({
    meta: { rank_math_title: "Rank", _yoast_wpseo_title: "Yoast" },
  }, { rankMath: true, yoast: true, elementor: false });
  assert.equal(entity.meta.rank_math_title, "Rank");
  assert.equal(entity.meta._yoast_wpseo_title, "Yoast");
});

test("due plugin attivi con un solo campo salvato forzano comunque l'ambiguità", () => {
  const entity = filterConnectorOwnedMeta({
    meta: { rank_math_title: "Titolo pubblico" },
  }, { rankMath: true, yoast: true, elementor: false }, { title: "Titolo pubblico" });
  assert.equal(entity.meta.rank_math_title, "Titolo pubblico");
  assert.equal(Object.prototype.hasOwnProperty.call(entity.meta, "_yoast_wpseo_title"), true);
  assert.equal(entity.meta._yoast_wpseo_title, null);
});

test("con due plugin attivi elimina soltanto il campo concorrente smentito dal frontend", () => {
  const entity = filterConnectorOwnedMeta({
    meta: {
      rank_math_title: "Titolo pubblico",
      _yoast_wpseo_title: "Titolo vecchio",
      rank_math_description: "Descrizione vecchia",
      _yoast_wpseo_metadesc: "Descrizione pubblica",
      rank_math_canonical_url: "https://example.com/pagina/",
      _yoast_wpseo_canonical: "https://example.com/altra/",
      rank_math_robots: ["index", "follow"],
      "_yoast_wpseo_meta-robots-noindex": "1",
    },
  }, { rankMath: true, yoast: true, elementor: false }, {
    title: "Titolo pubblico",
    metaDescription: "Descrizione pubblica",
    canonical: "https://www.example.com/pagina/",
    noindex: true,
  });

  assert.equal(entity.meta.rank_math_title, "Titolo pubblico");
  assert.equal(entity.meta._yoast_wpseo_title, undefined);
  assert.equal(entity.meta.rank_math_description, undefined);
  assert.equal(entity.meta._yoast_wpseo_metadesc, "Descrizione pubblica");
  assert.equal(entity.meta.rank_math_canonical_url, "https://example.com/pagina/");
  assert.equal(entity.meta._yoast_wpseo_canonical, undefined);
  assert.equal(entity.meta.rank_math_robots, undefined);
  assert.equal(entity.meta["_yoast_wpseo_meta-robots-noindex"], "1");
});

test("se entrambi i plugin coincidono col frontend l'ambiguità resta bloccabile dal client", () => {
  const entity = filterConnectorOwnedMeta({
    meta: {
      rank_math_title: "Stesso titolo",
      _yoast_wpseo_title: "Stesso titolo",
    },
  }, { rankMath: true, yoast: true, elementor: false }, { title: "Stesso titolo" });
  assert.equal(entity.meta.rank_math_title, "Stesso titolo");
  assert.equal(entity.meta._yoast_wpseo_title, "Stesso titolo");
});

test("l'ispezione conserva separatamente il rischio di ownership Elementor condivisa non ancora risolta", () => {
  const entity = filterConnectorOwnedMeta({
    id: 42,
    meta: { _elementor_data: "[]" },
  }, {
    elementor: true,
    elementorPro: true,
    elementorSharedTemplateTypes: ["single", "popup"],
    rankMath: false,
    yoast: false,
  });
  assert.equal(entity.meta._elementor_data, "[]");
  assert.equal(entity._seogrowOwnership.elementorPro, true);
  assert.deepEqual(entity._seogrowOwnership.elementorSharedTemplateTypes, ["single", "popup"]);
  assert.equal(entity._seogrowOwnership.elementorEvidenceStatus, "shared-templates-present-unresolved");
});

test("gli ID Elementor renderizzati distinguono documento locale e documenti condivisi effettivi", () => {
  const evidence = elementorOwnershipEvidence(
    { id: 42 },
    { elementor: true, elementorSharedTemplateTypes: ["header", "footer", "single"] },
    {
      elementorDocuments: [
        { id: 42, type: "wp-page" },
        { id: 88, type: "header" },
        { id: 91, type: "footer" },
      ],
    },
  );
  assert.equal(evidence.elementorEvidenceStatus, "rendered-shared-documents");
  assert.equal(evidence.elementorLocalDocumentRendered, true);
  assert.deepEqual(evidence.elementorExternalRenderedDocuments, [
    { id: 88, type: "header" },
    { id: 91, type: "footer" },
  ]);
});

test("Elementor Library viene risolta tramite la REST base dichiarata da WordPress", () => {
  const descriptor = elementorLibraryRestDescriptor({
    elementor_library: {
      slug: "elementor_library",
      rest_namespace: "wp/v2",
      rest_base: "elementor_library",
    },
  });
  assert.deepEqual(descriptor, { namespace: "wp/v2", restBase: "elementor_library" });
  assert.equal(
    elementorLibraryEndpoint(new URL("https://example.com/wordpress/"), descriptor, 88).href,
    "https://example.com/wordpress/wp-json/wp/v2/elementor_library/88?context=edit",
  );
});

test("descriptor REST Elementor con traversal o segmenti vuoti viene rifiutato", () => {
  assert.equal(elementorLibraryRestDescriptor({
    elementor_library: { slug: "elementor_library", rest_namespace: "wp/../v2", rest_base: "elementor_library" },
  }), null);
  assert.equal(elementorLibraryRestDescriptor({
    elementor_library: { slug: "elementor_library", rest_namespace: "wp/v2", rest_base: "elementor_library//private" },
  }), null);
  assert.throws(
    () => elementorLibraryEndpoint(new URL("https://example.com/"), { namespace: "wp/v2", restBase: "../users" }, 88),
    /REST base Elementor Library non disponibile/,
  );
});

test("template presenti nel sito non bloccano genericamente una pagina quando il frontend mostra solo il documento locale", () => {
  const entity = filterConnectorOwnedMeta({
    id: 42,
    meta: { _elementor_data: "[]" },
  }, {
    elementor: true,
    elementorPro: true,
    elementorSharedTemplateTypes: ["header", "footer", "popup"],
    rankMath: false,
    yoast: false,
  }, {
    elementorDocuments: [{ id: 42, type: "wp-page" }],
  });
  assert.equal(entity._seogrowOwnership.elementorEvidenceStatus, "local-document-only-observed");
  assert.equal(entity._seogrowOwnership.elementorExternalRenderedDocuments.length, 0);
  assert.equal(entity._seogrowOwnership.elementorLocalDocumentRendered, true);
});

test("l'ispezione WordPress conserva la sottocartella dell'installazione", () => {
  assert.equal(basePath(new URL("https://example.com/wordpress/")), "/wordpress");
  assert.equal(basePath(new URL("https://example.com/")), "");
  assert.match(inspectSource, /const \{ siteUrl, url, username, applicationPassword \}/);
  assert.match(inspectSource, /safeBase\(siteUrl \|\| target\.origin\)/);
  assert.match(inspectSource, /resolveEntity\(base, headers, target\.href\)/);
  assert.match(inspectSource, /appartengono a host diversi/);
});