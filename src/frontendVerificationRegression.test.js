import test from "node:test";
import assert from "node:assert/strict";
import {
  hasResponsiveHiddenMarkup,
  pageKind,
  stripAlwaysHiddenMarkup,
  visibleH1Count,
} from "../server/frontendVerificationHook.js";

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

test("le classi responsive Elementor vengono rilevate ma non trattate come sempre nascoste", () => {
  const html = '<section class="elementor-hidden-desktop"><h1>Titolo mobile</h1><p>Contenuto mobile</p></section>';
  assert.equal(hasResponsiveHiddenMarkup(html), true);
  assert.match(stripAlwaysHiddenMarkup(html), /Titolo mobile/);
  assert.equal(visibleH1Count(stripAlwaysHiddenMarkup(html)), 1);
});

test("hidden, aria-hidden e style inline realmente invisibili restano esclusi dal modello statico", () => {
  const html = [
    '<section hidden><h1>Hidden native</h1></section>',
    '<section aria-hidden="true"><h1>Hidden aria</h1></section>',
    '<section style="display:none"><h1>Hidden style</h1></section>',
    '<main><h1>Visibile</h1></main>',
  ].join("");
  const cleaned = stripAlwaysHiddenMarkup(html);
  assert.doesNotMatch(cleaned, /Hidden native|Hidden aria|Hidden style/);
  assert.match(cleaned, /Visibile/);
  assert.equal(visibleH1Count(cleaned), 1);
});
