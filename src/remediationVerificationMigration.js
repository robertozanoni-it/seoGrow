import { listCorrections, updateCorrection } from "./remediationStore";

const MIGRATION_KEY = "seogrow-remediation-frontend-verification-v2";

if (localStorage.getItem(MIGRATION_KEY) !== "done") {
  void (async () => {
    try {
      const rows = await listCorrections();
      for (const record of rows) {
        if (record?.status === "Verificato" && record?.frontendConfirmed !== true) {
          await updateCorrection(record.id, {
            status: "Da verificare",
            verificationNote: "Correzione eseguita con il vecchio controllo: WordPress aveva confermato la scrittura, ma la visibilità effettiva nel frontend non era stata verificata. Richiede nuovo controllo.",
          });
        }
      }
      localStorage.setItem(MIGRATION_KEY, "done");
    } catch (error) {
      console.warn("Migrazione verifica frontend non completata:", error);
    }
  })();
}
