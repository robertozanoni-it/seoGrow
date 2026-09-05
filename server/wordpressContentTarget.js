const decodeEntity = (entity) => {
  const value = String(entity || "");
  if (/^&#\d+;$/.test(value)) {
    const codePoint = Number(value.slice(2, -1));
    return Number.isSafeInteger(codePoint) ? String.fromCodePoint(codePoint) : " ";
  }
  if (/^&#x[\da-f]+;$/i.test(value)) {
    const codePoint = Number.parseInt(value.slice(3, -1), 16);
    return Number.isSafeInteger(codePoint) ? String.fromCodePoint(codePoint) : " ";
  }
  const named = {
    "&amp;": "&",
    "&apos;": "'",
    "&#039;": "'",
    "&quot;": "\"",
    "&nbsp;": " ",
    "&lt;": "<",
    "&gt;": ">",
  };
  return named[value.toLowerCase()] ?? " ";
};

const stripHtml = (value) => String(value || "")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&(?:#\d+|#x[\da-f]+|\w+);/gi, (entity) => decodeEntity(entity))
  .replace(/\s+/g, " ")
  .trim();

export const countVisibleWords = (value) => {
  const text = stripHtml(value);
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
};

const issueText = (issue) =>
  `${issue?.type || ""} ${issue?.label || ""} ${issue?.detail || ""}`.toLowerCase();

const isNonNegativeInteger = (value) => Number.isSafeInteger(value) && value >= 0;

export function shortContentTarget(issue, page) {
  const explicit = Number(issue?.remediationTargetWords);
  if (Number.isFinite(explicit) && explicit > 0) {
    if (!Number.isSafeInteger(explicit) || explicit < 20 || explicit > 1200) {
      throw new Error("Target esplicito della remediation non valido o oltre il limite sicuro.");
    }
    return explicit;
  }

  const text = issueText(issue);
  const isShortContent =
    /(?:contenuto|content|testo).*(?:brev|parole|words?)|(?:brev|parole|words?).*(?:contenuto|content|testo)/i.test(text);
  if (!isShortContent) return 0;

  const measurement = page?.remediationMeasurement;
  if (!measurement || typeof measurement !== "object") {
    throw new Error("Misura frontend corrente assente: target contenuto non determinabile in sicurezza.");
  }

  const frontendWords = Number(measurement.frontendWords);
  const fieldWords = Number(measurement.fieldWords);
  const minimumWords = Number(measurement.minimumWords);
  const suppliedMargin = measurement.marginWords;

  if (
    !isNonNegativeInteger(frontendWords) ||
    !isNonNegativeInteger(fieldWords) ||
    !isNonNegativeInteger(minimumWords) ||
    fieldWords > frontendWords
  ) {
    throw new Error("Misure frontend/campo non valide o non coerenti.");
  }

  if (minimumWords === 0 || frontendWords >= minimumWords) return 0;

  const marginWords = suppliedMargin === undefined
    ? minimumWords >= 180 ? 30 : 20
    : Number(suppliedMargin);

  if (!isNonNegativeInteger(marginWords) || marginWords > 200) {
    throw new Error("Margine della remediation non valido.");
  }

  const deficit = minimumWords - frontendWords;
  const target = fieldWords + deficit + marginWords;

  if (!Number.isSafeInteger(target) || target <= fieldWords || target > 1200) {
    throw new Error(
      "Il target necessario supera i limiti della generazione sicura. Il requisito non viene ridotto automaticamente.",
    );
  }

  return target;
}
