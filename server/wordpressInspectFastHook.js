import dns from "node:dns/promises";
import { inspect as inspectFrontend } from "./frontendVerificationHook.js";
import { isPrivateOrReservedAddress } from "./networkSafety.js";
import { pickExactWordPressEntity } from "./wordpressEntityIdentity.js";
import { resolveSeoPluginOwner } from "../src/seoPluginOwnership.js";

const HOOKED = Symbol.for("seogrow.wordpressInspectFastHook");
const RATE = new Map();
const RANK_MATH_META = ["rank_math_title", "rank_math_description", "rank_math_canonical_url", "rank_math_robots"];
const YOAST_META = ["_yoast_wpseo_title", "_yoast_wpseo_metadesc", "_yoast_wpseo_canonical", "_yoast_wpseo_meta-robots-noindex"];
const SEO_META_CHOICES = {
  title: [["rank_math_title", "Rank Math"], ["_yoast_wpseo_title", "Yoast"]],
  meta_description: [["rank_math_description", "Rank Math"], ["_yoast_wpseo_metadesc", "Yoast"]],
  canonical: [["rank_math_canonical_url", "Rank Math"], ["_yoast_wpseo_canonical", "Yoast"]],
  noindex: [["rank_math_robots", "Rank Math"], ["_yoast_wpseo_meta-robots-noindex", "Yoast"]],
};
const ELEMENTOR_SHARED_TYPES = new Set(["header", "footer", "single", "archive", "popup", "widget"]);

async function safeBase(input) {
  const url = new URL(String(input || ""));
  if (url.protocol !== "https:") throw new Error("WordPress deve usare HTTPS.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (["localhost", "127.0.0.1", "::1"].includes(host) || host.endsWith(".local"))
    throw new Error("Indirizzo WordPress locale non consentito.");
  const addresses = await dns.lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => isPrivateOrReservedAddress(item.address)))
    throw new Error("Indirizzo WordPress non pubblico.");
  url.pathname = `${url.pathname.replace(/\/(?:wp-admin|wp-json)(?:\/.*)?$/i, "").replace(/\/+$/, "")}/`;
  url.search = "";
  url.hash = "";
  return url;
}

function basePath(base) {
  const path = String(base?.pathname || "/").replace(/\/+$/, "");
  return path === "/" ? "" : path;
}

function endpoint(base, resource, suffix = "") {
  return new URL(`${basePath(base)}/wp-json/wp/v2/${resource}${suffix}`, base.origin);
}

function connectorEndpoint(base) {
  return new URL(`${basePath(base)}/wp-json/seogrow/v1/status`, base.origin);
}

function authHeaders(username, password) {
  return {
    authorization: `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`,
    accept: "application/json",
    "content-type": "application/json",
    "user-agent": "seoGrowAI/1.4-wordpress-remediation",
  };
}

async function wpFetch(url, options = {}) {
  const response = await fetch(url, { redirect: "manual", ...options, signal: AbortSignal.timeout(20_000) });
  if ([301, 302, 303, 307, 308].includes(response.status))
    throw new Error("WordPress ha restituito un redirect inatteso.");
  return response;
}

async function json(response) {
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`Risposta WordPress non valida (HTTP ${response.status}).`, { cause: error });
  }
  if (!response.ok) {
    const detail = data?.message || data?.code || `HTTP ${response.status}`;
    throw new Error(`WordPress: ${detail}`);
  }
  return data;
}

async function connectorStatus(base, headers) {
  const response = await wpFetch(connectorEndpoint(base), { headers });
  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  const data = await json(response);
  if (data?.ok !== true || data?.connector !== "SeoGrow Connector") return null;
  const elementorSharedTemplateTypes = Array.isArray(data.elementorSharedTemplateTypes)
    ? [...new Set(data.elementorSharedTemplateTypes
      .map((value) => String(value || "").trim().toLowerCase())
      .filter((value) => ELEMENTOR_SHARED_TYPES.has(value)))]
    : [];
  return {
    connector: String(data.connector),
    version: String(data.version || ""),
    elementor: data.elementor === true,
    elementorPro: data.elementorPro === true,
    elementorSharedTemplateTypes,
    rankMath: data.rankMath === true,
    yoast: data.yoast === true,
  };
}

