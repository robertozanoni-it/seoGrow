import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assessCoreOwnership,
  chooseElementorContentCandidate,
  inspectEditableElementor,
} from "./wordpressOwnership.js";

const patchServer = await readFile(new URL("../server/wordpressPatchV2Hook.js", import.meta.url), "utf8");
const runtime = await readFile(new URL("./wordpressRemediationRuntimePatch.js", import.meta.url), "utf8");
const liveControl = await readFile(new URL("./WordPressLiveRemediationControl.jsx", import.meta.url), "utf8");
const frontendVerification = await readFile(new URL("../server/frontendVerificationHook.js", import.meta.url), "utf8");
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

test("ownership WordPress core richiede copertura forte e non un solo probe", () => {
  const entity = { content: { raw: "<h1>Titolo</h1><p>uno due tre quattro cinque sei sette otto nove dieci undici dodici tredici quattordici quindici sedici diciassette diciotto diciannove venti</p>" } };
  const weak = assessCoreOwnership("content", entity, {
    contentProbeVisible: true,
    words: 30,
    expectedWords: 20,
    contentProbeCount: 3,
    contentProbeMatches: 1,
    contentCoverageStrong: false,
  });
  assert.equal(weak.ok, false);

  const strong = assessCoreOwnership("content", entity, {
    contentProbeVisible: true,
    words: 30,
    expectedWords: 21,
    contentProbeCount: 3,
    contentProbeMatches: 3,
    contentCoverageStrong: true,
  });
  assert.equal(strong.ok, true);
});

test("la remediation H1 core richiede sia copertura forte sia conteggio H1 coincidente", () => {
  const entity = { content: { raw: "<h1>Titolo</h1><p>contenuto sufficientemente lungo per una pagina WordPress core con testo visibile e verificabile</p>" } };
  const frontend = {
    h1: 1,
    words: 20,
    expectedWords: 16,
    contentProbeCount: 1,
    contentProbeMatches: 1,
    contentCoverageStrong: true,
  };
  assert.equal(assessCoreOwnership("h1", entity, frontend).ok, true);
  assert.equal(assessCoreOwnership("h1", entity, { ...frontend, h1: 2 }).ok, false);
});

test("Elementor content espone solo text-editor statici modificabili", () => {
  const entity = {
    meta: {
      _elementor_data: JSON.stringify([
        { widgetType: "heading", settings: { title: "Titolo", header_size: "h1" }, elements: [] },
        { widgetType: "text-editor", settings: { editor: "<p>Testo Elementor visibile</p>" }, elements: [] },
        { widgetType: "text-editor", settings: { editor: "<p>Dinamico</p>", __dynamic__: { editor: "token" } }, elements: [] },
      ]),
    },
  };
  const state = inspectEditableElementor("content", entity);
  assert.equal(state.state, "valid");
  assert.equal(state.widgets.length, 1);
  assert.match(state.widgets[0].value, /Testo Elementor/);
});

test("il candidato Elementor ambiguo viene bloccato invece di scegliere il più lungo alla cieca", () => {
  const candidates = [
    { item: { id: "a" }, value: "testo uno", words: 30 },
    { item: { id: "b" }, value: "testo due", words: 28 },
  ];
  const probes = [{ contentProbeVisible: true }, { contentProbeVisible: true }];
  const selected = chooseElementorContentCandidate(candidates, probes, 90);
  assert.equal(selected.candidate, null);
  assert.match(selected.reason, /Più text-editor Elementor/);
});

test("buildPlan valuta Elementor prima di autorizzare il fallback WordPress core", () => {
  const elementorBranch = liveControl.indexOf('elementorState.state === "valid" && elementorState.widgets.length > 0');
  const coreBranch = liveControl.indexOf("if (ownership.ok)", elementorBranch);
  assert.ok(elementorBranch >= 0);
  assert.ok(coreBranch > elementorBranch);
  assert.match(liveControl, /Il fallback su post_content è bloccato/);
  assert.match(liveControl, /changes: \{ meta: \{ _elementor_data:/);
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

test("il verificatore frontend produce evidenza multi-probe per ownership core", () => {
  extractFunction(frontendVerification, "contentOwnershipEvidence");
  assert.match(frontendVerification, /contentProbeMatches/);
  assert.match(frontendVerification, /contentProbeCount/);
  assert.match(frontendVerification, /contentCoverageStrong/);
  assert.match(frontendVerification, /expectedWords/);
});

test("il runtime non altera più artificialmente l'ownership Elementor", () => {
  assert.doesNotMatch(runtime, /shouldPreferElementorOwnership/);
  assert.doesNotMatch(runtime, /seogrowOwnership/);
  assert.doesNotMatch(runtime, /data\.contentProbeVisible = false/);
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
