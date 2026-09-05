import crypto from "node:crypto";
import dns from "node:dns/promises";
import { inspect as inspectFrontend } from "./frontendVerificationHook.js";
import { isPrivateOrReservedAddress } from "./networkSafety.js";

const HOOKED = Symbol.for("seogrow.wordpressTaxonomyHook");
const RATE = new Map();
const APPROVALS = new Map();
const TTL_MS = 15 * 60_000;
const ALLOWED_TAXONOMIES = new Set(["category", "post_tag"]);
const ALLOWED_FIELDS = new Set(["title", "meta_description", "canonical", "noindex"]);

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
  const pathname = String(base?.pathname || "/").replace(/\/+$/, "");
  return pathname === "/" ? "" : pathname;
}

function connectorEndpoint(base, path, targetUrl = "") {
  const endpoint = new URL(`${basePath(base)}/wp-json/seogrow/v1/${path}`, base.origin);
  if (targetUrl) endpoint.searchParams.set("url", targetUrl);
  return endpoint;
}

function authHeaders(username, password, includeJson = false) {
  return {
    authorization: `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`,
    accept: "application/json",
    ...(includeJson ? { "content-type": "application/json" } : {}),
    "user-agent": "seoGrowAI/1.4-wordpress-remediation",
  };
}

function normalizedIdentity(value) {
  try {
    const url = new URL(String(value || ""));
    return {
      host: url.hostname.toLowerCase(),
      path: decodeURIComponent(url.pathname).replace(/\/+$/, "") || "/",
    };
  } catch {
    return { host: "", path: "" };
  }
}

function normalizeComparableText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeFieldValue(field, value) {
  if (field === "noindex") return value === true || value === "true" || value === 1 || value === "1";
  return normalizeComparableText(value);
}

function sameFieldValue(field, left, right) {
  return normalizeFieldValue(field, left) === normalizeFieldValue(field, right);
}

export function normalizeTaxonomyInspection(data, requestedUrl) {
  if (!data || data.ok !== true || data.readOnly !== true || data.resource !== "taxonomy")
    throw new Error("Il Connector non ha restituito un'ispezione tassonomia read-only valida.");

  const term = data.term && typeof data.term === "object" ? data.term : {};
  const id = Number(term.id);
  const taxonomy = String(term.taxonomy || "");
  if (!Number.isSafeInteger(id) || id <= 0 || !ALLOWED_TAXONOMIES.has(taxonomy))
    throw new Error("Identità tassonomia restituita dal Connector non valida.");

  const requested = normalizedIdentity(requestedUrl);
  const linked = normalizedIdentity(term.link);
  if (!requested.host || !linked.host || requested.host !== linked.host || requested.path !== linked.path)
    throw new Error("La tassonomia restituita non coincide esattamente con la URL richiesta.");

  const plugins = {
    rankMath: data.plugins?.rankMath === true,
    yoast: data.plugins?.yoast === true,
  };
  const ownership = plugins.rankMath && plugins.yoast
    ? "ambiguous"
    : plugins.rankMath
      ? "rank-math-only"
      : plugins.yoast
        ? "yoast-only"
        : "none";

  return {
    ok: true,
    readOnly: true,
    resource: "taxonomy",
    term: {
      id,
      taxonomy,
      slug: String(term.slug || ""),
      name: String(term.name || ""),
      description: String(term.description || ""),
      link: String(term.link || ""),
    },
    seo: {
      rankMath: data.seo?.rankMath && typeof data.seo.rankMath === "object" ? data.seo.rankMath : null,
      yoast: data.seo?.yoast && typeof data.seo.yoast === "object" ? data.seo.yoast : null,
    },
    plugins,
    ownership,
    writable: ownership === "rank-math-only" || ownership === "yoast-only",
    nextStep: ownership === "ambiguous"
      ? "Rank Math e Yoast risultano entrambi attivi: nessuna scrittura automatica è consentita."
      : ownership === "none"
        ? "Nessun adapter SEO tassonomia supportato rilevato."
        : "Ownership univoca: è possibile preparare una singola anteprima stale-safe con approvazione esplicita.",
  };
}

export function taxonomyAdapter(inspection) {
  if (inspection?.ownership === "rank-math-only") return "rank-math";
  if (inspection?.ownership === "yoast-only") return "yoast";
  return "";
}

export function taxonomyCurrentValue(inspection, field, adapter = taxonomyAdapter(inspection)) {
  if (!ALLOWED_FIELDS.has(field)) throw new Error("Campo tassonomia non supportato.");
  const source = adapter === "rank-math" ? inspection?.seo?.rankMath : adapter === "yoast" ? inspection?.seo?.yoast : null;
  if (!source || typeof source !== "object") throw new Error("Valore SEO tassonomia non disponibile per l'adapter selezionato.");
  return normalizeFieldValue(field, source[field]);
}

