const isLegacyRemediationAction = (target) => {
  const button = target?.closest?.(".audit-unified-actions button");
  if (!button || button.dataset.seogrowLive === "1") return false;
  return /^Correggi tutti|^Correggi questo problema/i.test(
    String(button.textContent || "").trim(),
  );
};

const liveBatchCount = (target) => {
  const button = target?.closest?.('[data-seogrow-live="1"]');
  if (!button || !/Approva e applica al sito live/i.test(String(button.textContent || ""))) return 0;
  const match = String(button.textContent || "").match(/\((\d+)\)\s*$/);
  return match ? Number(match[1]) : 0;
};

const blockUnsafeRemediation = (event) => {
  if (isLegacyRemediationAction(event.target)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }

  const count = liveBatchCount(event.target);
  if (count <= 1) return;

  // Fail closed finché il bulk live non dispone di rollback transazionale dell'intero batch.
  event.preventDefault();
  event.stopImmediatePropagation();
  window.alert(
    "Applicazione bulk live bloccata per sicurezza: un batch multiplo potrebbe lasciare modifiche parziali se una scrittura intermedia fallisce. Seleziona e prepara un solo problema alla volta; il bulk resta disponibile come anteprima.",
  );
};

if (typeof document !== "undefined") {
  document.addEventListener("click", blockUnsafeRemediation, true);
}

export { liveBatchCount };
