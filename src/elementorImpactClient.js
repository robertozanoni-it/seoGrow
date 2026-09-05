import { apiFetch } from "./api.js";

const COVERAGE_ATTESTATION_TTL_MS = 5 * 60_000;
const coverageAttestationCache = new Map();

const ownershipOf = (entity) => entity?._seogrowOwnership && typeof entity._seogrowOwnership === "object"
  ? entity._seogrowOwnership
  : {};

export function elementorSourceDocuments(entity) {
  const ownership = ownershipOf(entity);
  const resolved = Array.isArray(ownership.elementorResolvedSourceDocuments)
    ? ownership.elementorResolvedSourceDocuments
    : [];
  const rendered = Array.isArray(ownership.elementorExternalRenderedDocuments)
    ? ownership.elementorExternalRenderedDocuments
    : [];
  const local = Array.isArray(ownership.elementorLocalSourceReferences)
    ? ownership.elementorLocalSourceReferences
    : [];
  const rows = resolved.length ? resolved : [...rendered, ...local];
  const unique = new Map();
  for (const row of rows) {
    const id = Number(row?.id);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    const type = String(row?.type || "unknown").trim().toLowerCase() || "unknown";
    const origins = Array.isArray(row?.origins)
      ? row.origins
      : row?.origin ? [row.origin] : [];
    const previous = unique.get(id);
    if (!previous) unique.set(id, { id, type, origins: [...new Set(origins.map(String))] });
    else {
      previous.origins = [...new Set([...previous.origins, ...origins.map(String)])];
      if (previous.type === "unknown" && type !== "unknown") previous.type = type;
    }
  }
  return [...unique.values()].toSorted((a, b) => a.id - b.id || a.type.localeCompare(b.type));
}

const failedEvidence = (error) => ({
  ok: false,
  readOnly: true,
  sharedWriteAllowed: false,
  displayConditionsResolved: false,
  affectedPagesEnumerated: false,
  documents: [],
  error: error instanceof Error ? error.message : String(error || "Impact analysis Elementor non disponibile."),
});

const normalizeSuccessfulEvidence = (data) => {
  const documents = Array.isArray(data?.documents) ? data.documents : [];
  const displayConditionsResolved = documents.length > 0 &&
    documents.every((row) => row?.ok === true && row?.displayConditionsResolved === true);
  const completeSiteEnumeration = data?.observedUrlCoverage?.completeSiteEnumeration === true;
  const affectedPagesEnumerated = data?.affectedPagesEnumerated === true &&
    completeSiteEnumeration &&
    displayConditionsResolved;
  return {
    ...(data && typeof data === "object" ? data : {}),
    documents,
    readOnly: true,
    sharedWriteAllowed: false,
    displayConditionsResolved,
    affectedPagesEnumerated,
  };
};

const normalizeCoverageProofForRequest = (coverageProof) => {
  if (!coverageProof || typeof coverageProof !== "object" || Array.isArray(coverageProof)) {
    return { source: "manual-candidate-set", complete: false, verified: false };
  }
  return {
    source: String(coverageProof.source || "manual-candidate-set"),
    totalUrls: Number.isSafeInteger(Number(coverageProof.totalUrls)) ? Number(coverageProof.totalUrls) : undefined,
    complete: coverageProof.complete === true,
    verified: coverageProof.verified === true,
    provenanceId: String(coverageProof.provenanceId || "").slice(0, 200),
  };
};

const coverageCredentialKey = (credentials) => [
  String(credentials?.url || "").trim(),
  String(credentials?.username || "").trim(),
].join("|");

