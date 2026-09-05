import {
  basePath,
  elementorLibraryEndpoint,
  elementorLibraryRestDescriptor,
  safeBase,
} from "./wordpressInspectFastHook.js";

const HOOKED = Symbol.for("seogrow.elementorImpactHook");
const MAX_DOCUMENTS = 20;
const MAX_CONDITION_NODES = 2_000;
const MAX_STRING = 1_000;
const RATE_WINDOW_MS = 10 * 60_000;
const RATE_MAX = 60;
const RATE = new Map();

function authHeaders(username, password) {
  return {
    authorization: `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`,
    accept: "application/json",
    "content-type": "application/json",
    "user-agent": "seoGrowAI/1.4-wordpress-remediation",
  };
}

async function wpFetch(url, options = {}) {
  const response = await fetch(url, {
    redirect: "manual",
    ...options,
    signal: AbortSignal.timeout(20_000),
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    await response.body?.cancel();
    throw new Error("WordPress ha restituito un redirect inatteso durante l'ispezione Elementor.");
  }
  return response;
}

async function readJson(response) {
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`Risposta WordPress Elementor non valida (HTTP ${response.status}).`, { cause: error });
  }
  if (!response.ok) {
    throw new Error(`WordPress Elementor: ${data?.message || data?.code || `HTTP ${response.status}`}`);
  }
  return data;
}

export function normalizeImpactDocuments(documents) {
  const rows = Array.isArray(documents) ? documents : [];
  const unique = new Map();
  for (const row of rows.slice(0, MAX_DOCUMENTS * 2)) {
    const id = Number(row?.id);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    const type = String(row?.type || "unknown").trim().toLowerCase().slice(0, 80) || "unknown";
    const origins = Array.isArray(row?.origins)
      ? [...new Set(row.origins.map((value) => String(value || "").slice(0, 80)).filter(Boolean))].slice(0, 8)
      : [];
    const existing = unique.get(id);
    if (!existing) unique.set(id, { id, type, origins });
    else {
      existing.origins = [...new Set([...existing.origins, ...origins])].slice(0, 8);
      if (existing.type === "unknown" && type !== "unknown") existing.type = type;
    }
    if (unique.size >= MAX_DOCUMENTS) break;
  }
  return [...unique.values()].toSorted((a, b) => a.id - b.id || a.type.localeCompare(b.type));
}

export function boundConditionValue(input) {
  let nodes = 0;
  const visit = (value, depth) => {
    nodes += 1;
    if (nodes > MAX_CONDITION_NODES) return "[TRUNCATED_NODE_LIMIT]";
    if (depth > 12) return "[TRUNCATED_DEPTH]";
    if (value === null || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value === "string") return value.slice(0, MAX_STRING);
    if (Array.isArray(value)) return value.slice(0, 200).map((item) => visit(item, depth + 1));
    if (value && typeof value === "object") {
      const output = {};
      for (const [key, item] of Object.entries(value).slice(0, 200)) {
        output[String(key).slice(0, 160)] = visit(item, depth + 1);
        if (nodes > MAX_CONDITION_NODES) break;
      }
      return output;
    }
    return String(value ?? "").slice(0, MAX_STRING);
  };
  return visit(input, 0);
}

export function extractElementorConditionEvidence(entity, requested = {}) {
  const meta = entity?.meta && typeof entity.meta === "object" && !Array.isArray(entity.meta) ? entity.meta : {};
  const hasConditions = Object.prototype.hasOwnProperty.call(meta, "_elementor_conditions");
  const templateType = String(meta._elementor_template_type || requested.type || entity?.type || "unknown").trim().toLowerCase() || "unknown";
  const conditions = hasConditions ? boundConditionValue(meta._elementor_conditions) : null;
  return {
    id: Number(entity?.id),
    type: templateType,
    title: String(entity?.title?.raw || entity?.title?.rendered || "").trim(),
    status: String(entity?.status || "").trim(),
    link: String(entity?.link || "").trim(),
    origins: Array.isArray(requested.origins) ? requested.origins : [],
    conditionsObserved: hasConditions,
    conditions,
    conditionsSource: hasConditions ? "elementor-rest-edit-context" : "not-exposed",
    displayConditionsResolved: false,
    affectedPagesEnumerated: false,
    sharedWriteAllowed: false,
    note: hasConditions
      ? "Le condizioni sono evidenza read-only. SeoGrow non ne assume ancora la semantica né il raggio completo sulle URL."
      : "Questa versione/configurazione Elementor non espone _elementor_conditions nel contesto REST edit: nessuna inferenza viene fatta.",
  };
}

