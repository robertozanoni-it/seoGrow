import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  boundConditionValue,
  extractElementorConditionEvidence,
  interpretElementorConditions,
  normalizeImpactCandidateUrls,
  normalizeImpactDocuments,
  normalizeImpactTarget,
} from "../server/elementorImpactHook.js";

const source = await readFile(new URL("../server/elementorImpactHook.js", import.meta.url), "utf8");
const bootstrap = await readFile(new URL("../server/remediationBootstrap.js", import.meta.url), "utf8");

test("impact API accetta solo documenti Elementor con ID validi, deduplicati e limitati", () => {
  const documents = normalizeImpactDocuments([
    { id: 88, type: "header", origins: ["frontend-rendered"] },
    { id: 88, type: "unknown", origins: ["local-reference"] },
    { id: -1, type: "footer" },
    { id: "91", type: "footer" },
  ]);
  assert.deepEqual(documents, [
    { id: 88, type: "header", origins: ["frontend-rendered", "local-reference"] },
    { id: 91, type: "footer", origins: [] },
  ]);
});

test("include/general viene interpretata come intero sito senza autorizzare scritture condivise", () => {
  const interpretation = interpretElementorConditions(["include/general"]);
  assert.equal(interpretation.entireSiteIncluded, true);
  assert.equal(interpretation.semanticStatus, "resolved");
  assert.equal(interpretation.displayConditionsResolved, true);
  assert.equal(interpretation.entries[0].semanticStatus, "resolved-entire-site");
  assert.equal(interpretation.targetApplicability, "unknown");

  const evidence = extractElementorConditionEvidence({
    id: 88,
    title: { raw: "Header principale" },
    status: "publish",
    meta: {
      _elementor_template_type: "header",
      _elementor_conditions: ["include/general"],
    },
  }, { id: 88, type: "header", origins: ["frontend-rendered"] });
  assert.equal(evidence.displayConditionsResolved, true);
  assert.equal(evidence.conditionInterpretation.entireSiteIncluded, true);
  assert.equal(evidence.affectedPagesEnumerated, false);
  assert.equal(evidence.sharedWriteAllowed, false);
});

test("condizioni Elementor miste restano evidenza bounded e semanticamente parziale senza identità target", () => {
  const evidence = extractElementorConditionEvidence({
    id: 120,
    type: "elementor_library",
    title: { raw: "Popup promo" },
    status: "publish",
    link: "https://example.com/?elementor_library=popup-promo",
    meta: {
      _elementor_template_type: "popup",
      _elementor_conditions: ["include/general", "exclude/singular/post/44"],
    },
  }, { id: 120, type: "popup", origins: ["frontend-rendered"] });

  assert.equal(evidence.id, 120);
  assert.equal(evidence.type, "popup");
  assert.deepEqual(evidence.conditions, ["include/general", "exclude/singular/post/44"]);
  assert.equal(evidence.conditionsObserved, true);
  assert.equal(evidence.conditionsSource, "elementor-rest-edit-context");
  assert.equal(evidence.conditionInterpretation.semanticStatus, "partial");
  assert.equal(evidence.conditionInterpretation.entries[1].explicitNumericTarget, 44);
  assert.equal(evidence.displayConditionsResolved, false);
  assert.equal(evidence.affectedPagesEnumerated, false);
  assert.equal(evidence.sharedWriteAllowed, false);
});

test("target WordPress esplicito risolve include/general più exclude singular per la risorsa corrente", () => {
  assert.deepEqual(normalizeImpactTarget({ id: "44", type: "post" }), { id: 44, type: "post" });

  const excluded = interpretElementorConditions(
    ["include/general", "exclude/singular/post/44"],
    { id: 44, type: "post" },
  );
  assert.equal(excluded.displayConditionsResolved, true);
  assert.equal(excluded.semanticStatus, "resolved");
  assert.equal(excluded.targetApplicability, "excluded");
  assert.equal(excluded.entries[1].semanticStatus, "resolved-explicit-singular-target");
  assert.equal(excluded.entries[1].explicitTargetType, "post");
  assert.equal(excluded.entries[1].targetTypeMatches, true);
  assert.equal(excluded.entries[1].targetMatches, true);
  assert.equal(excluded.entries[1].targetEffect, "exclude");

  const included = interpretElementorConditions(
    ["include/general", "exclude/singular/post/44"],
    { id: 55, type: "post" },
  );
  assert.equal(included.displayConditionsResolved, true);
  assert.equal(included.targetApplicability, "applies");
  assert.equal(included.entries[1].targetMatches, false);
  assert.equal(included.entries[1].targetEffect, "no-match");
});

