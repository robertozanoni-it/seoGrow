const clone = (value) => {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const pluginMeta = (entity) => entity?.meta && typeof entity.meta === "object" ? entity.meta : {};

export const normalizeVisibleText = (value) => String(value || "")
  .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&#(\d+);/g, " ")
  .replace(/&#x[\da-f]+;/gi, " ")
  .replace(/&(?:nbsp|amp|quot|apos|lt|gt);/gi, " ")
  .replace(/\s+/g, " ")
  .trim();

export const countTextWords = (value) => {
  const text = normalizeVisibleText(value);
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
};

export const countH1 = (value) => (String(value || "").match(/<h1\b[^>]*>/gi) || []).length;

const truthyFlag = (value) => value === true || value === 1 || value === "1" || value === "yes" || value === "true";

const isDynamic = (settings, key) => {
  const dynamic = settings?.__dynamic__;
  return Boolean(dynamic && typeof dynamic === "object" && !Array.isArray(dynamic) && dynamic[key]);
};

const hiddenEverywhere = (settings) => {
  if (truthyFlag(settings?.hide_element)) return true;
  const responsive = ["hide_desktop", "hide_tablet", "hide_mobile"];
  return responsive.every((key) => truthyFlag(settings?.[key]));
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
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) && parsed.length > 0;
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
      if (!settings || typeof settings !== "object" || Array.isArray(settings) || hiddenEverywhere(settings)) return;
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
        widgets.push({
          id: String(item.id || ""),
          item,
          value: settings.title,
          headerSize: String(settings.header_size || "h2").toLowerCase(),
        });
      }
    });
    if (!valid) return { state: "invalid", parsed: null, widgets: [], hasDocument: data.length > 0 };
    return { state: "valid", parsed: { data }, widgets, hasDocument: data.length > 0 };
  } catch {
    return { state: "invalid", parsed: null, widgets: [], hasDocument: true };
  }
}

export function serializeElementor(parsed) {
  if (!parsed || !Array.isArray(parsed.data)) throw new Error("Documento Elementor non valido: serializzazione bloccata.");
  return JSON.stringify(parsed.data);
}

export function assessCoreOwnership(kind, entity, frontend) {
  if (kind === "title") return { ok: frontend?.titleMatchesExpected === true, frontend };
  if (hasElementorDocument(entity)) {
    return {
      ok: false,
      frontend,
      reason: "La pagina contiene un documento Elementor non vuoto: il fallback su post_content è bloccato.",
    };
  }
  const coreContent = entity?.content?.raw || entity?.content?.rendered || "";
  const coreWords = countTextWords(coreContent);
  const strongCoverage = frontend?.contentCoverageStrong === true;
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
  const measured = candidates.map((candidate, index) => ({ ...candidate, probe: probeResults[index] || {} }));
  const confirmed = measured.filter((candidate) =>
    candidate.probe?.contentProbeAllMatched === true &&
    Number(candidate.probe?.contentProbeCount) >= 1,
  );
  if (confirmed.length === 1) return { candidate: confirmed[0], reason: "" };
  if (!confirmed.length) {
    return { candidate: null, reason: "Nessun text-editor Elementor candidato è confermato nel frontend pubblico." };
  }
  return {
    candidate: null,
    reason: "Più text-editor Elementor risultano visibili nel frontend. SeoGrow non sceglie in base alla sola lunghezza per evitare di modificare il widget sbagliato.",
  };
}

const normalizedHeading = (value) => normalizeVisibleText(value).normalize("NFKC").toLocaleLowerCase("it");

export function chooseElementorH1Plan(state, frontend) {
  const widgets = state?.widgets || [];
  const frontendTexts = Array.isArray(frontend?.h1Texts) ? frontend.h1Texts.map(normalizedHeading).filter(Boolean) : [];
  const currentH1 = widgets.filter((widget) => widget.headerSize === "h1");

  if (Number(frontend?.h1) === 0) {
    if (currentH1.length) {
      return { blocked: true, reason: "Elementor contiene H1, ma nessuno è visibile nel frontend corrente: possibile template, responsive rule o cache." };
    }
    if (widgets.length !== 1) {
      return { blocked: true, reason: "Manca l'H1 ma sono presenti più heading Elementor candidati. Serve una scelta non ambigua." };
    }
    widgets[0].item.settings.header_size = "h1";
    return { changed: true, expectedH1Text: widgets[0].value };
  }

  if (Number(frontend?.h1) > 1) {
    const matching = currentH1.filter((widget) => frontendTexts.includes(normalizedHeading(widget.value)));
    if (matching.length !== Number(frontend?.h1) || matching.length < 2) {
      return { blocked: true, reason: "Gli H1 visibili non coincidono in modo univoco con gli heading Elementor modificabili." };
    }
    matching.slice(1).forEach((widget) => { widget.item.settings.header_size = "h2"; });
    return { changed: true, expectedH1Text: matching[0].value };
  }

  if (Number(frontend?.h1) === 1) {
    return { alreadyResolved: true, expectedH1Text: frontend?.h1Texts?.[0] || "" };
  }

  return { blocked: true, reason: "Numero H1 frontend non verificabile." };
}