export async function requestElementorCoverageAttestation(credentials) {
  const url = String(credentials?.url || "").trim();
  const username = String(credentials?.username || "").trim();
  const applicationPassword = String(credentials?.applicationPassword || "");
  if (!url || !username || !applicationPassword) return null;

  const key = coverageCredentialKey(credentials);
  const now = Date.now();
  const cached = coverageAttestationCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = (async () => {
    try {
      const response = await apiFetch("/api/wordpress/elementor-coverage-attest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          siteUrl: url,
          username,
          applicationPassword,
        }),
      });
      const data = await response.json();
      if (!response.ok || data?.verified !== true) return null;
      const candidateUrls = Array.isArray(data?.candidateUrls) ? data.candidateUrls : [];
      const totalUrls = Number(data?.totalUrls);
      const provenanceId = String(data?.provenanceId || "").trim();
      if (!candidateUrls.length || !Number.isSafeInteger(totalUrls) || totalUrls !== candidateUrls.length || !provenanceId) {
        return null;
      }
      return {
        candidateUrls,
        coverageProof: {
          source: "verified-complete-crawl",
          totalUrls,
          complete: true,
          verified: true,
          provenanceId,
        },
        expiresAt: Number(data?.expiresAt) || 0,
      };
    } catch {
      return null;
    }
  })();

  coverageAttestationCache.set(key, { promise, expiresAt: now + COVERAGE_ATTESTATION_TTL_MS });
  return promise;
}

export async function inspectElementorImpactEvidence(entity, credentials, candidateUrls = [], coverageProof = null) {
  const documents = elementorSourceDocuments(entity);
  if (!documents.length) return null;
  try {
    let effectiveCandidateUrls = Array.isArray(candidateUrls) ? candidateUrls : [];
    let effectiveCoverageProof = coverageProof;
    if (!effectiveCoverageProof) {
      const attested = await requestElementorCoverageAttestation(credentials);
      if (attested) {
        effectiveCandidateUrls = attested.candidateUrls;
        effectiveCoverageProof = attested.coverageProof;
      }
    }

    const response = await apiFetch("/api/wordpress/elementor-impact-inspect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        siteUrl: credentials?.url || "",
        username: credentials?.username || "",
        applicationPassword: credentials?.applicationPassword || "",
        targetEntity: {
          id: Number(entity?.id),
          type: String(entity?.type || "").trim().toLowerCase(),
        },
        documents,
        candidateUrls: effectiveCandidateUrls,
        coverageProof: normalizeCoverageProofForRequest(effectiveCoverageProof),
      }),
    });
    const data = await response.json();
    if (!response.ok) return failedEvidence(data?.error || "Impact analysis Elementor non disponibile.");
    return normalizeSuccessfulEvidence(data);
  } catch (error) {
    // L'impact analysis è diagnostica read-only: un timeout/rete non deve mai
    // trasformarsi in autorizzazione implicita né nascondere il blocco ownership.
    return failedEvidence(error);
  }
}

export function attachElementorImpactEvidence(entity, evidence) {
  if (!entity || typeof entity !== "object" || !evidence) return entity;
  const current = ownershipOf(entity);
  entity._seogrowOwnership = {
    ...current,
    elementorImpactEvidence: evidence,
  };
  return entity;
}

