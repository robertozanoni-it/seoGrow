import { listCorrections, updateCorrection } from "./remediationStore";
import "./RemediationIntegrity.css";

const DUPLICATE_TITLE = /title duplic|titolo duplic/i;
const SHORT_CONTENT = /contenuto breve|short content|content.*parole|parole/i;
const H1 = /\bh1\b/i;

const issueText = (issue) => `${issue?.type || ""} ${issue?.label || ""} ${issue?.detail || ""}`;

// Guardrail: un "Title duplicato" SEO riguarda il <title> del frontend e può essere
// controllato da Rank Math/Yoast. L'adapter REST core modifica invece post.title.
// Blocchiamo quindi la falsa correzione finché non esiste un adapter SEO-plugin dedicato.
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
  if (!record?.sourceUrl || record.status === "Ripristinato") return;
  const text = issueText(record.issue || { label: record.issueLabel });
  const relevant = DUPLICATE_TITLE.test(text) || SHORT_CONTENT.test(text) || H1.test(text) || (record.fields || []).includes("title");
  if (!relevant) return;
  try {
    const response = await window.fetch("/api/wordpress/verify-frontend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: record.sourceUrl, expected: record.after || {} }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Verifica frontend non riuscita");

    if (DUPLICATE_TITLE.test(text)) {
      if (data.titleMatchesExpected === false) {
        await updateCorrection(record.id, {
          status: "Non applicato al frontend",
          frontendConfirmed: false,
          verifiedAt: new Date().toISOString(),
          verificationNote: `WordPress ha modificato il titolo del contenuto, ma il <title> SEO pubblico è ancora “${data.title || "non rilevato"}”. La correzione del duplicato NON è confermata.`,
          frontendSnapshot: { title: data.title, h1: data.h1, words: data.words },
        });
      } else {
        await updateCorrection(record.id, {
          status: "Da verificare",
          frontendConfirmed: true,
          verifiedAt: new Date().toISOString(),
          verificationNote: "Il title frontend coincide con il valore inviato, ma il problema di duplicazione richiede comunque un crawl completo del sito.",
          frontendSnapshot: { title: data.title, h1: data.h1, words: data.words },
        });
      }
      return;
    }

    if (SHORT_CONTENT.test(text)) {
      const fixed = data.pageKind === "gdpr" || Number(data.words) >= Number(data.minimumWords || 180);
      await updateCorrection(record.id, {
        status: fixed ? "Verificato" : "Non applicato al frontend",
        frontendConfirmed: fixed,
        verifiedAt: new Date().toISOString(),
        verificationNote: fixed
          ? `Frontend verificato: ${data.words} parole, soglia ${data.minimumWords}.`
          : `La pagina pubblica contiene ancora ${data.words} parole (soglia ${data.minimumWords}). La correzione non è confermata nel frontend.`,
        frontendSnapshot: { title: data.title, h1: data.h1, words: data.words },
      });
      return;
    }

    if (H1.test(text)) {
      const fixed = Number(data.h1) === 1;
      await updateCorrection(record.id, {
        status: fixed ? "Verificato" : "Non applicato al frontend",
        frontendConfirmed: fixed,
        verifiedAt: new Date().toISOString(),
        verificationNote: fixed
          ? "Frontend verificato: è presente esattamente un H1."
          : `Frontend non corretto: risultano ${data.h1} H1.`,
        frontendSnapshot: { title: data.title, h1: data.h1, words: data.words },
      });
      return;
    }

    if ((record.fields || []).includes("title") && data.titleMatchesExpected === false) {
      await updateCorrection(record.id, {
        status: "Non applicato al frontend",
        frontendConfirmed: false,
        verifiedAt: new Date().toISOString(),
        verificationNote: `Il titolo WordPress è stato scritto, ma il <title> pubblico è “${data.title || "non rilevato"}”.`,
        frontendSnapshot: { title: data.title, h1: data.h1, words: data.words },
      });
    }
  } catch (error) {
    await updateCorrection(record.id, {
      status: record.status === "Verificato" ? "Da verificare" : record.status,
      verificationNote: `Verifica frontend non conclusa: ${error.message}`,
    });
  }
}

async function recheckCorrections() {
  try {
    const rows = await listCorrections();
    for (const record of rows.slice(0, 80)) await recheckRecord(record);
  } catch (error) {
    console.warn("Controllo integrità remediation non eseguito:", error);
  }
}

window.addEventListener("load", () => {
  window.setTimeout(() => void recheckCorrections(), 800);
}, { once: true });
window.addEventListener("seogrow-remediation-history", () => {
  window.setTimeout(() => void recheckCorrections(), 300);
});
