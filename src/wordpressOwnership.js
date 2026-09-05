import { summarizeElementorImpact } from "./elementorImpact.js";

const pluginMeta = (entity) => entity?.meta && typeof entity.meta === "object" ? entity.meta : {};

const clone = (value) => {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const decodeEntity = (entity) => {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ndash: "–",
    mdash: "—",
    hellip: "…",
  };
  const body = String(entity || "").slice(1, -1);
  if (body.startsWith("#x") || body.startsWith("#X")) {
    const code = Number.parseInt(body.slice(2), 16);
    return Number.isFinite(code) ? String.fromCodePoint(code) : " ";
  }
  if (body.startsWith("#")) {
    const code = Number.parseInt(body.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : " ";
  }
  return named[body.toLowerCase()] ?? " ";
};

const normalizeText = (value) => String(value || "")
  .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&(?:#\d+|#x[\da-f]+|\w+);/gi, (entity) => decodeEntity(entity))
  .replace(/\s+/g, " ")
  .trim();

export const countTextWords = (value) => {
  const text = normalizeText(value);
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
};

export const countH1 = (value) => (String(value || "").match(/<h1\b[^>]*>/gi) || []).length;

const isDynamic = (settings, key) => {
  const dynamic = settings?.__dynamic__;
  return Boolean(
    dynamic &&
    typeof dynamic === "object" &&
    Object.prototype.hasOwnProperty.call(dynamic, key) &&
    dynamic[key],
  );
};

const walk = (items, visitor, depth = 0, state = { nodes: 0 }) => {
  if (!Array.isArray(items) || depth > 80) return false;
  for (const item of items) {
    state.nodes += 1;
    if (state.nodes > 5000) return false;
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    visitor(item);
    if (item.elements !== undefined && !Array.isArray(item.elements)) return false;
    if (item.elements && !walk(item.elements, visitor, depth + 1, state)) return false;
  }
  return true;
};

const elementorRaw = (entity) => pluginMeta(entity)._elementor_data;
const ownership = (entity) => entity?._seogrowOwnership && typeof entity._seogrowOwnership === "object"
  ? entity._seogrowOwnership
  : {};
const impactFor = (entity) => summarizeElementorImpact(ownership(entity));
const sharedElementorTemplateTypes = (entity) => {
  const values = ownership(entity).elementorSharedTemplateTypes;
  return Array.isArray(values)
    ? [...new Set(values.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))]
    : [];
};

const renderedExternalReferences = (entity) => {
  const values = ownership(entity).elementorExternalRenderedDocuments;
  if (!Array.isArray(values)) return [];
  const unique = new Map();
  for (const value of values) {
    const id = Number(value?.id);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    const templateType = String(value?.type || "unknown").trim().toLowerCase() || "unknown";
    unique.set(`${id}:${templateType}`, {
      type: "rendered-document",
      templateType,
      id: String(id),
    });
  }
  return [...unique.values()];
};

const localOwnershipReferences = (entity) => {
  const values = ownership(entity).elementorLocalSourceReferences;
  if (!Array.isArray(values)) return [];
  const unique = new Map();
  for (const value of values) {
    const id = Number(value?.id);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    const sourceType = String(value?.type || "").trim().toLowerCase();
    const reference = sourceType === "widget"
      ? { type: "global-widget", templateType: "widget", id: String(id) }
      : { type: "template", templateType: "reusable", id: String(id) };
    unique.set(`${reference.type}:${reference.templateType}:${reference.id}`, reference);
  }
  return [...unique.values()];
};

const externalSharedReferences = (entity) => {
  const rendered = renderedExternalReferences(entity);
  const local = localOwnershipReferences(entity);
  const precise = [...rendered, ...local];
  if (precise.length) {
    return [...new Map(precise.map((reference) => [
      `${reference.type}:${reference.templateType}:${reference.id}`,
      reference,
    ])).values()];
  }

  const evidenceStatus = String(ownership(entity).elementorEvidenceStatus || "");
  if (["local-document-only-observed", "no-rendered-shared-document-observed"].includes(evidenceStatus)) return [];

  return sharedElementorTemplateTypes(entity)
    .map((templateType) => ({ type: "theme-template", templateType, id: "" }));
};

const localElementorDocumentObserved = (entity) => ownership(entity).elementorLocalDocumentRendered === true;

export function hasElementorDocument(entity) {
  if (externalSharedReferences(entity).length || localElementorDocumentObserved(entity)) return true;
  const raw = elementorRaw(entity);
  if (raw === undefined || raw === null || raw === "") return false;
  try {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(data) && data.length > 0;
  } catch {
    return true;
  }
}

export function inspectEditableElementor(kind, entity) {
  const raw = elementorRaw(entity);
  const sharedReferences = externalSharedReferences(entity);
  const localObserved = localElementorDocumentObserved(entity);
  const impact = impactFor(entity);
  if (raw === undefined || raw === null || raw === "") {
    if (sharedReferences.length || localObserved) {
      return {
        state: "valid",
        parsed: null,
        widgets: [],
        hasDocument: true,
        sharedReferences,
        impact,
      };
    }
    return { state: "absent", parsed: null, widgets: [], hasDocument: false, sharedReferences: [], impact };
  }

  try {
    const data = typeof raw === "string" ? JSON.parse(raw) : clone(raw);
    if (!Array.isArray(data)) return { state: "invalid", parsed: null, widgets: [], hasDocument: true, sharedReferences, impact };

    const widgets = [];
    const valid = walk(data, (item) => {
      const settings = item?.settings;
      if (!settings || typeof settings !== "object" || Array.isArray(settings)) return;

      const widgetType = String(item.widgetType || "").toLowerCase();
      const templateId = String(settings.template_id || settings.templateId || "").trim();
      const globalId = String(settings.global_widget_id || settings.globalWidgetId || "").trim();
      if (widgetType === "template" && templateId) {
        sharedReferences.push({ type: "template", templateType: "reusable", id: templateId });
      }
      if (widgetType === "global" || globalId) {
        sharedReferences.push({ type: "global-widget", templateType: "widget", id: globalId || String(item.id || "") });
      }

      if (
        kind === "content" &&
        item.widgetType === "text-editor" &&
        typeof settings.editor === "string" &&
        settings.editor.trim() &&
        !isDynamic(settings, "editor")
      ) {
        widgets.push({
          id: String(item.id || ""),
          item,
          value: settings.editor,
          words: countTextWords(settings.editor),
        });
      }

      if (
        kind === "h1" &&
        item.widgetType === "heading" &&
        typeof settings.title === "string" &&
        settings.title.trim() &&
        !isDynamic(settings, "title") &&
        !isDynamic(settings, "header_size")
      ) {
        widgets.push({ id: String(item.id || ""), item, value: settings.title });
      }
    });

    if (!valid) return { state: "invalid", parsed: null, widgets: [], hasDocument: data.length > 0, sharedReferences, impact };

    const uniqueSharedReferences = [...new Map(sharedReferences.map((reference) => [
      `${reference.type}:${reference.templateType}:${reference.id}`,
      reference,
    ])).values()];

    // Se il documento dipende da template/widget condivisi effettivamente renderizzati
    // oppure da riferimenti interni a template/global widget, SeoGrow non può attribuire
    // con certezza il markup pubblico a un singolo widget locale.
    if (uniqueSharedReferences.length) {
      return {
        state: "valid",
        parsed: { data },
        widgets: [],
        hasDocument: true,
        sharedReferences: uniqueSharedReferences,
        impact,
      };
    }

    return { state: "valid", parsed: { data }, widgets, hasDocument: data.length > 0, sharedReferences: [], impact };
  } catch {
    return { state: "invalid", parsed: null, widgets: [], hasDocument: true, sharedReferences, impact };
  }
}

export function serializeElementor(parsed) {
  if (!parsed || !Array.isArray(parsed.data)) {
    throw new Error("Documento Elementor non valido: serializzazione bloccata.");
  }
  return JSON.stringify(parsed.data);
}

export function assessCoreOwnership(kind, entity, frontend) {
  if (kind === "title") {
    return { ok: frontend?.titleMatchesExpected === true, frontend };
  }

  const coreContent = entity?.content?.raw || entity?.content?.rendered || "";
  const coreWords = countTextWords(coreContent);
  const frontendWords = Number(frontend?.words);
  const probeCount = Number(frontend?.contentProbeCount);
  const probeMatches = Number(frontend?.contentProbeMatches);
  const expectedWords = Number(frontend?.expectedWords);

  const strongCoverage = frontend?.contentCoverageStrong === true || Boolean(
    frontend?.contentProbeVisible === true &&
    Number.isFinite(probeCount) && probeCount >= 2 &&
    probeMatches === probeCount &&
    Number.isFinite(expectedWords) && expectedWords >= 20 &&
    Number.isFinite(frontendWords) && frontendWords > 0 &&
    expectedWords / frontendWords >= 0.55,
  );

  if (hasElementorDocument(entity)) {
    const impact = impactFor(entity);
    return {
      ok: false,
      frontend,
      coreWords,
      impact,
      reason: `La pagina contiene ownership Elementor locale o condivisa: il fallback su post_content è bloccato. ${impact.summary}`,
    };
  }

  if (kind === "h1") {
    const coreH1 = countH1(coreContent);
    const frontendH1 = Number(frontend?.h1);
    return {
      ok: strongCoverage && frontendH1 === coreH1,
      frontend,
      coreH1,
      frontendH1,
      coreWords,
    };
  }

  return { ok: strongCoverage, frontend, coreWords };
}

export function chooseElementorContentCandidate(candidates, probeResults) {
  const confirmed = candidates
    .map((candidate, index) => ({ ...candidate, probe: probeResults[index] }))
    .filter((candidate) => {
      const probeCount = Number(candidate.probe?.contentProbeCount);
      const probeMatches = Number(candidate.probe?.contentProbeMatches);
      const expectedWords = Number(candidate.probe?.expectedWords ?? candidate.words);
      const allProbesVisible = candidate.probe?.contentProbeVisible === true &&
        Number.isFinite(probeCount) && probeCount >= 2 &&
        probeMatches === probeCount;
      const enoughEvidence = Number.isFinite(expectedWords) && expectedWords >= 12;
      return enoughEvidence && (candidate.probe?.contentCoverageStrong === true || allProbesVisible);
    });

  if (confirmed.length === 0) {
    return {
      candidate: null,
      reason: "Nessun text-editor Elementor candidato è confermato in modo univoco nel frontend pubblico.",
    };
  }

  if (confirmed.length === 1) return { candidate: confirmed[0], reason: "" };

  return {
    candidate: null,
    reason: "Più text-editor Elementor risultano confermati nel frontend: la sola lunghezza non è sufficiente per scegliere il widget da modificare.",
  };
}