export function validateTaxonomyChange({ field, value, targetUrl, intent = {}, mode = "apply" }) {
  if (!ALLOWED_FIELDS.has(field)) throw new Error("Campo tassonomia non supportato.");
  const next = normalizeFieldValue(field, value);
  if (["title", "meta_description"].includes(field) && !next)
    throw new Error("Title e meta description non possono essere vuoti.");

  if (field === "canonical") {
    if (next) {
      let canonical;
      let target;
      try {
        canonical = new URL(next);
        target = new URL(String(targetUrl || ""));
      } catch {
        throw new Error("Canonical tassonomia non valida.");
      }
      if (canonical.protocol !== "https:" || canonical.hostname.toLowerCase() !== target.hostname.toLowerCase())
        throw new Error("La canonical automatica deve essere HTTPS e appartenere allo stesso host della tassonomia.");
    }
    if (mode !== "rollback" && (intent?.canonicalTargetConfirmed !== true || normalizeComparableText(intent?.canonicalTarget) !== next))
      throw new Error("Intento canonical non confermato: specifica e conferma esplicitamente la destinazione prima dell'anteprima.");
  }

  if (field === "noindex" && mode !== "rollback") {
    const requestedIntent = next ? "noindex" : "index";
    if (String(intent?.indexingIntent || "") !== requestedIntent)
      throw new Error(`Intento di indicizzazione non confermato: è richiesta la conferma esplicita "${requestedIntent}".`);
  }

  return next;
}

function rateLimit(req) {
  const now = Date.now();
  const key = req.ip || "local";
  const recent = (RATE.get(key) || []).filter((time) => now - time < 10 * 60_000);
  if (recent.length >= 120) return false;
  recent.push(now);
  RATE.set(key, recent);
  return true;
}

function cleanupApprovals() {
  const now = Date.now();
  for (const [token, approval] of APPROVALS.entries()) {
    if (now - approval.createdAt > TTL_MS) APPROVALS.delete(token);
  }
}

async function connectorJson(response) {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024)
    throw new Error("Risposta taxonomy del Connector troppo grande.");
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Risposta taxonomy del Connector non valida (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    if (response.status === 404)
      throw new Error("SeoGrow Connector 1.3.0 o superiore è necessario per la remediation di categorie e tag.");
    const error = new Error(data?.message || data?.error || data?.code || `WordPress HTTP ${response.status}`);
    error.code = data?.code || `HTTP_${response.status}`;
    error.status = response.status;
    throw error;
  }
  return data;
}

async function inspectTaxonomyConnector({ siteUrl, targetUrl, username, applicationPassword }) {
  const base = await safeBase(siteUrl || new URL(targetUrl).origin);
  const response = await fetch(connectorEndpoint(base, "taxonomy-inspect", targetUrl), {
    method: "GET",
    headers: authHeaders(username, applicationPassword),
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    await response.body?.cancel();
    throw new Error("WordPress ha restituito un redirect inatteso durante l'ispezione tassonomia.");
  }
  return normalizeTaxonomyInspection(await connectorJson(response), targetUrl);
}

async function writeTaxonomyConnector({ siteUrl, targetUrl, username, applicationPassword, termId, taxonomy, adapter, field, expectedCurrent, value }) {
  const base = await safeBase(siteUrl || new URL(targetUrl).origin);
  const response = await fetch(connectorEndpoint(base, "taxonomy-write"), {
    method: "POST",
    headers: authHeaders(username, applicationPassword, true),
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      url: targetUrl,
      termId,
      taxonomy,
      adapter,
      field,
      expectedCurrent,
      value,
    }),
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    await response.body?.cancel();
    throw new Error("WordPress ha restituito un redirect inatteso durante la scrittura tassonomia.");
  }
  return connectorJson(response);
}

