const MAX_CANDIDATE_URLS = 30;

const ALLOWED_SOURCES = new Set([
  "manual-candidate-set",
  "partial-crawl",
  "complete-crawl",
  "verified-complete-crawl",
]);

const safeCount = (value) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
};

export function normalizeElementorCoverageProof(proof = {}) {
  const source = ALLOWED_SOURCES.has(String(proof?.source || ""))
    ? String(proof.source)
    : "manual-candidate-set";
  const totalUrls = safeCount(proof?.totalUrls);
  const complete = proof?.complete === true;
  const verified = proof?.verified === true;
  const provenanceId = String(proof?.provenanceId || "").trim().slice(0, 200);

  return {
    source,
    totalUrls,
    complete,
    verified,
    provenanceId,
  };
}

export function evaluateElementorCoverageProof({
  proof,
  provided,
  accepted,
  inspected,
  failed,
  maxCandidateUrls = MAX_CANDIDATE_URLS,
} = {}) {
  const normalized = normalizeElementorCoverageProof(proof);
  const counts = {
    provided: safeCount(provided) ?? 0,
    accepted: safeCount(accepted) ?? 0,
    inspected: safeCount(inspected) ?? 0,
    failed: safeCount(failed) ?? 0,
  };
  const max = safeCount(maxCandidateUrls) ?? MAX_CANDIDATE_URLS;

  const truncated = counts.provided > max ||
    (normalized.totalUrls !== null && normalized.totalUrls > max) ||
    counts.accepted < counts.provided;
  const allAccepted = counts.provided > 0 && counts.accepted === counts.provided;
  const allInspected = allAccepted && counts.inspected === counts.accepted && counts.failed === 0;
  const totalMatches = normalized.totalUrls !== null && normalized.totalUrls === counts.provided;
  const trustedSource = normalized.source === "verified-complete-crawl";
  const provenancePresent = normalized.provenanceId.length > 0;

  const completeSiteEnumeration = trustedSource &&
    normalized.complete === true &&
    normalized.verified === true &&
    provenancePresent &&
    totalMatches &&
    allInspected &&
    !truncated;

  let status = "partial";
  let reason = "Il set URL è diagnostico o parziale e non dimostra l'intero sito.";
  if (truncated) {
    status = "truncated";
    reason = "Il set URL supera il limite tecnico o è stato ridotto durante la normalizzazione.";
  } else if (normalized.source === "complete-crawl" && normalized.complete === true) {
    status = "declared-complete-unverified";
    reason = "Il crawl dichiara completezza, ma manca una attestazione verificata del backend.";
  } else if (trustedSource && (!normalized.verified || !provenancePresent)) {
    status = "verification-missing";
    reason = "La provenance del crawl completo non è verificata o identificabile.";
  } else if (trustedSource && !totalMatches) {
    status = "count-mismatch";
    reason = "Il numero totale attestato non coincide con le URL ricevute.";
  } else if (trustedSource && !allInspected) {
    status = "inspection-incomplete";
    reason = "Non tutte le URL attestate sono state accettate e ispezionate senza errori.";
  } else if (completeSiteEnumeration) {
    status = "verified-complete";
    reason = "Il set URL completo è attestato, coincide con il totale dichiarato ed è stato interamente ispezionato senza errori.";
  }

  return {
    ...normalized,
    ...counts,
    maxCandidateUrls: max,
    truncated,
    allAccepted,
    allInspected,
    totalMatches,
    completeSiteEnumeration,
    status,
    reason,
    sharedWriteAllowed: false,
  };
}

export { MAX_CANDIDATE_URLS as ELEMENTOR_COVERAGE_MAX_URLS };
