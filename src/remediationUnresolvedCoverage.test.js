import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const patchServer = await readFile(new URL("../server/wordpressPatchV2Hook.js", import.meta.url), "utf8");
const seoServer = await readFile(new URL("../server/wordpressSeoAdapterV2Hook.js", import.meta.url), "utf8");

test("title ed excerpt possono usare contesto ridotto senza allentare la protezione content", () => {
  assert.match(patchServer, /export function aiContext\(page, kind\)/);
  assert.match(patchServer, /if \(kind === "content"\)/);
  assert.match(patchServer, /raw\.content\.length > 16000/);
  assert.match(patchServer, /raw\.content\.slice\(0, 6000\)/);
  assert.match(patchServer, /raw\.content\.slice\(-1500\)/);
  assert.match(patchServer, /const context = aiContext\(page, kind\)/);
});

test("la meta description ritenta OpenAI con feedback e usa un fallback deterministico dopo tre tentativi", () => {
  assert.match(seoServer, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/);
  assert.match(seoServer, /requestValue\(kind, issue, context, attempt > 0, qualityFeedback\)/);
  assert.match(seoServer, /qualityFeedback = quality\.errors\.join\(" "\)/);
  assert.match(seoServer, /deterministicMetaDescription/);
  assert.match(seoServer, /kind === "meta_description"/);
  assert.match(seoServer, /max_output_tokens: retry \? 1200 : 900/);
  assert.match(seoServer, /data\?\.incomplete_details/);
});