export function elementorOwnershipDetail(entity) {
  const ownership = ownershipOf(entity);
  const impactEvidence = ownership.elementorImpactEvidence && typeof ownership.elementorImpactEvidence === "object"
    ? ownership.elementorImpactEvidence
    : null;
  const conditionRows = Array.isArray(impactEvidence?.documents) ? impactEvidence.documents : [];
  const conditionById = new Map(conditionRows.map((row) => [Number(row?.id), row]));
  const resolved = Array.isArray(ownership.elementorResolvedSourceDocuments)
    ? ownership.elementorResolvedSourceDocuments.filter((item) => item?.resolved === true)
    : [];
  const rendered = Array.isArray(ownership.elementorExternalRenderedDocuments)
    ? ownership.elementorExternalRenderedDocuments
    : [];
  const local = Array.isArray(ownership.elementorLocalSourceReferences)
    ? ownership.elementorLocalSourceReferences
    : [];
  const sources = resolved.length ? resolved : [...rendered, ...local];

  if (sources.length) {
    const labels = sources.slice(0, 6).map((item) => {
      const type = String(item?.type || "documento");
      const id = Number(item?.id);
      const title = String(item?.title || "").trim();
      const condition = Number.isSafeInteger(id) ? conditionById.get(id) : null;
      const observedCount = Number(condition?.observedRenderedCount || 0);
      const targetApplicability = String(condition?.conditionInterpretation?.targetApplicability || condition?.targetApplicability || "unknown");
      const conditionLabel = condition?.ok && condition?.displayConditionsResolved && targetApplicability === "applies"
        ? " · condizioni confermano applicazione sulla risorsa target"
        : condition?.ok && condition?.displayConditionsResolved && targetApplicability === "excluded"
          ? " · condizioni escludono la risorsa target"
          : condition?.ok && condition?.displayConditionsResolved && targetApplicability === "not-applied"
            ? " · condizioni non includono la risorsa target"
            : condition?.ok && condition?.displayConditionsResolved && condition?.conditionInterpretation?.entireSiteIncluded
              ? " · ambito intero sito confermato"
              : condition?.ok && condition?.conditionsObserved
                ? " · condizioni lette (semantica parziale/da verificare)"
                : condition?.ok
                  ? " · condizioni non esposte"
                  : condition?.error
                    ? " · condizioni non verificabili"
                    : "";
      const observedLabel = observedCount > 0 ? ` · osservato su ${observedCount} URL del crawl disponibile` : "";
      return `${type}${Number.isSafeInteger(id) ? ` #${id}` : ""}${title ? ` “${title}”` : ""}${conditionLabel}${observedLabel}`;
    });
    const coverage = impactEvidence?.observedUrlCoverage;
    const coverageNote = coverage?.inspected > 0
      ? coverage?.completeSiteEnumeration === true && impactEvidence?.affectedPagesEnumerated === true
        ? ` Sono state controllate tutte le ${coverage.inspected} URL dichiarate come enumerazione completa del sito, senza promuovere questa evidenza a permesso di scrittura condivisa.`
        : ` Sono state controllate ${coverage.inspected} URL candidate${coverage.failed ? `; ${coverage.failed} non verificabili` : ""}. Questo non equivale a una enumerazione completa del sito.`
      : "";
    const targetNote = impactEvidence?.targetApplicabilityResolved
      ? " L'applicazione alla risorsa WordPress target è stata valutata per tutte le condizioni del sottoinsieme supportato."
      : "";
    const evidenceNote = impactEvidence?.ok === false
      ? ` La lettura read-only delle condizioni non è riuscita: ${impactEvidence.error}`
      : impactEvidence?.displayConditionsResolved
        ? impactEvidence?.affectedPagesEnumerated === true
          ? ` La semantica delle condizioni note e l'enumerazione completa dichiarata delle URL risultano risolte.${targetNote}${coverageNote}`
          : ` La semantica delle condizioni note è risolta per il sottoinsieme supportato, ma il raggio completo sulle URL non è enumerato.${targetNote}${coverageNote}`
        : impactEvidence
          ? ` Le condizioni disponibili sono state lette in sola lettura; le regole non riconosciute restano semanticamente non risolte.${coverageNote}`
          : " Le Display Conditions e il raggio sulle altre URL non sono ancora dimostrati.";
    return `Il frontend della URL usa anche documenti Elementor condivisi: ${labels.join(", ")}. SeoGrow ha identificato l'ownership esterna ma non modifica automaticamente un template condiviso senza analizzarne l'impatto sulle altre pagine.${evidenceNote}`;
  }

  if (ownership.elementorEvidenceStatus === "shared-templates-present-unresolved") {
    const types = Array.isArray(ownership.elementorSharedTemplateTypes) ? ownership.elementorSharedTemplateTypes : [];
    return `Nel sito risultano template Elementor condivisi${types.length ? ` (${types.join(", ")})` : ""}, ma il documento sorgente applicato a questa URL non è stato identificato con certezza.`;
  }
  return "La pagina contiene ownership Elementor locale o condivisa che non può essere attribuita con certezza a un singolo widget modificabile.";
}
