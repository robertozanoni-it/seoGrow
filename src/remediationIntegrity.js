import { listCorrections, updateCorrection } from "./remediationStore";
import "./RemediationIntegrity.css";

const DUPLICATE_TITLE = /title duplic|titolo duplic/i;
const SHORT_CONTENT = /contenuto breve|short content|content.*parole|parole/i;
const H1 = /\bh1\b/i;
let recheckRunning = false;
let recheckTimer = null;

const issueText = (issue) => `${issue?.type || ""} ${issue?.label || ""} ${issue?.detail || ""}`;

const originalFetch = window.fetch.bind(window);
if (!window.fetch.__seogrowSeoTitleGuard) {
  const guardedFetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url;
    const method = String(init?.method || "GET").toUpperCase();
    if (url === "/api/wordpress/generate-patch" && method === "POST") {
      try {
        const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
        let context = {};
        try { context = JSON.parse(String(body?.context || "{}")); } catch { context = {}; }
        if (DUPLICATE_TITLE.test(issueText(context.issue))) {
          return new Response(JSON.stringify({
            error: "Title duplicato non corretto automaticamente: il title SEO del frontend può essere gestito dal plugin SEO, mentre l'adapter WordPress core modifica solo il titolo del contenuto. Serve un adapter Rank Math/Yoast e un crawl completo di verifica.",
          }), {
            status: 422,
            headers: { "content-type": "application/json; charset=utf-8" },
          });
        }
      } catch {
        // Lascia gestire al backend richieste non interpretabili.
      }
    }
    return originalFetch(input, init);
  };
  guardedFetch.__seogrowSeoTitleGuard = true;
  window.fetch = guardedFetch;
}

async function recheckRecord(record) {
  if (!record?.sourceUrl || record.status === "Ripristinato") return false;
  const text = issueText(record.issue || { label: record.issueLabel });
  const relevant = DUPLICATE_TITLE.test(text) || SHORT_CONTENT.test(text) || H1.test(text) || (record.fields || []).includes("title");
  if (!relevant) return false;
  try {
    const response = await window.fetch("/api/wordpress/verify-frontend", {
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
            verificationNote: "Il title frontend coincide con il valore inviato, ma il problema di duplicazione richiede comunque un crawl completo del sito.",
          };
      const changed = record.status !== patch.status || record.frontendConfirmed !== patch.frontendConfirmed || record.frontendFailure !== patch.frontendFailure || record.frontendSnapshot?.title !== data.title;
      if (changed) await updateCorrection(record.id, {
        ...patch,
        verifiedAt: new Date().toISOString(),
        frontendSnapshot: { title: data.title, h1: data.h1, words: data.words },
      });
      return changed;
    }

    if (SHORT_CONTENT.test(text)) {
      const fixed = data.pageKind === "gdpr" || Number(data.words) >= Number(data.minimumWords || 180);
      const nextStatus = fixed ? "Verificato" : "Da verificare";
      const changed = record.status !== nextStatus || record.frontendConfirmed !== fixed || record.frontendFailure !== !fixed || Number(record.frontendSnapshot?.words) !== Number(data.words);
      if (changed) await updateCorrection(record.id, {
        status: nextStatus,
        frontendConfirmed: fixed,
        frontendFailure: !fixed,
        verifiedAt: new Date().toISOString(),
        verificationNote: fixed
          ? `Frontend verificato: ${data.words} parole, soglia ${data.minimumWords}.`
          : `La pagina pubblica contiene ancora ${data.words} parole (soglia ${data.minimumWords}). La correzione non è confermata nel frontend.`,
        frontendSnapshot: { title: data.title, h1: data.h1, words: data.words },
      });
      return changed;
    }

    if (H1.test(text)) {
      const fixed = Number(data.h1) === 1;
      const nextStatus = fixed ? "Verificato" : "Da verificare";
      const changed = record.status !== nextStatus || record.frontendConfirmed !== fixed || record.frontendFailure !== !fixed || Number(record.frontendSnapshot?.h1) !== Number(data.h1);
      if (changed) await updateCorrection(record.id, {
        status: nextStatus,
        frontendConfirmed: fixed,
        frontendFailure: !fixed,
        verifiedAt: new Date().toISOString(),
        verificationNote: fixed
          ? "Frontend verificato: è presente esattamente un H1."
          : `Frontend non corretto: risultano ${data.h1} H1.`,
        frontendSnapshot: { title: data.title, h1: data.h1, words: data.words },
      });
      return changed;
    }

    if ((record.fields || []).includes("title") && data.titleMatchesExpected === false) {
      const changed = record.status !== "Da verificare" || record.frontendFailure !== true || record.frontendSnapshot?.title !== data.title;
      if (changed) await updateCorrection(record.id, {
        status: "Da verificare",
        frontendConfirmed: false,
        frontendFailure: true,
        verifiedAt: new Date().toISOString(),
        verificationNote: `Il titolo WordPress è stato scritto, ma il <title> pubblico è “${data.title || "non rilevato"}”.`,
        frontendSnapshot: { title: data.title, h1: data.h1, words: data.words },
      });
      return changed;
    }
    return false;
  } catch (error) {
    if (record.status === "Verificato") {
      await updateCorrection(record.id, {
        status: "Da verificare",
        frontendConfirmed: false,
        frontendFailure: false,
        verificationNote: `Verifica frontend non conclusa: ${error.message}`,
      });
      return true;
    }
    return false;
  }
}

async function recheckCorrections() {
  if (recheckRunning) return;
  recheckRunning = true;
  try {
    const rows = await listCorrections();
    for (const record of rows.slice(0, 80)) await recheckRecord(record);
  } catch (error) {
    console.warn("Controllo integrità remediation non eseguito:", error);
  } finally {
    recheckRunning = false;
  }
}

const scheduleRecheck = (delay = 500) => {
  if (recheckRunning || recheckTimer) return;
  recheckTimer = window.setTimeout(() => {
    recheckTimer = null;
    void recheckCorrections();
  }, delay);
};

window.addEventListener("load", () => scheduleRecheck(800), { once: true });
window.addEventListener("seogrow-remediation-applied", () => scheduleRecheck(500));
