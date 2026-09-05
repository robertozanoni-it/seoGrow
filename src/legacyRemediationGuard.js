const isLegacyRemediationAction = (target) => {
  const button = target?.closest?.(".audit-unified-actions button");
  if (!button || button.dataset.seogrowLive === "1") return false;
  return /^Correggi tutti|^Correggi questo problema/i.test(
    String(button.textContent || "").trim(),
  );
};

const blockLegacyRemediation = (event) => {
  if (!isLegacyRemediationAction(event.target)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
};

if (typeof document !== "undefined") {
  document.addEventListener("click", blockLegacyRemediation, true);
}
