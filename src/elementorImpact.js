const IMPACT_BY_TYPE = {
  header: {
    scope: "shared-layout",
    risk: "high",
    label: "Header condiviso",
    reason: "Un header Elementor può essere riutilizzato su più URL.",
  },
  footer: {
    scope: "shared-layout",
    risk: "high",
    label: "Footer condiviso",
    reason: "Un footer Elementor può essere riutilizzato su più URL.",
  },
  single: {
    scope: "theme-template",
    risk: "high",
    label: "Template Single",
    reason: "Un template Single può governare più contenuti in base alle condizioni Elementor Pro.",
  },
  archive: {
    scope: "theme-template",
    risk: "high",
    label: "Template Archive",
    reason: "Un template Archive può governare più archivi in base alle condizioni Elementor Pro.",
  },
  popup: {
    scope: "conditional-overlay",
    risk: "high",
    label: "Popup",
    reason: "Un popup può comparire su più URL in base a condizioni, trigger e regole runtime.",
  },
  widget: {
    scope: "reusable-component",
    risk: "high",
    label: "Global widget",
    reason: "Un global widget può essere riutilizzato in più documenti Elementor.",
  },
  template: {
    scope: "reusable-template",
    risk: "high",
    label: "Template riutilizzato",
    reason: "Un Template widget può essere riutilizzato in più documenti Elementor.",
  },
  unknown: {
    scope: "shared-document",
    risk: "high",
    label: "Documento Elementor condiviso",
    reason: "Il documento è condiviso, ma il suo raggio di impatto non è ancora determinabile.",
  },
};

const THEME_BUILDER_TYPES = new Set(["header", "footer", "single", "archive"]);

const normalizedType = (value) => {
  const type = String(value || "unknown").trim().toLowerCase();
  return IMPACT_BY_TYPE[type] ? type : "unknown";
};

const impactEvidenceOf = (ownership) => ownership?.elementorImpactEvidence &&
  typeof ownership.elementorImpactEvidence === "object" &&
  !Array.isArray(ownership.elementorImpactEvidence)
  ? ownership.elementorImpactEvidence
  : null;

const impactEvidenceById = (ownership) => {
  const evidence = impactEvidenceOf(ownership);
  const rows = Array.isArray(evidence?.documents) ? evidence.documents : [];
  const byId = new Map();
  for (const row of rows) {
    const id = Number(row?.id);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    byId.set(id, row);
  }
  return { evidence, byId };
};

