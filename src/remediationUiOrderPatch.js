const PATCHED = Symbol.for("seogrow.remediationUiOrderPatch");

const legacyCorrectionButton = (button) =>
  /^Correggi tutti|^Correggi questo problema/i.test(String(button?.textContent || "").trim());

const NOTE_TEXT = "WordPress core viene modificato solo se il controllo preliminare conferma che quel campo alimenta il frontend pubblico. Elementor e i meta SEO di Rank Math/Yoast vengono gestiti solo quando SeoGrow Connector li espone in modo autenticato e scrivibile. Archivi, tassonomie, redirect, robots, sitemap, cambi URL e casi senza ownership certa restano esclusi dalla modifica automatica.";

const arrange = () => {
  const root = document.querySelector(".audit-unified-remediation");
  if (!root) return;

  const actions = root.querySelector(".audit-unified-actions");
  const live = root.querySelector(".wp-live-remediation");

  // Il flusso corretto è: connessione -> preparazione/anteprima -> approvazione/applicazione -> verifica.
  // Il controllo live è un portal React aggiunto in fondo al pannello: lo riposizioniamo prima
  // della vecchia barra azioni per evitare che l'utente avvii la remediation legacy.
  if (live && actions && live.nextElementSibling !== actions) {
    root.insertBefore(live, actions);
  }

  root.querySelectorAll(".audit-unified-actions button").forEach((button) => {
    if (!legacyCorrectionButton(button)) return;
    button.dataset.seogrowLegacyCorrection = "1";
    button.hidden = true;
    button.setAttribute("aria-hidden", "true");
    button.style.setProperty("display", "none", "important");
  });

  const note = root.querySelector(".audit-unified-note span");
  if (note && note.textContent !== NOTE_TEXT) note.textContent = NOTE_TEXT;
};

if (typeof window !== "undefined" && !window[PATCHED]) {
  window[PATCHED] = true;
  const observer = new MutationObserver(arrange);
  const start = () => {
    arrange();
    if (document.body) observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  window.addEventListener("hashchange", () => window.setTimeout(arrange, 0));
  window.addEventListener("seogrow-storage-ok", () => window.setTimeout(arrange, 0));
}

export { arrange as arrangeRemediationUi };
