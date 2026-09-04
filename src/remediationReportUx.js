const OUTCOME = {
  APPLIED: "applied",
  BLOCKED_SAFETY: "blocked-safety",
  BLOCKED_OWNERSHIP: "blocked-ownership",
  EXCLUDED: "excluded",
  UNSUPPORTED: "unsupported",
  ERROR: "error",
};

export function classifyRemediationReason(reason, corrected = false) {
  if (corrected) return OUTCOME.APPLIED;
  const text = String(reason || "").toLowerCase();

  if (
    /pubblicat|non è una bozza|non e una bozza|draft_required|non modifica contenuti live|bloccata.*bozza/.test(
      text,
    )
  )
    return OUTCOME.BLOCKED_SAFETY;

  if (
    /elementor|template|rank math|yoast|campo sbagliato|non coincide con il contenuto pubblico|non coincide con il titolo wordpress|ownership/.test(
      text,
    )
  )
    return OUTCOME.BLOCKED_OWNERSHIP;

  if (/archivio|paginazione|non è una pagina o un articolo|non e una pagina o un articolo/.test(text))
    return OUTCOME.EXCLUDED;

  if (
    /non è ancora supportato|non e ancora supportato|adapter dedicato|serve un adapter|non corretto automaticamente|nessuna patch applicabile/.test(
      text,
    )
  )
    return OUTCOME.UNSUPPORTED;

  return OUTCOME.ERROR;
}

const outcomeLabel = (outcome) =>
  ({
    [OUTCOME.APPLIED]: "Applicato",
    [OUTCOME.BLOCKED_SAFETY]: "Bloccato — sicurezza",
    [OUTCOME.BLOCKED_OWNERSHIP]: "Bloccato — ownership frontend",
    [OUTCOME.EXCLUDED]: "Escluso",
    [OUTCOME.UNSUPPORTED]: "Non supportato",
    [OUTCOME.ERROR]: "Errore",
  })[outcome] || "Errore";

const outcomeIcon = (outcome) =>
  ({
    [OUTCOME.APPLIED]: "✓",
    [OUTCOME.BLOCKED_SAFETY]: "⛔",
    [OUTCOME.BLOCKED_OWNERSHIP]: "◇",
    [OUTCOME.EXCLUDED]: "–",
    [OUTCOME.UNSUPPORTED]: "○",
    [OUTCOME.ERROR]: "!",
  })[outcome] || "!";

export function remediationSummary(outcomes) {
  const counts = Object.values(OUTCOME).reduce((acc, key) => ({ ...acc, [key]: 0 }), {});
  for (const outcome of outcomes) counts[outcome] = (counts[outcome] || 0) + 1;

  const parts = [
    `${counts[OUTCOME.APPLIED]} applicati`,
    `${counts[OUTCOME.BLOCKED_SAFETY]} bloccati per sicurezza`,
    `${counts[OUTCOME.BLOCKED_OWNERSHIP]} bloccati per ownership frontend`,
    `${counts[OUTCOME.EXCLUDED]} esclusi`,
    `${counts[OUTCOME.UNSUPPORTED]} non supportati`,
    `${counts[OUTCOME.ERROR]} errori reali`,
  ];
  const tail = counts[OUTCOME.APPLIED] > 0
    ? "Le modifiche applicate e il loro stato di verifica sono disponibili nella sezione Correzioni."
    : "Nessuna correzione è stata registrata perché non è stata effettuata alcuna modifica a WordPress.";

  return `Remediation completata: ${parts.join(", ")}. ${tail}`;
}

function enhanceReport() {
  const report = document.querySelector(".audit-unified-report");
  if (!report) return;
  const rows = [...report.children].filter((node) => node.tagName === "DIV");
  if (!rows.length) return;

  const outcomes = rows.map((row) => {
    const span = row.querySelector("span");
    const small = row.querySelector("small");
    const reason = String(small?.textContent || "").trim();
    const corrected = reason.startsWith("Applicato a WordPress:");
    const outcome = classifyRemediationReason(reason, corrected);
    row.dataset.remediationOutcome = outcome;

    if (span) {
      const raw = String(span.textContent || "").replace(/^[✓!⛔◇–○]\s*/, "").trim();
      span.textContent = `${outcomeIcon(outcome)} ${raw}`;
    }
    if (small && small.dataset.outcomeDecorated !== outcome) {
      const clean = reason.replace(/^(?:Applicato|Bloccato — sicurezza|Bloccato — ownership frontend|Escluso|Non supportato|Errore):\s*/i, "");
      small.textContent = `${outcomeLabel(outcome)}: ${clean}`;
      small.dataset.outcomeDecorated = outcome;
    }
    return outcome;
  });

  const message = document.querySelector(".audit-remediation-message");
  if (message) {
    const summary = remediationSummary(outcomes);
    if (message.textContent !== summary) message.textContent = summary;
  }
}

if (typeof window !== "undefined" && !window.__seogrowRemediationReportUxInstalled) {
  window.__seogrowRemediationReportUxInstalled = true;
  const start = () => {
    enhanceReport();
    const observer = new MutationObserver(() => enhanceReport());
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  };
  if (document.body) start();
  else window.addEventListener("DOMContentLoaded", start, { once: true });
}

export { OUTCOME };
