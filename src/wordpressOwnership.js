const pluginMeta = (entity) => entity?.meta && typeof entity.meta === "object" ? entity.meta : {};

const clone = (value) => {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const normalizeText = (value) => String(value || "")
  .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&(?:#\d+|#x[\da-f]+|\w+);/gi, " ")
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

const walk = (items, visitor) => {
  if (!Array.isArray(items)) return false;
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    visitor(item);
    if (item.elements !== undefined && !Array.isArray(item.elements)) return false;
    if (item.elements && !walk(item.elements, visitor)) return false;
  }
  return true;
};

export function inspectEditableElementor(kind, entity) {
  const raw = pluginMeta(entity)._elementor_data;
  if (raw === undefined || raw === null || raw === "") {
    return { state: "absent", parsed: null, widgets: [] };
  }

  try {
    const data = typeof raw === "string" ? JSON.parse(raw) : clone(raw);
    if (!Array.isArray(data)) return { state: "invalid", parsed: null, widgets: [] };

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
        widgets.push({ item, value: settings.editor, words: countTextWords(settings.editor) });
      }

      if (
        kind === "h1" &&
        item.widgetType === "heading" &&
        typeof settings.title === "string" &&
        settings.title.trim() &&
        !isDynamic(settings, "title") &&
        !isDynamic(settings, "header_size")
      ) {
        widgets.push({ item, value: settings.title });
      }
    });

    if (!valid) return { state: "invalid", parsed: null, widgets: [] };
    return { state: "valid", parsed: { data }, widgets };
  } catch {
    return { state: "invalid", parsed: null, widgets: [] };
  }
}

export const serializeElementor = (parsed) => JSON.stringify(parsed?.data || []);

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

export function chooseElementorContentCandidate(candidates, probeResults, frontendWords) {
  const visible = candidates
    .map((candidate, index) => ({ ...candidate, probe: probeResults[index] }))
    .filter((candidate) => candidate.probe?.contentProbeVisible === true)
    .sort((a, b) => b.words - a.words);

  if (visible.length === 0) return { candidate: null, reason: "Nessun text-editor Elementor candidato è confermato nel frontend pubblico." };
  if (visible.length === 1) return { candidate: visible[0], reason: "" };

  const total = Number(frontendWords);
  const first = visible[0];
  const second = visible[1];
  const dominant = Number.isFinite(total) && total > 0 &&
    first.words >= Math.max(20, total * 0.45) &&
    second.words <= first.words * 0.6;

  if (dominant) return { candidate: first, reason: "" };
  return {
    candidate: null,
    reason: "Più text-editor Elementor risultano visibili e nessuno è abbastanza dominante da essere modificato senza ambiguità.",
  };
}
