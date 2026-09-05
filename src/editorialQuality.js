const stripHtml = (value) => String(value || "")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&(?:#\d+|#x[\da-f]+|\w+);/gi, " ")
  .replace(/\s+/g, " ")
  .trim();

const normalize = (value) => stripHtml(value)
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9à-ÿ]+/gi, " ")
  .replace(/\s+/g, " ")
  .trim();

const words = (value) => normalize(value).split(/\s+/).filter(Boolean);

const repeatedNgrams = (value, width = 5) => {
  const tokens = words(value);
  const seen = new Map();
  const repeats = [];
  for (let index = 0; index <= tokens.length - width; index += 1) {
    const gram = tokens.slice(index, index + width).join(" ");
    const previous = seen.get(gram);
    if (previous != null && index - previous >= width) repeats.push(gram);
    else if (previous == null) seen.set(gram, index);
  }
  return [...new Set(repeats)];
};

const numericClaims = (value) =>
  [...String(value || "").matchAll(/\b\d+(?:[.,]\d+)?(?:\s*%|\s*(?:anni|mesi|giorni|ore|euro|€|£|\$))?\b/gi)]
    .map((match) => match[0].replace(/\s+/g, "").toLowerCase());

const danglingEnding = (value) => {
  const text = stripHtml(value).trim();
  if (!text) return true;
  if (/[,:;\-–—]$/.test(text)) return true;
  const last = normalize(text).split(/\s+/).at(-1) || "";
  return /^(?:un|uno|una|il|lo|la|i|gli|le|di|del|dello|della|dei|degli|delle|a|ad|da|in|con|su|per|tra|fra|e|ed|o|od|che|come|se|ma)$/.test(last);
};

const suspiciousRawExcerpt = (value) =>
  /(?:introduzione\s*:|\[\.\.\.|\.\.\.|continua a leggere|read more|lorem ipsum|<\/?[a-z][^>]*>)/i.test(String(value || ""));

const sourceText = (page = {}) =>
  stripHtml(`${page.title || ""} ${page.excerpt || ""} ${page.content || ""}`);

export function validateSeoSuggestion(kind, value, page = {}) {
  const text = stripHtml(value);
  const errors = [];
  const warnings = [];
  const normalizedKind = String(kind || "").toLowerCase();
  const length = text.length;
  const tokenCount = words(text).length;

  if (!text) errors.push("Il testo è vuoto.");
  if (suspiciousRawExcerpt(text)) errors.push("Il testo contiene un estratto grezzo, markup o un segnale di troncamento.");
  if (danglingEnding(text)) errors.push("La frase termina in modo incompleto o con una parola funzionale sospesa.");

  const repeats = repeatedNgrams(text);
  if (repeats.length) errors.push(`Il testo ripete sequenze già usate: ${repeats.slice(0, 2).join(" / ")}.`);

  if (normalizedKind === "seo_title" || normalizedKind === "title") {
    if (length < 20) errors.push("Il title è troppo corto per essere pubblicato automaticamente.");
    if (length > 70) errors.push("Il title supera 70 caratteri.");
    if (tokenCount < 3) errors.push("Il title non contiene abbastanza informazioni.");
  }

  if (normalizedKind === "meta_description" || normalizedKind === "description") {
    if (length < 110) errors.push("La meta description è troppo corta per il quality gate automatico.");
    if (length > 175) errors.push("La meta description supera 175 caratteri.");
    if (!/[.!?…]$/.test(text)) errors.push("La meta description non termina con una frase completa.");
    if (tokenCount < 14) errors.push("La meta description è troppo povera di contenuto.");
  }

  if (normalizedKind === "excerpt") {
    if (tokenCount < 12) errors.push("L'excerpt è troppo corto.");
    if (tokenCount > 60) warnings.push("L'excerpt è più lungo del normale.");
  }

  if (normalizedKind === "content") {
    if (tokenCount < 30) warnings.push("Il contenuto generato è molto breve: richiede una verifica aggiuntiva.");
  }

  const source = sourceText(page);
  if (source) {
    const sourceNumbers = new Set(numericClaims(source));
    const unsupportedNumbers = numericClaims(text).filter((claim) => !sourceNumbers.has(claim));
    if (unsupportedNumbers.length) {
      errors.push(`Il testo introduce dati numerici non presenti nella pagina sorgente: ${[...new Set(unsupportedNumbers)].slice(0, 4).join(", ")}.`);
    }

    const title = normalize(page.title);
    const candidate = normalize(text);
    if (normalizedKind === "meta_description" && title && candidate.startsWith(`${title} ${title}`)) {
      errors.push("La meta description ripete il title consecutivamente.");
    }
  }

  return {
    publishable: errors.length === 0,
    errors,
    warnings,
    metrics: { characters: length, words: tokenCount, repeatedNgrams: repeats.length },
  };
}

export function assertPublishableSeoSuggestion(kind, value, page = {}) {
  const quality = validateSeoSuggestion(kind, value, page);
  if (!quality.publishable) {
    const error = new Error(`Proposta AI non pubblicabile automaticamente: ${quality.errors.join(" ")}`);
    error.code = "EDITORIAL_REVIEW_REQUIRED";
    error.quality = quality;
    throw error;
  }
  return quality;
}

export { stripHtml };
