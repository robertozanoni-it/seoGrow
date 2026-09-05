const stripHtml = (value) => String(value || "")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&(?:#\d+|#x[\da-f]+|\w+);/gi, " ")
  .replace(/\s+/g, " ")
  .trim();

export const countVisibleWords = (value) => {
  const text = stripHtml(value);
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
};

const issueText = (issue) =>
  `${issue?.type || ""} ${issue?.label || ""} ${issue?.detail || ""}`.toLowerCase();

const clampTarget = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, Math.ceil(value)));

export function shortContentTarget(issue, page) {
  const explicit = Number(issue?.remediationTargetWords);
  if (Number.isFinite(explicit) && explicit > 0) {
    return clampTarget(explicit, 20, 1200);
  }

  const text = issueText(issue);
  if (!/(?:contenuto|content|testo).*(?:brev|parole|words?)|(?:brev|parole|words?).*(?:contenuto|content|testo)/i.test(text)) {
    return 0;
  }

  let threshold = 180;
  if (/pagina\s+utility|page\s+utility/.test(text)) threshold = 60;
  else if (/pagina\s+archive|page\s+archive/.test(text)) threshold = 80;
  else if (/pagina\s+gdpr|page\s+gdpr/.test(text)) threshold = 0;

  if (threshold <= 0) return 0;

  const currentWords = countVisibleWords(page?.content);
  const match = text.match(/(\d+)\s*(?:parole|words?)/i);
  const reportedWords = match ? Number(match[1]) : NaN;
  const baseline = Number.isFinite(reportedWords) ? reportedWords : currentWords;
  if (baseline >= threshold) return 0;

  const deficit = Math.max(0, threshold - baseline);
  const margin = threshold >= 180 ? 30 : 20;
  const rawTarget = currentWords + deficit + margin;
  const minimumTarget = Math.max(currentWords + 20, threshold + 10);
  const maximumTarget = threshold + (threshold >= 180 ? 50 : 40);

  return clampTarget(rawTarget, minimumTarget, maximumTarget);
}
