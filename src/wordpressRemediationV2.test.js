import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { shouldPreferElementorOwnership } from "./wordpressRemediationRuntimePatch.js";
import { countVisibleWords, shortContentTarget } from "../server/wordpressContentTarget.js";

const patchServer = await readFile(new URL("../server/wordpressPatchV2Hook.js", import.meta.url), "utf8");
const runtime = await readFile(new URL("./wordpressRemediationRuntimePatch.js", import.meta.url), "utf8");
const liveControl = await readFile(new URL("./WordPressLiveRemediationControl.jsx", import.meta.url), "utf8");
const ownership = await readFile(new URL("./wordpressOwnership.js", import.meta.url), "utf8");
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

test("la remediation contenuto breve calcola un target con margine oltre la soglia", () => {
  const widgetContent = `<p>${Array.from({ length: 116 }, (_, index) => `parola${index}`).join(" ")}</p>`;
  assert.equal(countVisibleWords(widgetContent), 116);
  assert.equal(
    shortContentTarget(
      { label: "Contenuto breve per pagina content: 90 parole" },
      { content: widgetContent },
    ),
    230,
  );
  assert.equal(
    shortContentTarget(
      { label: "Contenuto breve per pagina utility: 16 parole" },
      { content: `<p>${Array(16).fill("parola").join(" ")}</p>` },
    ),
    80,
  );
});

test("il target esplicito della remediation viene rispettato e limitato in sicurezza", () => {
  assert.equal(shortContentTarget({ remediationTargetWords: 215 }, { content: "testo" }), 215);
  assert.equal(shortContentTarget({ remediationTargetWords: 9999 }, { content: "testo" }), 1200);
});

test("una patch contenuto troppo breve viene rigenerata e mai proposta come applicabile", () => {
  assert.match(patchServer, /generatedWords < targetWords/);
  assert.match(patchServer, /remediationTargetWords: targetWords/);
  assert.match(patchServer, /rigenera l'intero contenuto/);
  assert.match(patchServer, /Nessuna anteprima applicabile è stata creata/);
  assert.match(patchServer, /almeno \$\{targetWords\} parole di testo visibile/);
});

test("gli H1 vengono corretti deterministicamente senza chiamare OpenAI", () => {
  extractFunction(patchServer, "deterministicH1Patch");
  assert.match(patchServer, /openings\.length === 0/);
  assert.match(patchServer, /replace\(\/\^<h1\/i, "<h2"\)/);
  assert.match(patchServer, /if \(kind === "h1"\)/);
  assert.match(patchServer, /deterministicH1Patch/);
});

test("la remediation H1 usa WordPress core solo se la copertura core è forte e gli H1 coincidono", () => {
  assert.match(ownership, /contentCoverageStrong/);
  assert.match(ownership, /frontendH1 === coreH1/);
  assert.match(liveControl, /assessCoreOwnership/);
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

test("il resolver Elementor precede WordPress core per content e blocca fallback ambiguo", () => {
  assert.match(liveControl, /inspectEditableElementor\(kind, entity\)/);
  assert.match(liveControl, /elementorPlan\(kind, issue, entity, targetUrl, elementorState, ownership\.frontend\)/);
  const elementorIndex = liveControl.indexOf("if (elementorState.state === \"valid\" && elementorState.widgets.length > 0)");
  const coreIndex = liveControl.indexOf("if (ownership.ok)", elementorIndex);
  assert.ok(elementorIndex >= 0 && coreIndex > elementorIndex, "Elementor deve essere valutato prima del fallback core");
  assert.match(liveControl, /Il fallback su post_content è bloccato/);
  assert.match(ownership, /chooseElementorContentCandidate/);
  assert.match(frontendVerification, /contentProbeMatches/);
  assert.match(frontendVerification, /contentCoverageStrong/);
});

test("il runtime patch non decide più l'ownership Elementor", () => {
  const inspected = { entity: { meta: { _elementor_data: "[]" } } };
  assert.equal(shouldPreferElementorOwnership(inspected, { expected: { content: "testo" } }), true);
  assert.doesNotMatch(runtime, /data\.contentProbeVisible = false/);
  assert.doesNotMatch(runtime, /data\.seogrowOwnership = "elementor"/);
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
