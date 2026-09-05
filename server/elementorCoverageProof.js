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
  const clientVerifiedClaim = proof?.verified === true;
  const clientProvenanceId = String(proof?.provenanceId || "").trim().slice(0, 200);

  return {
    source,
    totalUrls,
    complete,
    clientVerifiedClaim,
    clientProvenanceId,
  };
}

export function normalizeElementorCoverageAttestation(attestation = {}) {
  const verified = attestation?.verified === true;
  const provenanceId = String(attestation?.provenanceId || "").trim().slice(0, 200);
  const totalUrls = safeCount(attestation?.totalUrls);
  const source = String(attestation?.source || "").trim().slice(0, 80);
  return {
    verified,
    provenanceId,
    totalUrls,
    source,
  };
}

export function evaluateElementorCoverageProof({
  proof,
  serverAttestation,
  provided,
  accepted,
  inspected,
  failed,
  maxCandidateUrls = MAX_CANDIDATE_URLS,
} = {}) {
  const normalized = normalizeElementorCoverageProof(proof);
  const attestation = normalizeElementorCoverageAttestation(serverAttestation);
  const counts = {
    provided: safeCount(provided) ?? 0,
    accepted: safeCount(accepted) ?? 0,
    inspected: safeCount(inspected) ?? 0,
    failed: safeCount(failed) ?? 0,
  };
  const max = safeCount(maxCandidateUrls) ?? MAX_CANDIDATE_URLS;

  const truncated = counts.provided > max ||
    (normalized.totalUrls !== null && normalized.totalUrls > max) ||
    (attestation.totalUrls !== null && attestation.totalUrls > max) ||
    counts.accepted < counts.provided;
  const allAccepted = counts.provided > 0 && counts.accepted === counts.provided;
  const allInspected = allAccepted && counts.inspected === counts.accepted && counts.failed === 0;
  const clientTotalMatches = normalized.totalUrls !== null && normalized.totalUrls === counts.provided;
  const attestedTotalMatches = attestation.totalUrls !== null && attestation.totalUrls === counts.provided;
  const trustedSource = normalized.source === "verified-complete-crawl";
  const serverVerified = attestation.verified === true && attestation.provenanceId.length > 0;
  const provenanceMatches = normalized.clientProvenanceId.length > 0 &&
    normalized.clientProvenanceId === attestation.provenanceId;
  const attestationSourceTrusted = attestation.source === "server-crawl-registry";

  const completeSiteEnumeration = trustedSource &&
    normalized.complete === true &&
    serverVerified &&
    attestationSourceTrusted &&
    provenanceMatches &&
    clientTotalMatches &&
    attestedTotalMatches &&
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
  } else if (trustedSource && !serverVerified) {
    status = "server-verification-missing";
    reason = "Il client dichiara un crawl verificato, ma manca una attestazione server valida.";
  } else if (trustedSource && !attestationSourceTrusted) {
    status = "attestation-source-untrusted";
    reason = "L'attestazione non proviene dal registro crawl server autorizzato.";
  } else if (trustedSource && !provenanceMatches) {
    status = "provenance-mismatch";
    reason = "La provenance dichiarata dal client non coincide con quella attestata dal server.";
  } else if (trustedSource && (!clientTotalMatches || !attestedTotalMatches)) {
    status = "count-mismatch";
    reason = "Il numero totale dichiarato o attestato non coincide con le URL ricevute.";
  } else if (trustedSource && !allInspected) {
    status = "inspection-incomplete";
    reason = "Non tutte le URL attestate sono state accettate e ispezionate senza errori.";
  } else if (completeSiteEnumeration) {
    status = "verified-complete";
    reason = "Il set URL completo è attestato dal server, coincide con il totale dichiarato ed è stato interamente ispezionato senza errori.";
  }

  return {
    ...normalized,
    serverAttestation: attestation,
    ...counts,
    maxCandidateUrls: max,
    truncated,
    allAccepted,
    allInspected,
    clientTotalMatches,
    attestedTotalMatches,
    provenanceMatches,
    serverVerified,
    attestationSourceTrusted,
    completeSiteEnumeration,
    status,
    reason,
    sharedWriteAllowed: false,
  };
}

export { MAX_CANDIDATE_URLS as ELEMENTOR_COVERAGE_MAX_URLS };
