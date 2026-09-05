import { apiFetch } from "./api";

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

export async function inspectElementorImpactEvidence(entity, credentials) {
  const documents = elementorSourceDocuments(entity);
  if (!documents.length) return null;
  try {
    const response = await apiFetch("/api/wordpress/elementor-impact-inspect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        siteUrl: credentials?.url || "",
        username: credentials?.username || "",
        applicationPassword: credentials?.applicationPassword || "",
        documents,
      }),
    });
    const data = await response.json();
    if (!response.ok) return failedEvidence(data?.error || "Impact analysis Elementor non disponibile.");
    return {
      ...data,
      readOnly: true,
      sharedWriteAllowed: false,
      displayConditionsResolved: data?.displayConditionsResolved === true ? true : false,
      affectedPagesEnumerated: data?.affectedPagesEnumerated === true ? true : false,
    };
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
      const conditionLabel = condition?.ok && condition?.conditionsObserved
        ? " · condizioni lette (semantica da verificare)"
        : condition?.ok
          ? " · condizioni non esposte"
          : condition?.error
            ? " · condizioni non verificabili"
            : "";
      return `${type}${Number.isSafeInteger(id) ? ` #${id}` : ""}${title ? ` “${title}”` : ""}${conditionLabel}`;
    });
    const evidenceNote = impactEvidence?.ok === false
      ? ` La lettura read-only delle condizioni non è riuscita: ${impactEvidence.error}`
      : impactEvidence
        ? " Le condizioni disponibili sono state lette in sola lettura, ma SeoGrow non ne considera ancora risolta la semantica né enumera automaticamente tutte le URL coinvolte."
        : " Le Display Conditions e il raggio sulle altre URL non sono ancora dimostrati.";
    return `Il frontend della URL usa anche documenti Elementor condivisi: ${labels.join(", ")}. SeoGrow ha identificato l'ownership esterna ma non modifica automaticamente un template condiviso senza analizzarne l'impatto sulle altre pagine.${evidenceNote}`;
  }

  if (ownership.elementorEvidenceStatus === "shared-templates-present-unresolved") {
    const types = Array.isArray(ownership.elementorSharedTemplateTypes) ? ownership.elementorSharedTemplateTypes : [];
    return `Nel sito risultano template Elementor condivisi${types.length ? ` (${types.join(", ")})` : ""}, ma il documento sorgente applicato a questa URL non è stato identificato con certezza.`;
  }
  return "La pagina contiene ownership Elementor locale o condivisa che non può essere attribuita con certezza a un singolo widget modificabile.";
}
