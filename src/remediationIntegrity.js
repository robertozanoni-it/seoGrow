import { apiFetch } from "./api";
import {
  listCorrections,
  readCorrection,
  removeVerifiedTask,
  reopenTask,
  updateCorrection,
} from "./remediationStore";
import "./RemediationIntegrity.css";

const DUPLICATE_TITLE = /title duplic|titolo duplic/i;
const SHORT_CONTENT = /contenuto breve|short content|content.*parole|parole/i;
const H1 = /\bh1\b/i;
let recheckRunning = false;
let recheckTimer = null;

const issueText = (issue) => `${issue?.type || ""} ${issue?.label || ""} ${issue?.detail || ""}`;

const syncTaskWithVerification = (before, after) => {
  if (!after) return;
  if (after.status === "Verificato") {
    removeVerifiedTask(after);
    return;
  }
  if (before?.status === "Verificato" && after.status !== "Verificato") {
    reopenTask(after);
  }
};

async function updateAndSync(record, patch) {
  const updated = await updateCorrection(record.id, patch);
  syncTaskWithVerification(record, updated);
  return updated;
}

export async function recheckCorrection(record) {
  if (!record?.sourceUrl || record.status === "Ripristinato") return { changed: false, record };
  const text = issueText(record.issue || { type: record.issueType, label: record.issueLabel });
  const relevant = DUPLICATE_TITLE.test(text) || SHORT_CONTENT.test(text) || H1.test(text) || (record.fields || []).includes("title");
  if (!relevant) {
    const updated = await updateAndSync(record, {
      status: record.status === "Verificato" ? "Verificato" : "Da verificare",
      verificationNote: "Questo tipo di correzione richiede un nuovo audit mirato o completo: la verifica frontend generica non è sufficiente.",
      lastVerificationAttemptAt: new Date().toISOString(),
    });
    return { changed: true, record: updated, needsAudit: true };
  }

  try {
    const response = await apiFetch("/api/wordpress/verify-frontend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: record.sourceUrl, expected: record.after || {} }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Verifica frontend non riuscita");

    if (DUPLICATE_TITLE.test(text)) {
      const failedFrontend = data.titleMatchesExpected === false;
      const patch = failedFrontend
        ? {
            status: "Da verificare",
            frontendConfirmed: false,
            frontendFailure: true,
            verificationNote: `WordPress ha modificato il titolo del contenuto, ma il <title> SEO pubblico è ancora “${data.title || "non rilevato"}”. La correzione del duplicato NON è confermata.`,
          }
        : {
            status: "Da verificare",
            frontendConfirmed: true,
            frontendFailure: false,
            verificationNote: "Il title frontend coincide con il valore inviato, ma un duplicato può essere dichiarato risolto solo dopo un nuovo crawl che confronti tutti i documenti coinvolti.",
          };
      const updated = await updateAndSync(record, {
        ...patch,
        lastVerificationAttemptAt: new Date().toISOString(),
        frontendSnapshot: { title: data.title, h1: data.h1, words: data.words },
      });
      return { changed: true, record: updated, needsAudit: true };
    }

    if (SHORT_CONTENT.test(text)) {
      const thresholdReached = data.pageKind === "gdpr" || Number(data.words) >= Number(data.minimumWords || 180);
      const modifiedContentVisible = data.contentProbeVisible === true;
      const qualityAccepted = record.editorialQuality?.publishable !== false;
      const fixed = thresholdReached && modifiedContentVisible && qualityAccepted;
      const updated = await updateAndSync(record, {
        status: fixed ? "Verificato" : "Da verificare",
        frontendConfirmed: fixed,
        frontendFailure: !fixed,
        verifiedAt: fixed ? new Date().toISOString() : record.verifiedAt || "",
        lastVerificationAttemptAt: new Date().toISOString(),
        verificationNote: fixed
          ? `Frontend verificato: il contenuto modificato è visibile e la pagina contiene ${data.words} parole (soglia ${data.minimumWords}).`
          : !thresholdReached
            ? `La pagina pubblica contiene ancora ${data.words} parole (soglia ${data.minimumWords}). La correzione non è confermata nel frontend.`
            : !modifiedContentVisible
              ? "La soglia di parole è raggiunta, ma SeoGrow non ha dimostrato che il contenuto modificato sia quello effettivamente visibile. La correzione resta Da verificare."
              : "Il contenuto è visibile ma il quality gate editoriale non consente di dichiararlo verificato automaticamente.",
        frontendSnapshot: { title: data.title, h1: data.h1, words: data.words },
      });
      return { changed: true, record: updated };
    }

    if (H1.test(text)) {
      const h1CountCorrect = Number(data.h1) === 1;
      const updated = await updateAndSync(record, {
        status: "Da verificare",
        frontendConfirmed: false,
        frontendFailure: !h1CountCorrect,
        lastVerificationAttemptAt: new Date().toISOString(),
        verificationNote: h1CountCorrect
          ? "Il frontend contiene un solo H1, ma questo controllo non prova da solo che il problema SEO originale sia risolto. Esegui un nuovo audit della pagina per confermare."
          : `Frontend non corretto: risultano ${data.h1} H1.`,
        frontendSnapshot: { title: data.title, h1: data.h1, words: data.words },
      });
      return { changed: true, record: updated, needsAudit: true };
    }

    if ((record.fields || []).includes("title")) {
      const matches = data.titleMatchesExpected === true;
      const updated = await updateAndSync(record, {
        status: matches ? "Da verificare" : "Da verificare",
        frontendConfirmed: matches,
        frontendFailure: !matches,
        lastVerificationAttemptAt: new Date().toISOString(),
        verificationNote: matches
          ? "Il <title> pubblico coincide con il valore applicato. Se il problema originale era un duplicato o dipendeva dal sito intero, serve comunque un nuovo crawl per confermarne la risoluzione."
          : `Il titolo WordPress è stato scritto, ma il <title> pubblico è “${data.title || "non rilevato"}”.`,
        frontendSnapshot: { title: data.title, h1: data.h1, words: data.words },
      });
      return { changed: true, record: updated, needsAudit: true };
    }

    return { changed: false, record };
  } catch (error) {
    const updated = await updateCorrection(record.id, {
      verificationNote: `Verifica frontend non conclusa: ${error.message}. Lo stato precedente è stato mantenuto.`,
      lastVerificationErrorAt: new Date().toISOString(),
      lastVerificationAttemptAt: new Date().toISOString(),
    });
    return { changed: true, record: updated, error };
  }
}

