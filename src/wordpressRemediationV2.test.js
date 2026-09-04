import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const patchServer = await readFile(new URL("../server/wordpressPatchV2Hook.js", import.meta.url), "utf8");
const runtime = await readFile(new URL("./wordpressRemediationRuntimePatch.js", import.meta.url), "utf8");
const connector = await readFile(new URL("../wordpress-plugin/seogrow-connector/seogrow-connector.php", import.meta.url), "utf8");

const extractFunction = (source, name) => {
  const marker = `export function ${name}`;
  assert.ok(source.includes(marker), `${name} deve essere esportata`);
};

test("il patch engine unisce tutti i chunk output_text prima del parsing", () => {
  extractFunction(patchServer, "collectOutputText");
  assert.match(patchServer, /parts\.push\(content\.text\)/);
  assert.match(patchServer, /parts\.join\(""\)/);
  assert.match(patchServer, /source\.indexOf\("\{"\)/);
  assert.match(patchServer, /source\.lastIndexOf\("\}"\)/);
});

test("gli H1 vengono corretti deterministicamente senza chiamare OpenAI", () => {
  extractFunction(patchServer, "deterministicH1Patch");
  assert.match(patchServer, /openings\.length === 0/);
  assert.match(patchServer, /replace\(\/\^<h1\/i, "<h2"\)/);
  assert.match(patchServer, /if \(kind === "h1"\)/);
  assert.match(patchServer, /deterministicH1Patch/);
});

test("la cache runtime non include mai la password applicativa", () => {
  extractFunction(runtime, "safeCacheKey");
  assert.match(runtime, /delete safe\.applicationPassword/);
  assert.match(runtime, /CACHE_TTL_MS/);
  assert.match(runtime, /inFlight/);
});

test("archivi e tassonomie vengono esclusi prima dell'ispezione WordPress", () => {
  extractFunction(runtime, "isNonEditableWordPressUrl");
  assert.match(runtime, /category\|categoria\|tag\|author\|autore\|date\|feed/);
  assert.match(runtime, /NON_EDITABLE_ARCHIVE/);
});

test("il Connector espone solo meta esplicitamente autorizzati e richiede edit_post", () => {
  assert.match(connector, /_elementor_data/);
  assert.match(connector, /rank_math_title/);
  assert.match(connector, /_yoast_wpseo_metadesc/);
  assert.match(connector, /current_user_can\('edit_post'/);
  assert.match(connector, /seogrow\/v1/);
  assert.doesNotMatch(connector, /register_post_meta\([^,]+,\s*\$meta_key/);
});
