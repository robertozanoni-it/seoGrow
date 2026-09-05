import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const seoServer = await readFile(new URL("../server/wordpressSeoAdapterV2Hook.js", import.meta.url), "utf8");
const liveControl = await readFile(new URL("./WordPressLiveRemediationControlV2.jsx", import.meta.url), "utf8");
const runtime = await readFile(new URL("./RemediationRuntime.jsx", import.meta.url), "utf8");
const main = await readFile(new URL("./main.jsx", import.meta.url), "utf8");
const bootstrap = await readFile(new URL("../server/remediationBootstrap.js", import.meta.url), "utf8");

test("il live flow V2 è montato dal runtime nativo e non dipende dal riordino DOM legacy", () => {
  assert.match(runtime, /WordPressLiveRemediationControlV2/);
  assert.match(runtime, /RemediationHost/);
  assert.doesNotMatch(main, /remediationUiOrderPatch/);
  assert.doesNotMatch(main, /AuditUnifiedRemediation/);
});

test("la generazione SEO usa direttamente il nuovo endpoint robusto", () => {
  assert.match(liveControl, /\/api\/wordpress\/generate-seo-value-v2/);
  assert.match(seoServer, /collectOutputText/);
  assert.match(seoServer, /parseStructuredValue/);
  assert.match(seoServer, /max_output_tokens:\s*retry\s*\?\s*1200\s*:\s*900/);
  assert.match(seoServer, /deterministicMetaDescription/);
  assert.doesNotMatch(main, /wordpressSeoRuntimePatch/);
  assert.match(bootstrap, /wordpressSeoAdapterV2Hook/);
});