export function taxonomyPublicVerification(field, expected, frontend) {
  const stored = normalizeFieldValue(field, expected);
  if (!frontend?.ok || frontend?.isHtml !== true) return { verified: false, reason: "Il frontend pubblico non restituisce HTML verificabile." };

  if (field === "title") {
    if (/%[^%]+%/.test(String(expected || "")))
      return { verified: false, reason: "Il title contiene variabili template: serve verifica manuale o nuovo audit del valore renderizzato." };
    return normalizeComparableText(frontend.title) === stored
      ? { verified: true, reason: "Title pubblico coerente con il valore applicato." }
      : { verified: false, reason: "Il title pubblico non coincide con il valore applicato." };
  }
  if (field === "meta_description") {
    if (/%[^%]+%/.test(String(expected || "")))
      return { verified: false, reason: "La meta description contiene variabili template: serve verifica del valore renderizzato." };
    return normalizeComparableText(frontend.metaDescription) === stored
      ? { verified: true, reason: "Meta description pubblica coerente con il valore applicato." }
      : { verified: false, reason: "La meta description pubblica non coincide con il valore applicato." };
  }
  if (field === "canonical") {
    if (!stored) return { verified: false, reason: "Canonical plugin vuota: il valore pubblico non può essere attribuito con certezza alla modifica." };
    try {
      const expectedUrl = new URL(stored);
      const publicUrl = new URL(String(frontend.canonical || ""), frontend.url || stored);
      const same = expectedUrl.href.replace(/\/$/, "") === publicUrl.href.replace(/\/$/, "");
      return same
        ? { verified: true, reason: "Canonical pubblica coerente con il valore applicato." }
        : { verified: false, reason: "La canonical pubblica non coincide con il valore applicato." };
    } catch {
      return { verified: false, reason: "Canonical pubblica non verificabile." };
    }
  }
  if (field === "noindex") {
    return Boolean(frontend.noindex) === Boolean(stored)
      ? { verified: true, reason: "Direttiva di indicizzazione pubblica coerente con il valore applicato." }
      : { verified: false, reason: "La direttiva di indicizzazione pubblica non coincide con il valore applicato." };
  }
  return { verified: false, reason: "Campo non verificabile." };
}

function routeError(res, error, fallback) {
  const status = Number(error?.status);
  return res.status(Number.isSafeInteger(status) && status >= 400 && status < 600 ? status : 400).json({
    error: error instanceof Error ? error.message : fallback,
    code: String(error?.code || ""),
  });
}