const normalizeSources = (ownership) => {
  const resolved = Array.isArray(ownership?.elementorResolvedSourceDocuments)
    ? ownership.elementorResolvedSourceDocuments
    : [];
  const fallback = Array.isArray(ownership?.elementorExternalRenderedDocuments)
    ? ownership.elementorExternalRenderedDocuments
    : [];
  const rows = resolved.length ? resolved : fallback;
  const unique = new Map();
  const { byId } = impactEvidenceById(ownership);

  for (const row of rows) {
    const id = Number(row?.id);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    const type = normalizedType(row?.type);
    const key = `${id}:${type}`;
    const impact = IMPACT_BY_TYPE[type];
    const evidence = byId.get(id);
    const origins = Array.isArray(row?.origins) ? [...new Set(row.origins.map((value) => String(value)))] : [];
    const typeEvidenceStatus = String(
      evidence?.typeEvidence?.status || row?.typeEvidence?.status || "",
    );
    const targetApplicability = String(
      evidence?.targetApplicability || evidence?.conditionInterpretation?.targetApplicability || "unknown",
    );
    const displayConditionsResolved = evidence?.ok === true && evidence?.displayConditionsResolved === true;
    const renderedOnTarget = origins.includes("frontend-rendered");
    const targetOwnershipCandidate = THEME_BUILDER_TYPES.has(type) &&
      row?.resolved === true &&
      renderedOnTarget &&
      typeEvidenceStatus === "verified" &&
      displayConditionsResolved &&
      targetApplicability === "applies";
    const incoming = {
      id,
      type,
      title: String(row?.title || "").trim(),
      resolved: row?.resolved === true,
      origins,
      scope: impact.scope,
      risk: impact.risk,
      label: impact.label,
      reason: impact.reason,
      displayConditionsResolved,
      conditionsObserved: evidence?.conditionsObserved === true,
      conditionSemanticStatus: String(evidence?.conditionInterpretation?.semanticStatus || ""),
      entireSiteIncluded: evidence?.conditionInterpretation?.entireSiteIncluded === true,
      targetApplicability,
      typeEvidenceStatus,
      renderedOnTarget,
      targetOwnershipCandidate,
      observedRenderedCount: Number.isFinite(Number(evidence?.observedRenderedCount))
        ? Math.max(0, Number(evidence.observedRenderedCount))
        : 0,
      observedRenderedUrls: Array.isArray(evidence?.observedRenderedUrls)
        ? [...new Set(evidence.observedRenderedUrls.map(String).filter(Boolean))]
        : [],
    };
    const previous = unique.get(key);
    if (!previous) {
      unique.set(key, incoming);
      continue;
    }
    unique.set(key, {
      ...previous,
      title: previous.title || incoming.title,
      resolved: previous.resolved || incoming.resolved,
      origins: [...new Set([...previous.origins, ...incoming.origins])],
      displayConditionsResolved: previous.displayConditionsResolved || incoming.displayConditionsResolved,
      conditionsObserved: previous.conditionsObserved || incoming.conditionsObserved,
      conditionSemanticStatus: previous.conditionSemanticStatus || incoming.conditionSemanticStatus,
      entireSiteIncluded: previous.entireSiteIncluded || incoming.entireSiteIncluded,
      targetApplicability: previous.targetApplicability !== "unknown" ? previous.targetApplicability : incoming.targetApplicability,
      typeEvidenceStatus: previous.typeEvidenceStatus || incoming.typeEvidenceStatus,
      renderedOnTarget: previous.renderedOnTarget || incoming.renderedOnTarget,
      targetOwnershipCandidate: previous.targetOwnershipCandidate || incoming.targetOwnershipCandidate,
      observedRenderedCount: Math.max(previous.observedRenderedCount, incoming.observedRenderedCount),
      observedRenderedUrls: [...new Set([...previous.observedRenderedUrls, ...incoming.observedRenderedUrls])],
    });
  }

  return [...unique.values()].toSorted((a, b) => a.id - b.id || a.type.localeCompare(b.type));
};

const summarizeThemeBuilderTargetOwnership = (sources) => {
  const themeSources = sources.filter((source) => THEME_BUILDER_TYPES.has(source.type));
  if (!themeSources.length) {
    return {
      status: "not-observed",
      confirmedSources: [],
      unresolvedSources: [],
      ambiguousTypes: [],
    };
  }

  const candidatesByType = new Map();
  for (const source of themeSources) {
    if (!source.targetOwnershipCandidate) continue;
    const rows = candidatesByType.get(source.type) || [];
    rows.push(source);
    candidatesByType.set(source.type, rows);
  }

  const ambiguousTypes = [...candidatesByType.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([type]) => type)
    .toSorted();
  const ambiguousSet = new Set(ambiguousTypes);
  const confirmedSources = themeSources.filter((source) =>
    source.targetOwnershipCandidate && !ambiguousSet.has(source.type),
  );
  const confirmedKeys = new Set(confirmedSources.map((source) => `${source.id}:${source.type}`));
  const unresolvedSources = themeSources.filter((source) => !confirmedKeys.has(`${source.id}:${source.type}`));

  let status = "unresolved";
  if (ambiguousTypes.length) status = "ambiguous";
  else if (confirmedSources.length === themeSources.length) status = "confirmed";
  else if (confirmedSources.length) status = "partial";

  return { status, confirmedSources, unresolvedSources, ambiguousTypes };
};

