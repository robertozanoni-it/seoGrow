import { pinnedHttpsFetch } from "./pinnedHttpsFetch.js";
import { registerElementorImpactRoutesWithCoverage } from "./elementorCoverageRouteDecorator.js";

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
  import("./wordpressConnectionHook.js"),
  import("./wordpressLiveApprovalHook.js"),
  import("./wordpressLiveRollbackHook.js"),
  import("./wordpressSeoAdapterV2Hook.js"),
  import("./frontendVerificationHook.js"),
  import("./wordpressInspectFastHook.js"),
  import("./elementorImpactHook.js"),
  import("./wordpressTaxonomyHook.js"),
  import("./wordpressPatchV2Hook.js"),
]);

const ELEMENTOR_IMPACT_MODULE_INDEX = 6;
const ROUTES_ATTACHED = Symbol.for("seogrow.remediationRoutesAttached");

export function registerRemediationRoutes(app) {
  if (!app || typeof app.post !== "function") throw new Error("Express app non valida per le route remediation.");
  if (app[ROUTES_ATTACHED]) return;
  app[ROUTES_ATTACHED] = true;

  app.get("/api/wordpress/remediation-capabilities", (_req, res) => {
    res.json({
      ok: true,
      engine: "v2",
      supports: [
        "connection-check",
        "inspect",
        "inspect-fast",
        "inspect-taxonomy",
        "elementor-impact-read-only",
        "elementor-impact-server-attested-coverage",
        "taxonomy-preview",
        "taxonomy-apply",
        "taxonomy-rollback-preview",
        "taxonomy-verify",
        "frontend-verification",
        "patch-v2",
        "seo-value-v2",
        "live-preview",
        "live-apply",
        "live-rollback",
      ],
      liveMode: "single-explicit-approval",
      taxonomyMode: "single-field-explicit-approval-stale-safe",
      elementorImpactMode: "read-only-server-attested-coverage-no-shared-write",
      taxonomyConnectorMinimum: "1.3.0",
      draftCopyCompatibility: false,
    });
  });

  for (const [index, module] of remediationModules.entries()) {
    if (typeof module.registerRoutes !== "function") continue;
    if (index === ELEMENTOR_IMPACT_MODULE_INDEX) {
      registerElementorImpactRoutesWithCoverage(app, module);
      continue;
    }
    module.registerRoutes(app);
  }
}

export const explicitRemediationRouteModules = remediationModules
  .filter((module) => typeof module.registerRoutes === "function")
  .length;
