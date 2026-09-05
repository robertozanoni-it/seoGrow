import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./ProblemsWorkspace.jsx", import.meta.url), "utf8");
const bridge = await readFile(new URL("./ProblemsNavBridge.jsx", import.meta.url), "utf8");
const css = await readFile(new URL("./ProblemsWorkspace.css", import.meta.url), "utf8");
const main = await readFile(new URL("./main.jsx", import.meta.url), "utf8");

test("il Centro Problemi unifica Audit Task e Correzioni senza scritture", () => {
  assert.match(workspace, /Audit SeoGrow/);
  assert.match(workspace, /Task SeoGrow/);
  assert.match(workspace, /Correzioni WordPress/);
  assert.match(workspace, /Perché lo vedo\?/);
  assert.match(workspace, /Prossima azione/);
  assert.doesNotMatch(workspace, /window\.fetch\s*=/);
  assert.doesNotMatch(workspace, /MutationObserver/);
});

test("gli stati visuali del Centro Problemi sono coerenti", () => {
  for (const status of ["Da fare", "In lavorazione", "Da verificare", "Verificato"]) {
    assert.match(workspace, new RegExp(status));
  }
  for (const filter of ["Tutti", "Critici", "Da verificare", "Verificati"]) {
    assert.match(workspace, new RegExp(filter));
  }
});

test("il Centro Problemi offre vista compatta e dettagliata con drawer", () => {
  assert.match(workspace, /Compatta/);
  assert.match(workspace, /Dettagliata/);
  assert.match(css, /\.problem-drawer/);
  assert.match(css, /data-problems-open/);
});

test("Problemi è montato e raggiungibile dalla navigazione guidata", () => {
  assert.match(bridge, />Problemi</);
  assert.match(main, /<ProblemsNavBridge \/>/);
  assert.match(main, /<ProblemsWorkspace \/>/);
});
