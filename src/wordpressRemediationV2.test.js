import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { countVisibleWords, shortContentTarget } from "../server/wordpressContentTarget.js";
import {
  assessCoreOwnership,
  chooseElementorContentCandidate,
  inspectEditableElementor,
} from "./wordpressOwnership.js";

const patchServer = await readFile(new URL("../server/wordpressPatchV2Hook.js", import.meta.url), "utf8");
const liveControl = await readFile(new URL("./WordPressLiveRemediationControlV2.jsx", import.meta.url), "utf8");
const main = await readFile(new URL("./main.jsx", import.meta.url), "utf8");
const connector = await readFile(new URL("../wordpress-plugin/seogrow-connector/seogrow-connector.php", import.meta.url), "utf8");

const words = (count) => Array.from({ length: count }, (_, index) => `parola${index}`).join(" ");
const shortIssue = { label: "Contenuto breve per pagina content: 90 parole" };
const measuredPage = (frontendWords, fieldWords, minimumWords = 180) => ({
  content: `<p>${words(fieldWords)}</p>`,
  remediationMeasurement: {
    frontendWords,
    fieldWords,
    minimumWords,
    marginWords: minimumWords >= 180 ? 30 : 20,
  },
});

test("il target short-content usa il frontend corrente, non il conteggio storico dell'audit", () => {
  assert.equal(countVisibleWords(`<p>${words(110)}</p>`), 110);
  assert.equal(shortContentTarget(shortIssue, measuredPage(141, 110)), 179);
  assert.equal(shortContentTarget(shortIssue, measuredPage(141, 141)), 210);
  assert.equal(shortContentTarget(shortIssue, measuredPage(90, 90)), 210);
});

test("short-content fallisce chiuso senza una misura frontend coerente", () => {
  assert.throws(
    () => shortContentTarget(shortIssue, { content: `<p>${words(110)}</p>` }),
    /Misura frontend corrente assente/,
  );
  assert.throws(
    () => shortContentTarget(shortIssue, measuredPage(141, 200)),
    /non valide o non coerenti/,
  );
});

test("il target esplicito non viene abbassato silenziosamente", () => {
  assert.equal(shortContentTarget({ remediationTargetWords: 215 }, {}), 215);
  assert.throws(
    () => shortContentTarget({ remediationTargetWords: 9999 }, {}),
    /oltre il limite sicuro/,
  );
});

test("una pagina con documento Elementor non può ricadere su WordPress core", () => {
  const entity = {
    content: { raw: `<p>${words(40)}</p>` },
    meta: {
      _elementor_data: JSON.stringify([
        {
          id: "dynamic",
          widgetType: "text-editor",
          settings: {
            editor: `<p>${words(40)}</p>`,
            __dynamic__: { editor: "[elementor-tag]" },
          },
          elements: [],
        },
      ]),
    },
  };
  const state = inspectEditableElementor("content", entity);
  assert.equal(state.state, "valid");
  assert.equal(state.hasDocument, true);
  assert.equal(state.widgets.length, 0);
  const ownership = assessCoreOwnership("content", entity, {
    words: 40,
    expectedWords: 40,
    contentCoverageStrong: true,
    contentProbeVisible: true,
    contentProbeCount: 3,
    contentProbeMatches: 3,
  });
  assert.equal(ownership.ok, false);
  assert.match(ownership.reason, /fallback su post_content è bloccato/);
});

test("Elementor sceglie un widget solo con copertura forte e univoca", () => {
  const candidates = [
    { id: "a", item: {}, value: words(110), words: 110 },
    { id: "b", item: {}, value: words(50), words: 50 },
  ];
  const weak = chooseElementorContentCandidate(candidates.slice(0, 1), [{
    contentProbeVisible: true,
    contentCoverageStrong: false,
    contentProbeCount: 3,
    contentProbeMatches: 1,
  }]);
  assert.equal(weak.candidate, null);

  const unique = chooseElementorContentCandidate(candidates.slice(0, 1), [{
    contentProbeVisible: true,
    contentCoverageStrong: true,
    contentProbeCount: 3,
    contentProbeMatches: 3,
  }]);
  assert.equal(unique.candidate?.id, "a");

  const ambiguous = chooseElementorContentCandidate(candidates, [
    { contentCoverageStrong: true, contentProbeCount: 3, contentProbeMatches: 3 },
    { contentCoverageStrong: true, contentProbeCount: 3, contentProbeMatches: 3 },
  ]);
  assert.equal(ambiguous.candidate, null);
  assert.match(ambiguous.reason, /sola lunghezza non è sufficiente/);
});