const normalizeElementorDocuments = (frontend) => {
  const rows = Array.isArray(frontend?.elementorDocuments) ? frontend.elementorDocuments : [];
  const unique = new Map();
  for (const row of rows) {
    const id = Number(row?.id);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    const type = String(row?.type || "unknown").trim().toLowerCase() || "unknown";
    unique.set(`${id}:${type}`, { id, type });
  }
  return [...unique.values()].toSorted((a, b) => a.id - b.id || a.type.localeCompare(b.type));
};

function elementorLocalSourceReferences(entity) {
  const raw = entity?.meta?._elementor_data;
  if (raw === undefined || raw === null || raw === "") return [];
  let data;
  try {
    data = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];

  const references = new Map();
  const stack = [{ items: data, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const { items, depth } = stack.pop();
    if (!Array.isArray(items) || depth > 80) continue;
    for (const item of items) {
      nodes += 1;
      if (nodes > 5000) return [...references.values()];
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const settings = item.settings && typeof item.settings === "object" && !Array.isArray(item.settings)
        ? item.settings
        : {};
      const widgetType = String(item.widgetType || "").trim().toLowerCase();
      const templateId = Number(settings.template_id ?? settings.templateId);
      const globalId = Number(settings.global_widget_id ?? settings.globalWidgetId);
      if (widgetType === "template" && Number.isSafeInteger(templateId) && templateId > 0) {
        references.set(`template:${templateId}`, { id: templateId, type: "template", origin: "local-reference" });
      }
      if ((widgetType === "global" || Number.isSafeInteger(globalId)) && Number.isSafeInteger(globalId) && globalId > 0) {
        references.set(`widget:${globalId}`, { id: globalId, type: "widget", origin: "local-reference" });
      }
      if (Array.isArray(item.elements)) stack.push({ items: item.elements, depth: depth + 1 });
    }
  }
  return [...references.values()].toSorted((a, b) => a.id - b.id || a.type.localeCompare(b.type));
}

function elementorOwnershipEvidence(entity, connector, frontend = null) {
  const siteWideTypes = connector?.elementor === true && Array.isArray(connector.elementorSharedTemplateTypes)
    ? connector.elementorSharedTemplateTypes.filter((value) => ELEMENTOR_SHARED_TYPES.has(value))
    : [];
  const frontendInspected = Boolean(frontend && typeof frontend === "object");
  const renderedDocuments = normalizeElementorDocuments(frontend);
  const localId = Number(entity?.id);
  const hasLocalId = Number.isSafeInteger(localId) && localId > 0;
  const localDocumentRendered = hasLocalId && renderedDocuments.some((document) => document.id === localId);
  const externalRenderedDocuments = renderedDocuments.filter((document) => !hasLocalId || document.id !== localId);
  const localSourceReferences = elementorLocalSourceReferences(entity);

  let status = "not-elementor";
  if (connector?.elementor === true) {
    if (externalRenderedDocuments.length || localSourceReferences.length) status = "rendered-shared-documents";
    else if (frontendInspected && localDocumentRendered) status = "local-document-only-observed";
    else if (frontendInspected && siteWideTypes.length) status = "shared-templates-present-unresolved";
    else if (frontendInspected) status = "no-rendered-shared-document-observed";
    else if (siteWideTypes.length) status = "shared-templates-present-unresolved";
    else status = "frontend-not-inspected";
  }

  return {
    elementorSharedTemplateTypes: siteWideTypes,
    elementorRenderedDocuments: renderedDocuments,
    elementorExternalRenderedDocuments: externalRenderedDocuments,
    elementorLocalSourceReferences: localSourceReferences,
    elementorLocalDocumentRendered: localDocumentRendered,
    elementorFrontendInspected: frontendInspected,
    elementorEvidenceStatus: status,
  };
}

const validRestPath = (value) => {
  const text = String(value || "");
  if (!text || !/^[a-z0-9_./-]+$/i.test(text) || text.includes("\\")) return false;
  const segments = text.split("/");
  return segments.every((segment) => segment && segment !== "." && segment !== "..");
};

function elementorLibraryRestDescriptor(types) {
  const source = types && typeof types === "object" && !Array.isArray(types) ? types : {};
  const row = source.elementor_library || Object.values(source).find((item) => String(item?.slug || "") === "elementor_library");
  if (!row || typeof row !== "object") return null;
  const namespace = String(row.rest_namespace || "wp/v2").replace(/^\/+|\/+$/g, "");
  const restBase = String(row.rest_base || "").replace(/^\/+|\/+$/g, "");
  if (!validRestPath(namespace) || !validRestPath(restBase)) return null;
  return { namespace, restBase };
}

function elementorLibraryEndpoint(base, descriptor, id) {
  const entityId = Number(id);
  if (!Number.isSafeInteger(entityId) || entityId <= 0) throw new Error("ID documento Elementor non valido.");
  if (!descriptor?.namespace || !descriptor?.restBase || !validRestPath(descriptor.namespace) || !validRestPath(descriptor.restBase))
    throw new Error("REST base Elementor Library non disponibile.");
  return new URL(
    `${basePath(base)}/wp-json/${descriptor.namespace}/${descriptor.restBase}/${entityId}?context=edit`,
    base.origin,
  );
}

function mergeElementorSourceCandidates(externalDocuments = [], localReferences = []) {
  const merged = new Map();
  const add = (document, origin) => {
    const id = Number(document?.id);
    if (!Number.isSafeInteger(id) || id <= 0) return;
    const type = String(document?.type || "unknown").trim().toLowerCase() || "unknown";
    const existing = merged.get(id);
    if (!existing) {
      merged.set(id, { id, type, origins: [origin] });
      return;
    }
    if (!existing.origins.includes(origin)) existing.origins.push(origin);
    if (origin === "frontend-rendered" && type !== "unknown") existing.type = type;
  };
  for (const document of externalDocuments) add(document, "frontend-rendered");
  for (const reference of localReferences) add(reference, "local-reference");
  return [...merged.values()].toSorted((a, b) => a.id - b.id || a.type.localeCompare(b.type));
}

async function resolveElementorRenderedSources(base, headers, documents = []) {
  const requested = (Array.isArray(documents) ? documents : [])
    .filter((document) => Number.isSafeInteger(Number(document?.id)) && Number(document.id) > 0)
    .slice(0, 20)
    .map((document) => ({
      id: Number(document.id),
      type: String(document.type || "unknown"),
      origins: Array.isArray(document.origins) ? [...new Set(document.origins.map((value) => String(value)))] : [],
    }));
  if (!requested.length) return { status: "not-needed", documents: [] };

  let descriptor;
  try {
    const types = await json(await wpFetch(endpoint(base, "types"), { headers }));
    descriptor = elementorLibraryRestDescriptor(types);
  } catch (error) {
    return {
      status: "rest-types-unavailable",
      documents: requested.map((document) => ({ ...document, resolved: false, reason: error.message })),
    };
  }
  if (!descriptor) {
    return {
      status: "elementor-library-rest-unavailable",
      documents: requested.map((document) => ({ ...document, resolved: false, reason: "Elementor Library non espone una REST base leggibile." })),
    };
  }

  const resolved = [];
  for (const document of requested) {
    try {
      const entity = await json(await wpFetch(elementorLibraryEndpoint(base, descriptor, document.id), { headers }));
      if (Number(entity?.id) !== document.id) throw new Error("L'ID restituito da WordPress non coincide con il documento Elementor richiesto.");
      resolved.push({
        ...document,
        resolved: true,
        wordpressType: String(entity?.type || "elementor_library"),
        title: String(entity?.title?.raw || entity?.title?.rendered || ""),
        status: String(entity?.status || ""),
        link: String(entity?.link || ""),
      });
    } catch (error) {
      resolved.push({ ...document, resolved: false, reason: error.message });
    }
  }

  const resolvedCount = resolved.filter((document) => document.resolved).length;
  return {
    status: resolvedCount === resolved.length ? "resolved" : resolvedCount ? "partial" : "unresolved",
    documents: resolved,
  };
}

function filterConnectorOwnedMeta(entity, connector, frontend = null) {
  const source = entity && typeof entity === "object" ? entity : {};
  const meta = source.meta && typeof source.meta === "object" && !Array.isArray(source.meta)
    ? { ...source.meta }
    : {};
  if (connector?.elementor !== true) delete meta._elementor_data;
  if (connector?.rankMath !== true) RANK_MATH_META.forEach((key) => delete meta[key]);
  if (connector?.yoast !== true) YOAST_META.forEach((key) => delete meta[key]);

  if (connector?.rankMath === true && connector?.yoast === true) {
    for (const [kind, choices] of Object.entries(SEO_META_CHOICES)) {
      const decision = frontend
        ? resolveSeoPluginOwner({ ...source, meta }, kind, frontend)
        : { owner: null, evidence: "frontend-unavailable" };
      if (decision.owner && decision.evidence === "frontend-value-match") {
        const [ownedKey] = decision.owner;
        for (const [key] of choices) {
          if (key !== ownedKey) delete meta[key];
        }
        continue;
      }

      for (const [key] of choices) {
        if (!Object.prototype.hasOwnProperty.call(meta, key)) meta[key] = null;
      }
    }
  }

  const elementorEvidence = elementorOwnershipEvidence(source, connector, frontend);
  return {
    ...source,
    meta,
    _seogrowOwnership: {
      ...elementorEvidence,
      elementorPro: connector?.elementorPro === true,
    },
  };
}

function rateLimit(req) {
  const now = Date.now();
  const key = req.ip || "local";
  const recent = (RATE.get(key) || []).filter((time) => now - time < 10 * 60_000);
  if (recent.length >= 300) return false;
  recent.push(now);
  RATE.set(key, recent);
  return true;
}

async function resolveEntity(base, headers, requestedUrl) {
  const target = new URL(String(requestedUrl || base.href));
  const pathname = target.pathname.replace(/\/+$/, "") || "/";
  const segments = pathname.split("/").filter(Boolean);
  const slug = decodeURIComponent(segments.at(-1) || "");

  if (!slug) {
    const settings = await json(await wpFetch(endpoint(base, "settings"), { headers }));
    const frontPageId = Number(settings?.page_on_front);
    if (settings?.show_on_front !== "page" || !Number.isSafeInteger(frontPageId) || frontPageId <= 0)
      throw new Error("Homepage WordPress basata sull'archivio articoli: non è un contenuto singolo modificabile automaticamente.");
    const entity = await json(await wpFetch(endpoint(base, "pages", `/${frontPageId}?context=edit`), { headers }));
    return { resource: "pages", entity };
  }

  let candidatesFound = 0;
  for (const resource of ["pages", "posts"]) {
    const url = endpoint(base, resource);
    url.searchParams.set("slug", slug);
    url.searchParams.set("context", "edit");
    url.searchParams.set("per_page", "10");
    const rows = await json(await wpFetch(url, { headers }));
    if (Array.isArray(rows)) candidatesFound += rows.length;
    const match = pickExactWordPressEntity(rows, pathname, target.hostname);
    if (match) return { resource, entity: match };
  }

  if (candidatesFound > 0) {
    throw new Error(
      `WordPress ha restituito ${candidatesFound} contenuti con slug compatibile, ma nessun permalink coincide esattamente con ${target.hostname}${target.pathname}. SeoGrow blocca l'ispezione per evitare di modificare la risorsa sbagliata.`,
    );
  }
  throw new Error(`Nessuna pagina o articolo WordPress trovato per ${target.href}`);
}

function registerRoutes(app) {
  if (app[HOOKED]) return;
  app[HOOKED] = true;

  app.post("/api/wordpress/inspect-fast", async (req, res) => {
    if (!rateLimit(req)) return res.status(429).json({ error: "Limite ispezioni WordPress raggiunto. Riprova più tardi." });
    try {
      const { siteUrl, url, username, applicationPassword } = req.body || {};
      if (!username || !applicationPassword) throw new Error("Inserisci utente e password applicativa WordPress.");
      const target = new URL(String(url || ""));
      if (target.protocol !== "https:") throw new Error("La pagina WordPress deve usare HTTPS.");
      const base = await safeBase(siteUrl || target.origin);
      if (base.hostname.toLowerCase() !== target.hostname.toLowerCase())
        throw new Error("Il sito WordPress collegato e la pagina da correggere appartengono a host diversi.");
      const headers = authHeaders(username, applicationPassword);
      const [resolved, connector] = await Promise.all([
        resolveEntity(base, headers, target.href),
        connectorStatus(base, headers),
      ]);

      let frontend = null;
      const needsFrontendOwnershipEvidence = connector?.elementor === true || (connector?.rankMath === true && connector?.yoast === true);
      if (needsFrontendOwnershipEvidence) {
        try {
          frontend = await inspectFrontend(target.href);
        } catch {
          // L'assenza di prova frontend mantiene Elementor/SEO in stato conservativo e non autorizza scritture ambigue.
        }
      }

      const filteredEntity = filterConnectorOwnedMeta(resolved.entity, connector, frontend);
      const sourceCandidates = mergeElementorSourceCandidates(
        filteredEntity?._seogrowOwnership?.elementorExternalRenderedDocuments,
        filteredEntity?._seogrowOwnership?.elementorLocalSourceReferences,
      );
      const elementorSourceResolution = await resolveElementorRenderedSources(base, headers, sourceCandidates);
      if (filteredEntity?._seogrowOwnership) {
        filteredEntity._seogrowOwnership.elementorSourceResolutionStatus = elementorSourceResolution.status;
        filteredEntity._seogrowOwnership.elementorResolvedSourceDocuments = elementorSourceResolution.documents;
        filteredEntity._seogrowOwnership.elementorResolvedExternalDocuments = elementorSourceResolution.documents.filter(
          (document) => document.origins?.includes("frontend-rendered"),
        );
      }

      const dualSeoPlugins = connector?.rankMath === true && connector?.yoast === true;
      return res.json({
        ok: true,
        fast: true,
        user: { id: 0, name: String(username) },
        resource: resolved.resource,
        entity: filteredEntity,
        connector: connector
          ? {
              ...connector,
              seoOwnershipEvidence: dualSeoPlugins
                ? (frontend ? "frontend-inspected" : "frontend-unavailable")
                : "plugin-availability-only",
              elementorOwnershipEvidence: filteredEntity?._seogrowOwnership?.elementorEvidenceStatus || "not-elementor",
              elementorSourceResolution: elementorSourceResolution.status,
            }
          : null,
      });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Ispezione WordPress non riuscita." });
    }
  });
}

export {
  registerRoutes,
  resolveEntity,
  safeBase,
  connectorStatus,
  filterConnectorOwnedMeta,
  elementorOwnershipEvidence,
  elementorLocalSourceReferences,
  mergeElementorSourceCandidates,
  elementorLibraryRestDescriptor,
  elementorLibraryEndpoint,
  resolveElementorRenderedSources,
  basePath,
};