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

const normalizedType = (value) => {
  const type = String(value || "unknown").trim().toLowerCase();
  return IMPACT_BY_TYPE[type] ? type : "unknown";
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

  for (const row of rows) {
    const id = Number(row?.id);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    const type = normalizedType(row?.type);
    const key = `${id}:${type}`;
    const impact = IMPACT_BY_TYPE[type];
    const incoming = {
      id,
      type,
      title: String(row?.title || "").trim(),
      resolved: row?.resolved === true,
      origins: Array.isArray(row?.origins) ? [...new Set(row.origins.map((value) => String(value)))] : [],
      scope: impact.scope,
      risk: impact.risk,
      label: impact.label,
      reason: impact.reason,
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
    });
  }

  return [...unique.values()].toSorted((a, b) => a.id - b.id || a.type.localeCompare(b.type));
};

export function summarizeElementorImpact(input) {
  const ownership = input && typeof input === "object" ? input : {};
  const evidenceStatus = String(ownership.elementorEvidenceStatus || "not-elementor");
  const siteWideTypes = Array.isArray(ownership.elementorSharedTemplateTypes)
    ? [...new Set(ownership.elementorSharedTemplateTypes.map(normalizedType))]
    : [];
  const sources = normalizeSources(ownership);
  const hasSharedSources = sources.length > 0;
  const unresolvedSiteWideRisk = !hasSharedSources && evidenceStatus === "shared-templates-present-unresolved";
  const localOnly = !hasSharedSources && ["local-document-only-observed", "no-rendered-shared-document-observed"].includes(evidenceStatus);

  let status = "not-elementor";
  let summary = "Nessuna ownership Elementor condivisa rilevata.";
  if (hasSharedSources) {
    status = sources.every((source) => source.resolved) ? "source-identified" : "source-partially-identified";
    summary = `SeoGrow ha identificato ${sources.length} sorgent${sources.length === 1 ? "e" : "i"} Elementor condivis${sources.length === 1 ? "a" : "e"}. Il raggio completo sulle altre URL non è ancora enumerato: nessuna scrittura condivisa è autorizzata.`;
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
    sharedWriteAllowed: false,
    requiresImpactReview: hasSharedSources || unresolvedSiteWideRisk,
    affectedPagesEnumerated: false,
    displayConditionsResolved: false,
    impactConfidence: hasSharedSources ? "source-identified-scope-not-enumerated" : localOnly ? "local-observation" : "low",
  };
}
