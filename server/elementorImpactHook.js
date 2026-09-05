import {
  basePath,
  elementorLibraryEndpoint,
  elementorLibraryRestDescriptor,
  safeBase,
} from "./wordpressInspectFastHook.js";
import { inspect as inspectFrontend } from "./frontendVerificationHook.js";

const HOOKED = Symbol.for("seogrow.elementorImpactHook");
const MAX_DOCUMENTS = 20;
const MAX_CANDIDATE_URLS = 30;
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

export function normalizeImpactTarget(targetEntity) {
  const id = Number(targetEntity?.id);
  return {
    id: Number.isSafeInteger(id) && id > 0 ? id : null,
    type: String(targetEntity?.type || "").trim().toLowerCase().slice(0, 80),
  };
}

export function interpretElementorConditions(input, targetEntity = null) {
  const target = normalizeImpactTarget(targetEntity);
  const values = Array.isArray(input)
    ? input.filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean).slice(0, 200)
    : [];
  const entries = values.map((raw) => {
    const segments = raw.split("/").map((part) => part.trim()).filter(Boolean).slice(0, 12);
    const operator = ["include", "exclude"].includes(segments[0]) ? segments[0] : "unknown";
    const path = operator === "unknown" ? segments : segments.slice(1);
    const general = operator !== "unknown" && path.length === 1 && path[0] === "general";
    const entireSite = operator === "include" && general;
    const finalToken = path.at(-1) || "";
    const explicitNumericTarget = /^\d+$/.test(finalToken) ? Number(finalToken) : null;
    // Only the exact singular/<post-type>/<numeric-id> shape is safe to interpret.
    // Nested rules such as singular/page/by-author/12 remain unresolved instead of
    // accidentally treating the final numeric token as a WordPress entity ID.
    const explicitSingularTarget = operator !== "unknown" && path[0] === "singular" && path.length === 3 && explicitNumericTarget !== null;
    const targetMatches = explicitSingularTarget && target.id !== null
      ? explicitNumericTarget === target.id
      : null;

    let semanticStatus = "unresolved";
    let targetEffect = "unknown";
    if (general) {
      semanticStatus = operator === "include" ? "resolved-entire-site" : "resolved-entire-site-exclusion";
      targetEffect = operator;
    } else if (explicitSingularTarget && target.id !== null) {
      semanticStatus = "resolved-explicit-singular-target";
      targetEffect = targetMatches ? operator : "no-match";
    }

    return {
      raw,
      operator,
      path,
      entireSite,
      explicitNumericTarget,
      explicitSingularTarget,
      targetMatches,
      targetEffect,
      semanticStatus,
    };
  });
  const resolvedEntries = entries.filter((entry) => entry.semanticStatus !== "unresolved").length;
  const displayConditionsResolved = entries.length > 0 && resolvedEntries === entries.length;
  const includeRules = entries.filter((entry) => entry.operator === "include");
  let targetApplicability = "unknown";
  if (displayConditionsResolved && target.id !== null) {
    if (entries.some((entry) => entry.targetEffect === "exclude")) targetApplicability = "excluded";
    else if (entries.some((entry) => entry.targetEffect === "include")) targetApplicability = "applies";
    else if (includeRules.length > 0) targetApplicability = "not-applied";
  }

  let note;
  if (displayConditionsResolved && targetApplicability === "applies") {
    note = "Le condizioni osservate sono interpretabili nel sottoinsieme supportato e includono la risorsa WordPress target.";
  } else if (displayConditionsResolved && targetApplicability === "excluded") {
    note = "Le condizioni osservate sono interpretabili nel sottoinsieme supportato e una regola exclude esclude la risorsa WordPress target.";
  } else if (displayConditionsResolved && targetApplicability === "not-applied") {
    note = "Le condizioni osservate sono interpretabili nel sottoinsieme supportato, ma nessuna regola include corrisponde alla risorsa WordPress target.";
  } else if (displayConditionsResolved) {
    note = "Le condizioni osservate sono interpretabili nel sottoinsieme supportato, ma manca un'identità WordPress target sufficiente per stabilirne l'applicazione.";
  } else if (resolvedEntries > 0) {
    note = "Una parte delle condizioni è interpretabile, ma almeno una regola resta semanticamente non risolta.";
  } else {
    note = "Le condizioni sono conservate come evidenza strutturata senza inferenze sul loro significato.";
  }

  return {
    entries,
    target,
    entireSiteIncluded: entries.some((entry) => entry.entireSite),
    targetApplicability,
    semanticStatus: displayConditionsResolved ? "resolved" : resolvedEntries > 0 ? "partial" : "unresolved",
    displayConditionsResolved,
    note,
  };
}

const canonicalHost = (hostname) => String(hostname || "").toLowerCase().replace(/^www\./, "");

export function normalizeImpactCandidateUrls(base, candidateUrls) {
  const root = base instanceof URL ? base : new URL(String(base || ""));
  const rootHost = canonicalHost(root.hostname);
  const rows = Array.isArray(candidateUrls) ? candidateUrls : [];
  const unique = new Map();
  for (const value of rows.slice(0, MAX_CANDIDATE_URLS * 3)) {
    try {
      const url = new URL(String(value || ""), root);
      if (url.protocol !== "https:" || canonicalHost(url.hostname) !== rootHost) continue;
      url.hash = "";
      const key = `${canonicalHost(url.hostname)}${url.pathname}${url.search}`;
      if (!unique.has(key)) unique.set(key, url.href);
      if (unique.size >= MAX_CANDIDATE_URLS) break;
    } catch {
      // URL malformata: esclusa dalla coverage, senza interrompere la diagnostica.
    }
  }
  return [...unique.values()];
}

