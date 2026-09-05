import test from "node:test";
import assert from "node:assert/strict";
import { pageKind } from "../server/frontendVerificationHook.js";

test("pageKind non classifica come utility pagine che contengono casualmente contact nel nome", () => {
  assert.equal(pageKind("/blog/contact-lenses-seo/"), "content");
  assert.equal(pageKind("/servizi/author-branding/"), "content");
  assert.equal(pageKind("/blog/category-design/"), "content");
});

test("pageKind riconosce solo segmenti WordPress realmente speciali", () => {
  assert.equal(pageKind("/contact/"), "utility");
  assert.equal(pageKind("/contatti/"), "utility");
  assert.equal(pageKind("/category/seo/"), "archive");
  assert.equal(pageKind("/author/admin/"), "archive");
  assert.equal(pageKind("/page/2/"), "archive");
  assert.equal(pageKind("/privacy-policy/"), "gdpr");
});
