import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const host = await readFile(new URL("./RemediationHost.jsx", import.meta.url), "utf8");
const runtime = await readFile(new URL("./RemediationRuntime.jsx", import.meta.url), "utf8");
const main = await readFile(new URL("./main.jsx", import.meta.url), "utf8");
const live = await readFile(new URL("./WordPressLiveRemediationControlV2.jsx", import.meta.url), "utf8");

test("il motore legacy non è più montato nel runtime principale", () => {
  assert.doesNotMatch(main, /AuditUnifiedRemediation/);
  assert.doesNotMatch(main, /legacyRemediationGuard/);
  assert.match(main, /RemediationRuntime/);
  assert.match(runtime, /RemediationHost/);
});

test("il runtime remediation viene montato solo in Audit SEO e si rimonta alla navigazione", () => {
  assert.match(runtime, /state\.page !== "Audit SEO"/);
  assert.match(runtime, /generation: current\.generation \+ 1/);
  assert.match(runtime, /hashchange/);
  assert.match(runtime, /seogrow-locationchange/);
});

test("l'host nativo espone solo il contratto DOM necessario al live flow V2", () => {
  assert.match(host, /audit-unified-remediation/);
  assert.match(host, /audit-unified-credentials/);
  assert.match(host, /audit-issue-select/);
  assert.match(live, /document\.querySelector\("\.audit-unified-remediation"\)/);
  assert.match(live, /document\.querySelector\("\.audit-unified-credentials"\)/);
});

test("l'host non introduce nuovi monkey-patch fetch o MutationObserver globali", () => {
  assert.doesNotMatch(host, /window\.fetch\s*=/);
  assert.doesNotMatch(host, /MutationObserver/);
  assert.match(host, /requestAnimationFrame/);
});

test("l'host usa esattamente audit type e analyzedAt richiesti senza fallback silenzioso", () => {
  assert.match(host, /const selectAudit =/);
  assert.match(host, /requested\.auditType/);
  assert.match(host, /requested\.analyzedAt/);
  assert.match(host, /return matches\.length === 1 \? matches\[0\] : null/);
  assert.match(host, /const \[requestedAudit, setRequestedAudit\] = useState\(null\)/);
  assert.match(host, /setRequestedAudit\(/);
  assert.doesNotMatch(host, /selectAudit\([^)]*\) \|\| candidates/);
});

test("i problemi verificati sono derivati dai dati e disabilitati nel selettore", () => {
  assert.match(host, /listCorrections\(\{ clientId \}\)/);
  assert.match(host, /record\.status === "Verificato"/);
  assert.match(host, /disabled=\{verifiedKeys\.has\(entry\.key\)\}/);
  assert.match(host, /activeEntries\.length/);
});

test("le piattaforme non WordPress non espongono la scrittura live", () => {
  assert.match(host, /data-remediation-platform=\{platform\}/);
  assert.match(host, /platform !== "wordpress"/);
  assert.match(host, /Apri nel SEO Agent/);
});

test("i vecchi observer DOM di remediation non vengono più caricati dal main", () => {
  for (const legacyModule of ["remediationUiOrderPatch", "remediationCompletionUxPatch", "remediationReportUx"]) {
    assert.doesNotMatch(main, new RegExp(legacyModule));
  }
});
