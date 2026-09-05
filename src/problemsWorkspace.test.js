import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./ProblemsWorkspace.jsx", import.meta.url), "utf8");
const bridge = await readFile(new URL("./ProblemsNavBridge.jsx", import.meta.url), "utf8");
const css = await readFile(new URL("./ProblemsWorkspace.css", import.meta.url), "utf8");
const main = await readFile(new URL("./main.jsx", import.meta.url), "utf8");

test("il Centro Problemi unifica Audit Task e Correzioni senza scritture", () => {
  assert.match(workspace, /buildUnifiedProblems/);
  assert.match(workspace, /listCorrections/);
  assert.match(workspace, /item === "audit" \? "Audit" : item === "task" \? "Task" : "Correzioni"/);
  assert.match(workspace, /Qual è la prova/);
  assert.match(workspace, /Che cosa propone SeoGrow/);
  assert.match(workspace, /Prossima azione/);
  assert.doesNotMatch(workspace, /window\.fetch\s*=/);
  assert.doesNotMatch(workspace, /MutationObserver/);
});

test("gli stati visuali del Centro Problemi sono coerenti con il modello di affidabilità", () => {
  for (const status of ["Aperto", "Da confermare", "Risolto", "Ricomparso", "Intenzionale"]) {
    assert.match(workspace, new RegExp(status));
  }
  for (const intervention of ["Da preparare", "Pronto", "Approvato", "Applicato", "Verificato tecnicamente", "Fallito", "Ripristinato", "Task completata"]) {
    assert.match(workspace, new RegExp(intervention));
  }
  for (const filter of ["Attivi", "Alta gravità", "Ricomparsi", "Risolti", "Tutti"]) {
    assert.match(workspace, new RegExp(filter));
  }
});

test("il Centro Problemi offre vista compatta e dettagliata con drawer accessibile", () => {
  assert.match(workspace, /Compatta/);
  assert.match(workspace, /Dettagliata/);
  assert.match(workspace, /role="dialog"/);
  assert.match(workspace, /aria-modal="true"/);
  assert.match(css, /\.problem-dialog-layer/);
  assert.match(css, /\.problem-drawer-scrim/);
  assert.match(css, /\.problem-drawer/);
});

test("Problemi è montato e raggiungibile dalla navigazione guidata", () => {
  assert.match(bridge, />Problemi</);
  assert.match(main, /<ProblemsNavBridge \/>/);
  assert.match(main, /<ProblemsWorkspace \/>/);
});