test("include singular con ID esplicito distingue target incluso, tipo errato e target non applicato", () => {
  const applies = interpretElementorConditions(["include/singular/page/44"], { id: 44, type: "page" });
  assert.equal(applies.displayConditionsResolved, true);
  assert.equal(applies.targetApplicability, "applies");
  assert.equal(applies.entries[0].explicitTargetType, "page");
  assert.equal(applies.entries[0].targetTypeMatches, true);

  const notApplied = interpretElementorConditions(["include/singular/page/44"], { id: 45, type: "page" });
  assert.equal(notApplied.displayConditionsResolved, true);
  assert.equal(notApplied.targetApplicability, "not-applied");

  const wrongType = interpretElementorConditions(["include/singular/page/44"], { id: 44, type: "post" });
  assert.equal(wrongType.displayConditionsResolved, true);
  assert.equal(wrongType.targetApplicability, "not-applied");
  assert.equal(wrongType.entries[0].targetTypeMatches, false);
  assert.equal(wrongType.entries[0].targetMatches, false);

  const missingType = interpretElementorConditions(["include/singular/page/44"], { id: 44 });
  assert.equal(missingType.displayConditionsResolved, false);
  assert.equal(missingType.targetApplicability, "unknown");

  const unknownRule = interpretElementorConditions(
    ["include/general", "include/singular/page/by-author/12"],
    { id: 44, type: "page" },
  );
  assert.equal(unknownRule.displayConditionsResolved, false);
  assert.equal(unknownRule.targetApplicability, "unknown");
});

test("extract evidence espone applicabilità target ma mantiene la scrittura condivisa bloccata", () => {
  const evidence = extractElementorConditionEvidence({
    id: 88,
    title: { raw: "Header principale" },
    status: "publish",
    meta: {
      _elementor_template_type: "header",
      _elementor_conditions: ["include/general", "exclude/singular/page/99"],
    },
  }, { id: 88, type: "header" }, { id: 42, type: "page" });

  assert.equal(evidence.displayConditionsResolved, true);
  assert.equal(evidence.targetApplicability, "applies");
  assert.equal(evidence.conditionInterpretation.target.id, 42);
  assert.equal(evidence.sharedWriteAllowed, false);
  assert.equal(evidence.affectedPagesEnumerated, false);
});

test("assenza di _elementor_conditions resta unknown e non viene trasformata in condizione globale", () => {
  const evidence = extractElementorConditionEvidence({
    id: 88,
    title: { rendered: "Header" },
    status: "publish",
    meta: { _elementor_template_type: "header" },
  }, { id: 88, type: "header" });
  assert.equal(evidence.conditionsObserved, false);
  assert.equal(evidence.conditions, null);
  assert.equal(evidence.conditionsSource, "not-exposed");
  assert.equal(evidence.displayConditionsResolved, false);
  assert.match(evidence.note, /nessuna inferenza/i);
});

test("le URL candidate server restano HTTPS same-host e gli alias www vengono deduplicati", () => {
  const base = new URL("https://www.example.com/blog/");
  const urls = normalizeImpactCandidateUrls(base, [
    "https://example.com/a/",
    "https://www.example.com/a/",
    "https://www.example.com/b/?x=1#frag",
    "http://example.com/insecure/",
    "https://evil.example.net/a/",
  ]);
  assert.deepEqual(urls, [
    "https://example.com/a/",
    "https://www.example.com/b/?x=1",
  ]);
  assert.ok(urls.every((value) => value.startsWith("https://")));
});

test("payload condizioni enorme viene limitato senza perdere il fail-closed", () => {
  const bounded = boundConditionValue({
    long: "x".repeat(5_000),
    nested: Array.from({ length: 300 }, (_, index) => ({ index, condition: `include/general/${index}` })),
  });
  assert.equal(bounded.long.length, 1_000);
  assert.equal(bounded.nested.length, 200);
});

test("la route Elementor impact è solo POST read-only ed è dichiarata nelle capabilities", () => {
  assert.match(source, /app\.post\("\/api\/wordpress\/elementor-impact-inspect"/);
  assert.match(source, /readOnly:\s*true/);
  assert.match(source, /sharedWriteAllowed:\s*false/);
  assert.match(source, /affectedPagesEnumerated:\s*false/);
  assert.match(source, /targetEntity/);
  assert.match(source, /targetApplicabilityResolved/);
  assert.doesNotMatch(source, /sharedWriteAllowed:\s*true/);
  assert.doesNotMatch(source, /affectedPagesEnumerated:\s*true/);
  assert.doesNotMatch(source, /app\.(?:put|patch|delete)\(/);
  assert.doesNotMatch(source, /update_post_meta|delete_post_meta|wp_update_post/i);
  assert.match(bootstrap, /elementor-impact-read-only/);
  assert.match(bootstrap, /read-only-evidence-no-shared-write/);
});
