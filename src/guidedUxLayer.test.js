import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const layer = await readFile(new URL("./GuidedUxLayer.jsx", import.meta.url), "utf8");
const css = await readFile(new URL("./GuidedUxLayer.css", import.meta.url), "utf8");
const main = await readFile(new URL("./main.jsx", import.meta.url), "utf8");

test("la UX guidata espone priorità e modalità semplice/avanzata", () => {
  assert.match(layer, /Cosa fare adesso/);
  assert.match(layer, /Modalità semplice/);
  assert.match(layer, /Modalità avanzata/);
  assert.match(layer, /Analizza → Capisci → Correggi → Verifica → Monitora/);
  assert.match(layer, /\["Correzioni", CheckCircle2\]/);
});

test("la nuova UX non introduce altri MutationObserver o monkey patch fetch", () => {
  assert.doesNotMatch(layer, /MutationObserver/);
  assert.doesNotMatch(layer, /window\.fetch\s*=/);
  assert.doesNotMatch(layer, /globalThis\.fetch\s*=/);
});

test("la sidebar originale resta come fallback se il layer non monta", () => {
  assert.match(css, /body\[data-seogrow-ui-mode\] \.sidebar > nav:not\(\.guided-nav\)/);
  assert.doesNotMatch(css, /^\.sidebar > nav:not\(\.guided-nav\)\s*\{[^}]*display:\s*none/m);
});

test("il bootstrap monta esplicitamente il layer guidato", () => {
  assert.match(main, /import GuidedUxLayer from ['"]\.\/GuidedUxLayer['"]/);
  assert.match(main, /<GuidedUxLayer \/>/);
});