export function extractElementorConditionEvidence(entity, requested = {}, targetEntity = null) {
  const meta = entity?.meta && typeof entity.meta === "object" && !Array.isArray(entity.meta) ? entity.meta : {};
  const hasConditions = Object.prototype.hasOwnProperty.call(meta, "_elementor_conditions");
  const templateType = String(meta._elementor_template_type || requested.type || entity?.type || "unknown").trim().toLowerCase() || "unknown";
  const conditions = hasConditions ? boundConditionValue(meta._elementor_conditions) : null;
  const conditionInterpretation = hasConditions
    ? interpretElementorConditions(meta._elementor_conditions, targetEntity)
    : interpretElementorConditions(null, targetEntity);
  return {
    id: Number(entity?.id),
    type: templateType,
    title: String(entity?.title?.raw || entity?.title?.rendered || "").trim(),
    status: String(entity?.status || "").trim(),
    link: String(entity?.link || "").trim(),
    origins: Array.isArray(requested.origins) ? requested.origins : [],
    conditionsObserved: hasConditions,
    conditions,
    conditionInterpretation,
    conditionsSource: hasConditions ? "elementor-rest-edit-context" : "not-exposed",
    displayConditionsResolved: hasConditions && conditionInterpretation.displayConditionsResolved === true,
    targetApplicability: conditionInterpretation.targetApplicability,
    affectedPagesEnumerated: false,
    sharedWriteAllowed: false,
    note: hasConditions
      ? conditionInterpretation.note
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

async function observeRenderedSources(candidateUrls, documentIds) {
  const ids = new Set(documentIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0));
  if (!candidateUrls.length || !ids.size) {
    return { inspected: 0, failed: 0, rows: [], byDocument: new Map() };
  }
  const rows = new Array(candidateUrls.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < candidateUrls.length) {
      const index = cursor;
      cursor += 1;
      const requestedUrl = candidateUrls[index];
      try {
        const result = await inspectFrontend(requestedUrl);
        const documents = (Array.isArray(result?.elementorDocuments) ? result.elementorDocuments : [])
          .filter((document) => ids.has(Number(document?.id)))
          .map((document) => ({ id: Number(document.id), type: String(document.type || "unknown") }));
        rows[index] = {
          ok: true,
          requestedUrl,
          finalUrl: String(result?.url || requestedUrl),
          documents,
          requiresBrowserVerification: result?.requiresBrowserVerification === true,
        };
      } catch (error) {
        rows[index] = {
          ok: false,
          requestedUrl,
          error: error instanceof Error ? error.message : "Ispezione frontend non riuscita.",
        };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, candidateUrls.length) }, () => worker()));
  const byDocument = new Map([...ids].map((id) => [id, []]));
  for (const row of rows) {
    if (!row?.ok) continue;
    for (const document of row.documents) byDocument.get(document.id)?.push(row.finalUrl);
  }
  return {
    inspected: rows.filter((row) => row?.ok).length,
    failed: rows.filter((row) => row && !row.ok).length,
    rows,
    byDocument,
  };
}

async function inspectImpact({ siteUrl, username, applicationPassword, documents, candidateUrls, targetEntity }) {
  if (!username || !applicationPassword) throw new Error("Inserisci utente e password applicativa WordPress.");
  const requested = normalizeImpactDocuments(documents);
  if (!requested.length) throw new Error("Indica almeno un documento Elementor già identificato da SeoGrow.");
  const normalizedTarget = normalizeImpactTarget(targetEntity);
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
      results.push({ ok: true, ...extractElementorConditionEvidence(entity, document, normalizedTarget) });
    } catch (error) {
      results.push({
        ok: false,
        id: document.id,
        type: document.type,
        origins: document.origins,
        sharedWriteAllowed: false,
        displayConditionsResolved: false,
        targetApplicability: "unknown",
        affectedPagesEnumerated: false,
        error: error instanceof Error ? error.message : "Ispezione documento Elementor non riuscita.",
      });
    }
  }

  const normalizedCandidates = normalizeImpactCandidateUrls(base, candidateUrls);
  const observed = await observeRenderedSources(normalizedCandidates, requested.map((document) => document.id));
  for (const result of results) {
    const urls = observed.byDocument.get(Number(result.id)) || [];
    result.observedRenderedUrls = [...new Set(urls)];
    result.observedRenderedCount = result.observedRenderedUrls.length;
    result.observedCandidateCoverage = {
      inspected: observed.inspected,
      failed: observed.failed,
      candidateUrls: normalizedCandidates.length,
      completeSiteEnumeration: false,
    };
  }

  const resolvedRows = results.filter((row) => row.ok);
  const displayConditionsResolved = resolvedRows.length > 0 && resolvedRows.length === results.length &&
    resolvedRows.every((row) => row.displayConditionsResolved === true);
  const targetApplicabilityResolved = normalizedTarget.id !== null && resolvedRows.length > 0 &&
    resolvedRows.length === results.length && resolvedRows.every((row) => row.targetApplicability !== "unknown");

  return {
    ok: true,
    readOnly: true,
    mode: "elementor-impact-evidence",
    targetEntity: normalizedTarget,
    documents: results,
    conditionsSemantics: displayConditionsResolved ? "resolved-known-subset" : "unresolved-or-partial",
    displayConditionsResolved,
    targetApplicabilityResolved,
    observedUrlCoverage: {
      provided: Array.isArray(candidateUrls) ? candidateUrls.length : 0,
      accepted: normalizedCandidates.length,
      inspected: observed.inspected,
      failed: observed.failed,
      completeSiteEnumeration: false,
      note: "Le URL osservate provengono dal set candidato disponibile (per esempio il crawl SeoGrow). Non costituiscono una enumerazione completa del sito.",
    },
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
