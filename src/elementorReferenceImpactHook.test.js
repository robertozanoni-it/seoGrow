import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  extractRestElementorData,
  normalizeRestBase,
} from "../server/elementorReferenceImpactHook.js";

const source = await readFile(
  new URL("../server/elementorReferenceImpactHook.js", import.meta.url),
  "utf8",
);

test("meta Elementor REST vuoto è una scansione valida senza riferimenti", () => {
  assert.deepEqual(extractRestElementorData({ meta: { _elementor_data: "" } }), {
    ok: true,
    status: "no-elementor-data",
    value: [],
  });
});

test("meta Elementor non esposto resta fail-closed", () => {
  assert.equal(extractRestElementorData({ meta: {} }).ok, false);
  assert.equal(extractRestElementorData({}).status, "elementor-meta-unavailable");
});

test("page e post usano rest base core note", () => {
  assert.deepEqual(normalizeRestBase("page", null), {
    ok: true,
    restBase: "pages",
    source: "core-known",
  });
  assert.deepEqual(normalizeRestBase("post", null), {
    ok: true,
    restBase: "posts",
    source: "core-known",
  });
});

test("custom post type usa solo rest_base dichiarata e sicura", () => {
  assert.deepEqual(normalizeRestBase("product", { rest_base: "products" }), {
    ok: true,
    restBase: "products",
    source: "wordpress-type-descriptor",
  });
  assert.equal(normalizeRestBase("product", { rest_base: "../users" }).ok, false);
  assert.equal(normalizeRestBase("product", { rest_base: "products/v2" }).ok, false);
  assert.equal(normalizeRestBase("product", {}).ok, false);
});

test("hook usa inventario Connector autorevole e risolve i CPT via type descriptor", () => {
  assert.match(source, /wordpress-public-inventory/);
  assert.match(source, /validateAuthoritativeWordPressInventory/);
  assert.match(source, /\/wp-json\/wp\/v2\/types\//);
  assert.match(source, /rest_base/);
  assert.match(source, /unsupported-authoritative-post-types/);
});

test("CPT senza rest_base sicura resta fail-closed in attesa del Connector diretto", () => {
  assert.match(source, /Restano fail-closed finché il Connector non fornisce _elementor_data direttamente/);
  assert.match(source, /unsupportedPostTypes/);
  assert.match(source, /affectedPagesEnumerated:\s*false/);
});

test("lettura documenti usa context edit e meta _elementor_data", () => {
  assert.match(source, /\?context=edit/);
  assert.match(source, /_elementor_data/);
  assert.match(source, /scanElementorExplicitReferences/);
  assert.match(source, /aggregateElementorReferenceImpact/);
});

test("cross-page impact resta strettamente read-only", () => {
  assert.doesNotMatch(source, /sharedWriteAllowed:\s*true/);
  assert.match(source, /sharedWriteAllowed:\s*false/);
  assert.doesNotMatch(source, /wp_update_post|update_post_meta|delete_post_meta|WP_REST_Server::CREATABLE/i);
});

test("route cross-page è POST locale e fallisce chiusa sugli errori", () => {
  assert.match(source, /\/api\/wordpress\/elementor-reference-impact/);
  assert.match(source, /app\.post\(ROUTE/);
  assert.match(source, /affectedPagesEnumerated:\s*false/);
});