export async function recheckCorrectionById(id) {
  const record = await readCorrection(id);
  if (!record) throw new Error("Correzione non trovata nello storico.");
  return recheckCorrection(record);
}

export async function recheckCorrections({ clientId, limit = 20 } = {}) {
  if (recheckRunning) return { checked: 0, changed: 0, busy: true };
  recheckRunning = true;
  try {
    const rows = await listCorrections(clientId == null ? {} : { clientId });
    const pending = rows
      .filter((record) => ["Applicato", "Da verificare"].includes(record.status))
      .slice(0, Math.max(1, Math.min(100, Number(limit) || 20)));
    let changed = 0;
    for (const record of pending) {
      const result = await recheckCorrection(record);
      if (result.changed) changed += 1;
    }
    return { checked: pending.length, changed, busy: false };
  } finally {
    recheckRunning = false;
  }
}

const scheduleRecheck = (delay = 500) => {
  if (recheckRunning || recheckTimer) return;
  recheckTimer = window.setTimeout(() => {
    recheckTimer = null;
    void recheckCorrections().catch((error) =>
      console.warn("Controllo integrità remediation non eseguito:", error),
    );
  }, delay);
};

if (typeof window !== "undefined") {
  window.addEventListener("load", () => scheduleRecheck(800), { once: true });
  window.addEventListener("seogrow-remediation-applied", () => scheduleRecheck(500));
  window.addEventListener("seogrow-verify-correction", (event) => {
    const id = event?.detail?.id;
    if (!id) return;
    void recheckCorrectionById(id).catch((error) =>
      console.warn("Riverifica correzione non riuscita:", error),
    );
  });
}
