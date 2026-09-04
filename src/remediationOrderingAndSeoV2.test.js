import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const uiPatch = await readFile(new URL("./remediationUiOrderPatch.js", import.meta.url), "utf8");
const seoRuntime = await readFile(new URL("./wordpressSeoRuntimePatch.js", import.meta.url), "utf8");
const seoServer = await readFile(new URL("../server/wordpressSeoAdapterV2Hook.js", import.meta.url), "utf8");
const main = await readFile(new URL("./main.jsx", import.meta.url), "utf8");
const bootstrap = await readFile(new URL("../server/remediationBootstrap.js", import.meta.url), "utf8");

test("la preparazione live viene portata prima delle vecchie azioni di correzione", () => {
  assert.match(uiPatch, /insertBefore\(live, actions\)/);
  assert.match(uiPatch, /Correggi tutti/);
  assert.match(uiPatch, /display.*none/);
  assert.match(main, /remediationUiOrderPatch/);
});

test("la generazione SEO usa il nuovo endpoint robusto", () => {
  assert.match(seoRuntime, /generate-seo-value-v2/);
  assert.match(seoServer, /collectOutputText/);
  assert.match(seoServer, /parseStructuredValue/);
  assert.match(seoServer, /max_output_tokens:\s*900/);
  assert.match(main, /wordpressSeoRuntimePatch/);
  assert.match(bootstrap, /wordpressSeoAdapterV2Hook/);
});
