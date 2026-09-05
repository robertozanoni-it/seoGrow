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
  import("./wordpressSeoAdapterV2Hook.js"),
  import("./frontendVerificationHook.js"),
  import("./wordpressInspectFastHook.js"),
  import("./wordpressPatchV2Hook.js"),
]);

const ROUTES_ATTACHED = Symbol.for("seogrow.remediationRoutesAttached");
const USE_PATCHED = Symbol.for("seogrow.remediationBootstrapUsePatched");

export function registerRemediationRoutes(app) {
  if (!app || typeof app.post !== "function") throw new Error("Express app non valida per le route remediation.");
  if (app[ROUTES_ATTACHED]) return;
  app[ROUTES_ATTACHED] = true;

  app.get("/api/wordpress/remediation-capabilities", (_req, res) => {
    res.json({
      ok: true,
      engine: "v2",
      supports: [
        "inspect-fast",
        "frontend-verification",
        "patch-v2",
        "seo-value-v2",
        "live-preview",
        "live-apply",
        "live-rollback",
      ],
      liveMode: "single-explicit-approval",
      draftCopyCompatibility: false,
    });
  });

  for (const module of remediationModules) {
    if (typeof module.registerRoutes === "function") module.registerRoutes(app);
  }
}

export const explicitRemediationRouteModules = remediationModules
  .filter((module) => typeof module.registerRoutes === "function")
  .length;

// Compatibilità temporanea con NODE_OPTIONS --import: una sola intercettazione
// centralizzata monta le route appena prima del fallback app.use("/api", ...).
// I singoli hook non modificano più express.application.
const originalUse = express.application.use;
if (!originalUse[USE_PATCHED]) {
  const patchedUse = function (...args) {
    if (!this[ROUTES_ATTACHED] && args[0] === "/api") registerRemediationRoutes(this);
    return originalUse.apply(this, args);
  };
  patchedUse[USE_PATCHED] = true;
  express.application.use = patchedUse;
}