function registerRoutes(app) {
  if (app[HOOKED]) return;
  app[HOOKED] = true;

  app.post("/api/wordpress/inspect-taxonomy", async (req, res) => {
    if (!rateLimit(req)) return res.status(429).json({ error: "Limite ispezioni tassonomie raggiunto. Riprova più tardi." });
    try {
      const { siteUrl, url, username, applicationPassword } = req.body || {};
      if (!username || !applicationPassword) throw new Error("Inserisci utente e password applicativa WordPress.");
      const targetUrl = new URL(String(url || ""));
      if (targetUrl.protocol !== "https:") throw new Error("La tassonomia WordPress deve usare HTTPS.");
      targetUrl.hash = "";
      return res.json(await inspectTaxonomyConnector({ siteUrl, targetUrl: targetUrl.href, username, applicationPassword }));
    } catch (error) {
      return routeError(res, error, "Ispezione tassonomia non riuscita.");
    }
  });

  app.post("/api/wordpress/taxonomy-preview", async (req, res) => {
    if (!rateLimit(req)) return res.status(429).json({ error: "Limite anteprime tassonomie raggiunto. Riprova più tardi." });
    cleanupApprovals();
    try {
      const { siteUrl, url, username, applicationPassword, field, value, intent = {}, mode = "apply", expectedCurrent } = req.body || {};
      if (!username || !applicationPassword) throw new Error("Inserisci utente e password applicativa WordPress.");
      if (!["apply", "rollback"].includes(mode)) throw new Error("Modalità tassonomia non valida.");
      const targetUrl = new URL(String(url || ""));
      if (targetUrl.protocol !== "https:") throw new Error("La tassonomia WordPress deve usare HTTPS.");
      targetUrl.hash = "";

      const inspection = await inspectTaxonomyConnector({ siteUrl, targetUrl: targetUrl.href, username, applicationPassword });
      const adapter = taxonomyAdapter(inspection);
      if (!adapter || inspection.writable !== true)
        throw new Error(inspection.nextStep || "Ownership SEO tassonomia non determinabile.");
      const current = taxonomyCurrentValue(inspection, field, adapter);
      if (mode === "rollback" && !sameFieldValue(field, current, expectedCurrent)) {
        const error = new Error("Rollback tassonomia bloccato: il valore corrente non coincide con lo stato atteso dopo la correzione.");
        error.code = "STALE_ROLLBACK";
        error.status = 409;
        throw error;
      }
      const next = validateTaxonomyChange({ field, value, targetUrl: targetUrl.href, intent, mode });
      if (sameFieldValue(field, current, next)) throw new Error("La proposta coincide con il valore tassonomia corrente.");

      const token = crypto.randomUUID();
      APPROVALS.set(token, {
        createdAt: Date.now(),
        siteUrl: String(siteUrl || targetUrl.origin),
        targetUrl: targetUrl.href,
        termId: inspection.term.id,
        taxonomy: inspection.term.taxonomy,
        adapter,
        field,
        before: current,
        after: next,
        mode,
      });

      return res.json({
        ok: true,
        approvalToken: token,
        expiresInSeconds: Math.floor(TTL_MS / 1000),
        resource: "taxonomy",
        term: inspection.term,
        adapter,
        field,
        mode,
        previewBefore: current,
        previewAfter: next,
        changed: [field],
        message: mode === "rollback"
          ? "Anteprima rollback tassonomia pronta. Nessuna modifica è stata ancora applicata."
          : "Anteprima tassonomia pronta. Nessuna modifica è stata ancora applicata.",
      });
    } catch (error) {
      return routeError(res, error, "Anteprima tassonomia non riuscita.");
    }
  });

  app.post("/api/wordpress/taxonomy-apply", async (req, res) => {
    if (!rateLimit(req)) return res.status(429).json({ error: "Limite scritture tassonomie raggiunto. Riprova più tardi." });
    cleanupApprovals();
    try {
      const { approvalToken, username, applicationPassword } = req.body || {};
      if (!username || !applicationPassword) throw new Error("Inserisci utente e password applicativa WordPress.");
      const token = String(approvalToken || "");
      const approval = APPROVALS.get(token);
      if (!approval) {
        const error = new Error("Anteprima tassonomia scaduta, sostituita o già utilizzata. Rigenera l'anteprima.");
        error.code = "APPROVAL_EXPIRED";
        error.status = 409;
        throw error;
      }
      APPROVALS.delete(token);

      const result = await writeTaxonomyConnector({
        siteUrl: approval.siteUrl,
        targetUrl: approval.targetUrl,
        username,
        applicationPassword,
        termId: approval.termId,
        taxonomy: approval.taxonomy,
        adapter: approval.adapter,
        field: approval.field,
        expectedCurrent: approval.before,
        value: approval.after,
      });
      if (result?.ok !== true || result?.staleChecked !== true || result?.singleField !== true)
        throw new Error("Il Connector non ha confermato stale-check e scrittura single-field. Nessun successo viene dichiarato.");
      if (!sameFieldValue(approval.field, result.before, approval.before) || !sameFieldValue(approval.field, result.after, approval.after))
        throw new Error("La risposta WordPress non coincide con l'anteprima approvata. Verifica manuale necessaria.");

      return res.json({
        ...result,
        mode: approval.mode,
        sourceUrl: approval.targetUrl,
        verificationRequired: true,
        message: approval.mode === "rollback"
          ? "Rollback tassonomia applicato con stale-check. Stato: da verificare."
          : "Modifica tassonomia applicata con stale-check. Stato: da verificare.",
      });
    } catch (error) {
      return routeError(res, error, "Applicazione tassonomia non riuscita.");
    }
  });

  app.post("/api/wordpress/taxonomy-verify", async (req, res) => {
    if (!rateLimit(req)) return res.status(429).json({ error: "Limite verifiche tassonomie raggiunto. Riprova più tardi." });
    try {
      const { siteUrl, url, username, applicationPassword, adapter, field, expected } = req.body || {};
      if (!username || !applicationPassword) throw new Error("Inserisci utente e password applicativa WordPress.");
      if (!ALLOWED_FIELDS.has(field)) throw new Error("Campo tassonomia non supportato.");
      const targetUrl = new URL(String(url || ""));
      const inspection = await inspectTaxonomyConnector({ siteUrl, targetUrl: targetUrl.href, username, applicationPassword });
      const currentAdapter = taxonomyAdapter(inspection);
      if (!currentAdapter || currentAdapter !== adapter) {
        return res.json({ ok: true, verified: false, storedMatch: false, publicMatch: false, reason: "Ownership/plugin SEO cambiato dopo la correzione." });
      }
      const current = taxonomyCurrentValue(inspection, field, currentAdapter);
      const storedMatch = sameFieldValue(field, current, expected);
      if (!storedMatch) {
        return res.json({ ok: true, verified: false, storedMatch: false, publicMatch: false, current, reason: "Il valore salvato non coincide più con la correzione attesa." });
      }
      const frontend = await inspectFrontend(targetUrl.href);
      const publicCheck = taxonomyPublicVerification(field, expected, frontend);
      return res.json({
        ok: true,
        verified: storedMatch && publicCheck.verified,
        storedMatch,
        publicMatch: publicCheck.verified,
        current,
        frontend: {
          url: frontend.url,
          title: frontend.title,
          metaDescription: frontend.metaDescription,
          canonical: frontend.canonical,
          noindex: frontend.noindex,
        },
        reason: publicCheck.reason,
      });
    } catch (error) {
      return routeError(res, error, "Verifica tassonomia non riuscita.");
    }
  });
}

export {
  registerRoutes,
  safeBase,
  basePath,
  connectorEndpoint,
  normalizedIdentity,
  normalizeFieldValue,
  sameFieldValue,
};