function typesEndpoint(base) {
  return new URL(`${basePath(base)}/wp-json/wp/v2/types?context=edit`, base.origin);
}

export function impactRateAllowed(key, now = Date.now()) {
  const safeKey = String(key || "local").slice(0, 200);
  const recent = (RATE.get(safeKey) || []).filter((time) => now - time < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    RATE.set(safeKey, recent);
    return false;
  }
  recent.push(now);
  RATE.set(safeKey, recent);
  if (RATE.size > 5_000) {
    for (const [candidate, timestamps] of RATE.entries()) {
      if (!timestamps.some((time) => now - time < RATE_WINDOW_MS)) RATE.delete(candidate);
      if (RATE.size <= 4_000) break;
    }
  }
  return true;
}

export function resetImpactRateForTests() {
  RATE.clear();
}

async function inspectImpact({ siteUrl, username, applicationPassword, documents }) {
  if (!username || !applicationPassword) throw new Error("Inserisci utente e password applicativa WordPress.");
  const requested = normalizeImpactDocuments(documents);
  if (!requested.length) throw new Error("Indica almeno un documento Elementor già identificato da SeoGrow.");
  const base = await safeBase(siteUrl);
  const headers = authHeaders(username, applicationPassword);
  const types = await readJson(await wpFetch(typesEndpoint(base), { headers }));
  const descriptor = elementorLibraryRestDescriptor(types);
  if (!descriptor) throw new Error("Elementor Library non espone una REST base editabile leggibile: impact analysis bloccata.");

  const results = [];
  for (const document of requested) {
    try {
      const entity = await readJson(await wpFetch(elementorLibraryEndpoint(base, descriptor, document.id), { headers }));
      if (Number(entity?.id) !== document.id) throw new Error("L'ID restituito da WordPress non coincide con il documento Elementor richiesto.");
      results.push({ ok: true, ...extractElementorConditionEvidence(entity, document) });
    } catch (error) {
      results.push({
        ok: false,
        id: document.id,
        type: document.type,
        origins: document.origins,
        sharedWriteAllowed: false,
        displayConditionsResolved: false,
        affectedPagesEnumerated: false,
        error: error instanceof Error ? error.message : "Ispezione documento Elementor non riuscita.",
      });
    }
  }

  return {
    ok: true,
    readOnly: true,
    mode: "elementor-impact-evidence",
    documents: results,
    conditionsSemantics: "unresolved",
    displayConditionsResolved: false,
    affectedPagesEnumerated: false,
    sharedWriteAllowed: false,
  };
}

function registerRoutes(app) {
  if (app[HOOKED]) return;
  app[HOOKED] = true;
  app.post("/api/wordpress/elementor-impact-inspect", async (req, res) => {
    if (!impactRateAllowed(req.ip || req.socket?.remoteAddress || "local")) {
      return res.status(429).json({
        error: "Limite impact analysis Elementor raggiunto. Riprova più tardi.",
        readOnly: true,
        sharedWriteAllowed: false,
        displayConditionsResolved: false,
        affectedPagesEnumerated: false,
      });
    }
    try {
      return res.json(await inspectImpact(req.body || {}));
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Impact analysis Elementor non riuscita.",
        readOnly: true,
        sharedWriteAllowed: false,
        displayConditionsResolved: false,
        affectedPagesEnumerated: false,
      });
    }
  });
}

export { inspectImpact, registerRoutes };