test("il patch engine rifiuta output AI incompleti o semanticamente più corti", () => {
  assert.match(patchServer, /data\.status !== "completed"/);
  assert.match(patchServer, /data\.incomplete_details/);
  assert.match(patchServer, /typeof parsed\.value !== "string"/);
  assert.match(patchServer, /La patch è più corta del contenuto originale/);
  assert.match(patchServer, /remediationFeedback/);
  assert.doesNotMatch(patchServer, /CONTENUTO RIDOTTO PER GENERAZIONE/);
});

test("il live planner V2 passa la misura frontend al generatore e blocca Elementor non risolvibile", () => {
  assert.match(liveControl, /const contentMeasurement =/);
  assert.match(liveControl, /frontendWords/);
  assert.match(liveControl, /fieldWords/);
  assert.match(liveControl, /minimumWords/);
  assert.match(liveControl, /elementorState\.hasDocument/);
  assert.match(liveControl, /Il fallback su post_content è bloccato/);
});

test("un audit richiesto non ricade silenziosamente sull'ultimo audit", () => {
  assert.match(liveControl, /if \(!requested\) return list\[0\] \|\| null/);
  assert.match(liveControl, /normalizeClientId\(requested\.clientId\) !== normalizeClientId\(clientId\)/);
  assert.match(liveControl, /return matches\.length === 1 \? matches\[0\] : null/);
  assert.doesNotMatch(liveControl, /\) \|\| list\[0\] \|\| null/);
});

test("le anteprime V2 restano legate al cliente e all'audit con cui sono state preparate", () => {
  assert.match(liveControl, /contextSnapshot/);
  assert.match(liveControl, /Progetto o audit sono cambiati dopo la preparazione/);
  assert.match(liveControl, /contextSnapshot\?\.auditType/);
  assert.match(liveControl, /contextSnapshot\?\.analyzedAt/);
  assert.match(liveControl, /clientId: snapshot\.clientId/);
});

test("il runtime browser non carica più il monkey-patch remediation legacy", () => {
  assert.doesNotMatch(main, /import ['"]\.\/wordpressRemediationRuntimePatch['"]/);
  assert.match(liveControl, /\/api\/wordpress\/inspect-fast/);
  assert.match(liveControl, /\/api\/wordpress\/generate-patch-v2/);
  assert.match(liveControl, /\/api\/wordpress\/generate-seo-value-v2/);
});

test("archivi e query WordPress non editabili vengono esclusi prima dell'ispezione", () => {
  assert.match(liveControl, /const isNonEditableWordPressUrl =/);
  assert.match(liveControl, /category\|categoria\|tag\|author\|autore\|date\|feed/);
  assert.equal(liveControl.includes('/\\/page\\/\\d+$/i'), true);
  assert.match(liveControl, /\["s", "cat", "tag", "paged", "author", "feed"\]/);
  assert.match(liveControl, /if \(isNonEditableWordPressUrl\(targetUrl\)\)/);
});

test("il Connector espone solo meta dei plugin rilevati e richiede edit_post", () => {
  assert.match(connector, /_elementor_data/);
  assert.match(connector, /rank_math_title/);
  assert.match(connector, /_yoast_wpseo_metadesc/);
  assert.match(connector, /current_user_can\('edit_post'/);
  assert.match(connector, /\$has_elementor/);
  assert.match(connector, /\$has_rank_math/);
  assert.match(connector, /\$has_yoast/);
});
