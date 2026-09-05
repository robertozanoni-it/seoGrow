import test from "node:test";
import assert from "node:assert/strict";
import { visibleText } from "../server/frontendVerificationHook.js";

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
