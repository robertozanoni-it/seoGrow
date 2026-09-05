import express from "express";
import { pinnedHttpsFetch } from "./pinnedHttpsFetch.js";

const nativeFetch = globalThis.fetch.bind(globalThis);
const requestUserAgent = (input, options) => {
  try {
    return new Headers(options.headers || input?.headers || {}).get("user-agent") || "";
  } catch {
    return "";
  }
};

if (!globalThis.fetch.__seogrowPinnedRemediation) {
  const guardedFetch = async (input, options = {}) => {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
    const userAgent = requestUserAgent(input, options);
    const needsPinning = /^https:\/\//i.test(String(url || "")) && /seoGrowAI\/1\.4-(?:wordpress-remediation|frontend-verification)/i.test(userAgent);
    if (needsPinning) return pinnedHttpsFetch(url, options);
    return nativeFetch(input, options);
  };
  guardedFetch.__seogrowPinnedRemediation = true;
  globalThis.fetch = guardedFetch;
}

const remediationModules = await Promise.all([
  import("./wordpressLiveApprovalHook.js"),
  import("./wordpressLiveRollbackHook.js"),
  import("./wordpressSeoAdapterHook.js"),
  import("./wordpressSeoAdapterV2Hook.js"),
  import("./wordpressDraftCopyHook.js"),
  import("./wordpressRemediationHook.js"),
  import("./frontendVerificationHook.js"),
  import("./wordpressInspectFastHook.js"),
  import("./wordpressPatchV2Hook.js"),
]);

const ROUTES_ATTACHED = Symbol.for("seogrow.remediationRoutesAttached");
const USE_PATCHED = Symbol.for("seogrow.remediationBootstrapUsePatched");
const LISTEN_PATCHED = Symbol.for("seogrow.remediationBootstrapListenPatched");

export function registerRemediationRoutes(app) {
  if (!app || typeof app.post !== "function") throw new Error("Express app non valida per le route remediation.");
  if (app[ROUTES_ATTACHED]) return;
  app[ROUTES_ATTACHED] = true;
  for (const module of remediationModules) {
    if (typeof module.registerRoutes === "function") module.registerRoutes(app);
  }
}

export const explicitRemediationRouteModules = remediationModules
  .filter((module) => typeof module.registerRoutes === "function")
  .length;

// Compatibilità temporanea con l'avvio tramite NODE_OPTIONS --import.
// Una sola intercettazione centralizzata sostituisce progressivamente le patch
// duplicate presenti nei singoli hook. Le route vengono montate prima del
// fallback /api oppure, come rete di sicurezza, immediatamente prima di listen().
const originalUse = express.application.use;
if (!originalUse[USE_PATCHED]) {
  const patchedUse = function (...args) {
    if (!this[ROUTES_ATTACHED] && args[0] === "/api") registerRemediationRoutes(this);
    return originalUse.apply(this, args);
  };
  patchedUse[USE_PATCHED] = true;
  express.application.use = patchedUse;
}

const originalListen = express.application.listen;
if (!originalListen[LISTEN_PATCHED]) {
  const patchedListen = function (...args) {
    registerRemediationRoutes(this);
    return originalListen.apply(this, args);
  };
  patchedListen[LISTEN_PATCHED] = true;
  express.application.listen = patchedListen;
}
