import test from "node:test";
import assert from "node:assert/strict";
import { stripAlwaysHiddenMarkup, visibleH1Count, visibleText } from "../server/frontendVerificationHook.js";

test("la verifica frontend non conta contenuto sempre nascosto", () => {
  const html = `
    <main>
      <p>Testo realmente visibile</p>
      <section hidden><p>contenuto hidden da ignorare</p></section>
      <div aria-hidden="true"><p>contenuto aria da ignorare</p></div>
      <div style="display:none"><p>contenuto display none da ignorare</p></div>
      <div style="visibility: hidden"><p>contenuto visibility hidden da ignorare</p></div>
      <template><p>contenuto template da ignorare</p></template>
      <noscript><p>contenuto noscript da ignorare</p></noscript>
    </main>`;
  const text = visibleText(html);
  assert.match(text, /Testo realmente visibile/);
  assert.doesNotMatch(text, /contenuto (?:hidden|aria|display|visibility|template|noscript)/);
});

test("la verifica frontend conserva testo visibile ed entità HTML", () => {
  const text = visibleText('<main><p>Pane &amp; olio&nbsp;buono</p><span>testo normale</span></main>');
  assert.equal(text, "Pane & olio buono testo normale");
});

test("un H1 dentro un wrapper nascosto non viene contato come visibile", () => {
  const html = `
    <main>
      <section style="display:none"><div><h1>H1 nascosto da antenato</h1></div></section>
      <section><h1>H1 visibile</h1></section>
    </main>`;
  const conservative = stripAlwaysHiddenMarkup(html);
  assert.equal(visibleH1Count(conservative), 1);
  assert.match(visibleText(conservative), /H1 visibile/);
  assert.doesNotMatch(visibleText(conservative), /H1 nascosto/);
});

test("markup Elementor marcato hidden per viewport non prova la visibilità frontend", () => {
  const html = `
    <main>
      <section class="elementor-section elementor-hidden-desktop"><h1>H1 responsive ambiguo</h1><p>Contenuto responsive ambiguo</p></section>
      <section><h1>H1 stabile</h1><p>Contenuto stabile</p></section>
    </main>`;
  const conservative = stripAlwaysHiddenMarkup(html);
  assert.equal(visibleH1Count(conservative), 1);
  assert.doesNotMatch(visibleText(conservative), /responsive ambiguo/);
  assert.match(visibleText(conservative), /Contenuto stabile/);
});
