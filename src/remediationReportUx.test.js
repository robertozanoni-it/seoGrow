import test from "node:test";
import assert from "node:assert/strict";
import {
  OUTCOME,
  classifyRemediationReason,
  remediationSummary,
} from "./remediationReportUx.js";

test("classifica blocchi, esclusioni, unsupported ed errori remediation", () => {
  assert.equal(
    classifyRemediationReason(
      "Remediation automatica bloccata: il contenuto WordPress è pubblicato o non è una bozza.",
    ),
    OUTCOME.BLOCKED_SAFETY,
  );
  assert.equal(
    classifyRemediationReason(
      "Il contenuto WordPress core non coincide con il contenuto pubblico: la pagina può essere gestita da Elementor o da un template.",
    ),
    OUTCOME.BLOCKED_OWNERSHIP,
  );
  assert.equal(
    classifyRemediationReason(
      "Archivio/paginazione WordPress rilevata: SeoGrow salta automaticamente questa URL.",
    ),
    OUTCOME.EXCLUDED,
  );
  assert.equal(
    classifyRemediationReason(
      "Questo tipo di problema non è ancora supportato dall'adapter WordPress reale.",
    ),
    OUTCOME.UNSUPPORTED,
  );
  assert.equal(classifyRemediationReason("Errore rete inatteso."), OUTCOME.ERROR);
  assert.equal(classifyRemediationReason("Applicato a WordPress: title", true), OUTCOME.APPLIED);
});

test("non rimanda a Correzioni quando nessuna modifica è stata applicata", () => {
  const summary = remediationSummary([
    OUTCOME.BLOCKED_SAFETY,
    OUTCOME.BLOCKED_OWNERSHIP,
    OUTCOME.UNSUPPORTED,
  ]);
  assert.match(summary, /0 applicati/);
  assert.match(summary, /Nessuna correzione è stata registrata/);
  assert.doesNotMatch(summary, /sono disponibili nella sezione Correzioni/);
});

test("rimanda a Correzioni soltanto se almeno una modifica è stata applicata", () => {
  const summary = remediationSummary([OUTCOME.APPLIED, OUTCOME.UNSUPPORTED]);
  assert.match(summary, /1 applicati/);
  assert.match(summary, /sono disponibili nella sezione Correzioni/);
});