export function summarizeElementorImpact(input) {
  const ownership = input && typeof input === "object" ? input : {};
  const evidenceStatus = String(ownership.elementorEvidenceStatus || "not-elementor");
  const siteWideTypes = Array.isArray(ownership.elementorSharedTemplateTypes)
    ? [...new Set(ownership.elementorSharedTemplateTypes.map(normalizedType))]
    : [];
  const sources = normalizeSources(ownership);
  const { evidence } = impactEvidenceById(ownership);
  const hasSharedSources = sources.length > 0;
  const unresolvedSiteWideRisk = !hasSharedSources && evidenceStatus === "shared-templates-present-unresolved";
  const localOnly = !hasSharedSources && ["local-document-only-observed", "no-rendered-shared-document-observed"].includes(evidenceStatus);
  const displayConditionsResolved = hasSharedSources && evidence?.ok !== false &&
    sources.every((source) => source.displayConditionsResolved === true);
  const affectedPagesEnumerated = displayConditionsResolved && evidence?.affectedPagesEnumerated === true &&
    evidence?.observedUrlCoverage?.completeSiteEnumeration === true;
  const themeBuilderTargetOwnership = summarizeThemeBuilderTargetOwnership(sources);

  let status = "not-elementor";
  let summary = "Nessuna ownership Elementor condivisa rilevata.";
  if (hasSharedSources) {
    status = sources.every((source) => source.resolved) ? "source-identified" : "source-partially-identified";
    const conditionNote = displayConditionsResolved
      ? " Le Display Conditions note risultano semanticamente risolte, ma il raggio completo sulle altre URL non è ancora enumerato."
      : " Le condizioni applicative o il raggio sulle altre URL non sono ancora completamente risolti.";
    const targetNote = themeBuilderTargetOwnership.status === "confirmed"
      ? " Per i documenti Theme Builder osservati, sorgente, tipo, rendering sulla URL e applicabilità delle condizioni coincidono in modo univoco."
      : themeBuilderTargetOwnership.status === "partial"
        ? " Una parte dell'ownership Theme Builder sulla URL è confermata, mentre altre sorgenti restano non risolte."
        : themeBuilderTargetOwnership.status === "ambiguous"
          ? ` L'ownership Theme Builder resta ambigua per: ${themeBuilderTargetOwnership.ambiguousTypes.join(", ")}.`
          : "";
    summary = `SeoGrow ha identificato ${sources.length} sorgent${sources.length === 1 ? "e" : "i"} Elementor condivis${sources.length === 1 ? "a" : "e"}.${conditionNote}${targetNote} Nessuna scrittura condivisa è autorizzata.`;
  } else if (unresolvedSiteWideRisk) {
    status = "shared-risk-unresolved";
    summary = `Nel sito esistono template Elementor condivisi${siteWideTypes.length ? ` (${siteWideTypes.join(", ")})` : ""}, ma SeoGrow non ha identificato con certezza quali governino questa URL.`;
  } else if (localOnly) {
    status = "local-only-observed";
    summary = "Il frontend osservato non mostra documenti Elementor condivisi applicati oltre al documento locale.";
  } else if (evidenceStatus !== "not-elementor") {
    status = "insufficient-evidence";
    summary = "L'ownership Elementor non dispone ancora di evidenza sufficiente per stimare l'impatto condiviso.";
  }

  return {
    status,
    summary,
    sources,
    siteWideTypes,
    themeBuilderTargetOwnership,
    sharedWriteAllowed: false,
    requiresImpactReview: hasSharedSources || unresolvedSiteWideRisk,
    affectedPagesEnumerated,
    displayConditionsResolved,
    observedUrlCoverage: evidence?.observedUrlCoverage || null,
    impactConfidence: affectedPagesEnumerated
      ? "conditions-and-site-enumeration-resolved"
      : displayConditionsResolved
        ? "conditions-resolved-scope-not-enumerated"
        : hasSharedSources
          ? "source-identified-scope-not-enumerated"
          : localOnly
            ? "local-observation"
            : "low",
  };
}
