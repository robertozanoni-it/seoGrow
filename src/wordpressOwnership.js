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

export function hasElementorDocument(entity) {
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
  if (raw === undefined || raw === null || raw === "") {
    return { state: "absent", parsed: null, widgets: [], hasDocument: false };
  }

  try {
    const data = typeof raw === "string" ? JSON.parse(raw) : clone(raw);
    if (!Array.isArray(data)) return { state: "invalid", parsed: null, widgets: [], hasDocument: true };

    const widgets = [];
    const valid = walk(data, (item) => {
      const settings = item?.settings;
      if (!settings || typeof settings !== "object" || Array.isArray(settings)) return;

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

    if (!valid) return { state: "invalid", parsed: null, widgets: [], hasDocument: data.length > 0 };
    return { state: "valid", parsed: { data }, widgets, hasDocument: data.length > 0 };
  } catch {
    return { state: "invalid", parsed: null, widgets: [], hasDocument: true };
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
    return {
      ok: false,
      frontend,
      coreWords,
      reason: "La pagina contiene un documento Elementor non vuoto: il fallback su post_content è bloccato.",
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
