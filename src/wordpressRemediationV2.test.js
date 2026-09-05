import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { shouldPreferElementorOwnership } from "./wordpressRemediationRuntimePatch.js";

const patchServer = await readFile(new URL("../server/wordpressPatchV2Hook.js", import.meta.url), "utf8");
const runtime = await readFile(new URL("./wordpressRemediationRuntimePatch.js", import.meta.url), "utf8");
const liveControl = await readFile(new URL("./WordPressLiveRemediationControl.jsx", import.meta.url), "utf8");
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

test("la remediation H1 usa WordPress core solo se il numero H1 coincide con il frontend", () => {
  assert.match(liveControl, /const countH1 =/);
  assert.match(liveControl, /const coreH1 = countH1\(entity\.content\?\.raw \|\| entity\.content\?\.rendered \|\| ""\)/);
  assert.match(liveControl, /frontendH1 === coreH1/);
});

test("un audit H1 stale viene marcato già risolto invece di tentare una patch inutile", () => {
  assert.match(liveControl, /const alreadyResolvedReason =/);
  assert.match(liveControl, /Number\(frontend\.h1\) === 1/);
  assert.match(liveControl, /status: "resolved"/);
  assert.match(liveControl, /problemi già risolti nel frontend corrente/);
});

test("la remediation usa l'audit aperto e non forza sempre l'ultimo audit", () => {
  assert.match(liveControl, /const selectAudit =/);
  assert.match(liveControl, /entry\.type === requested\.auditType/);
  assert.match(liveControl, /String\(auditTimestamp\(entry\)\) === String\(requested\.analyzedAt/);
  assert.match(liveControl, /seogrow-remediation-open/);
});

test("l'anteprima live ha un fallback locale e mostra i campi interessati", () => {
  assert.match(liveControl, /const localPreview =/);
  assert.match(liveControl, /if \(!hasUsefulPreview\(data\.previewBefore\)\) data\.previewBefore = fallback\.before/);
  assert.match(liveControl, /Campi interessati:/);
});

test("una pagina Elementor non viene instradata al content WordPress core", () => {
  const inspected = { entity: { meta: { _elementor_data: "[]" } } };
  assert.equal(shouldPreferElementorOwnership(inspected, { expected: { content: "testo" } }), true);
  assert.equal(shouldPreferElementorOwnership(inspected, { expected: { title: "titolo" } }), false);
  assert.equal(shouldPreferElementorOwnership({ entity: { meta: {} } }, { expected: { content: "testo" } }), false);
  assert.match(runtime, /data\.contentProbeVisible = false/);
  assert.match(runtime, /data\.seogrowOwnership = "elementor"/);
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
