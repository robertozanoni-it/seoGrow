const BACKUP_INPUT = '[data-testid="backup-file"]';
const CONFIRM_TEXT = "Importare questo backup? I dati locali attuali verranno sostituiti.";

if (typeof window !== "undefined" && typeof document !== "undefined") {
  const nativeConfirm = window.confirm.bind(window);
  let preconfirmed = false;

  window.addEventListener(
    "change",
    (event) => {
      const input = event.target?.closest?.(BACKUP_INPUT);
      if (!input || !input.files?.length) return;
      const approved = nativeConfirm(CONFIRM_TEXT);
      if (!approved) {
        event.preventDefault();
        event.stopImmediatePropagation();
        input.value = "";
        return;
      }
      preconfirmed = true;
    },
    true,
  );

  const guardedConfirm = (message) => {
    if (preconfirmed && String(message) === CONFIRM_TEXT) {
      preconfirmed = false;
      return true;
    }
    return nativeConfirm(message);
  };

  guardedConfirm.__seogrowBackupGuard = true;
  window.confirm = guardedConfirm;
}
