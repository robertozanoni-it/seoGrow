import { evaluateElementorCoverageProof } from "./elementorCoverageProof.js";
import { resolveElementorCoverageAttestation } from "./elementorCoverageRegistry.js";

const TARGET_ROUTE = "/api/wordpress/elementor-impact-inspect";

const candidateCount = (body) => Array.isArray(body?.candidateUrls) ? body.candidateUrls.length : 0;

export function finalizeElementorImpactCoverage(payload, requestBody = {}) {
  if (!payload || typeof payload !== "object" || payload.ok !== true) return payload;

  const coverage = payload.observedUrlCoverage && typeof payload.observedUrlCoverage === "object"
    ? payload.observedUrlCoverage
    : {};
  const proof = requestBody?.coverageProof && typeof requestBody.coverageProof === "object"
    ? requestBody.coverageProof
    : {};
  const serverAttestation = resolveElementorCoverageAttestation({
    provenanceId: proof?.provenanceId,
    siteUrl: requestBody?.siteUrl,
  });
  const evaluated = evaluateElementorCoverageProof({
    proof,
    serverAttestation,
    provided: candidateCount(requestBody),
    accepted: coverage.accepted,
    inspected: coverage.inspected,
    failed: coverage.failed,
  });

  const displayConditionsResolved = payload.displayConditionsResolved === true;
  const affectedPagesEnumerated = evaluated.completeSiteEnumeration === true && displayConditionsResolved;
  const documents = Array.isArray(payload.documents)
    ? payload.documents.map((document) => {
        if (!document || typeof document !== "object") return document;
        const documentEnumerated = affectedPagesEnumerated &&
          document.ok === true &&
          document.displayConditionsResolved === true;
        return {
          ...document,
          observedCandidateCoverage: {
            ...(document.observedCandidateCoverage && typeof document.observedCandidateCoverage === "object"
              ? document.observedCandidateCoverage
              : {}),
            completeSiteEnumeration: evaluated.completeSiteEnumeration,
            coverageStatus: evaluated.status,
            provenanceId: evaluated.serverAttestation?.provenanceId || "",
          },
          affectedPagesEnumerated: documentEnumerated,
          sharedWriteAllowed: false,
        };
      })
    : [];

  return {
    ...payload,
    documents,
    observedUrlCoverage: {
      ...coverage,
      coverageStatus: evaluated.status,
      coverageReason: evaluated.reason,
      coverageSource: evaluated.source,
      provenanceId: evaluated.serverAttestation?.provenanceId || "",
      serverVerified: evaluated.serverVerified,
      provenanceMatches: evaluated.provenanceMatches,
      completeSiteEnumeration: evaluated.completeSiteEnumeration,
    },
    affectedPagesEnumerated,
    sharedWriteAllowed: false,
  };
}

export function registerElementorImpactRoutesWithCoverage(app, elementorImpactModule) {
  if (!app || typeof app.post !== "function") throw new Error("Express app non valida per Elementor coverage decorator.");
  if (!elementorImpactModule || typeof elementorImpactModule.registerRoutes !== "function") {
    throw new Error("Modulo Elementor impact non valido.");
  }

  const originalPost = app.post.bind(app);
  app.post = (path, ...handlers) => {
    if (path !== TARGET_ROUTE) return originalPost(path, ...handlers);
    const wrapped = handlers.map((handler) => {
      if (typeof handler !== "function") return handler;
      return async function elementorCoverageWrappedHandler(req, res, next) {
        const originalJson = res.json.bind(res);
        res.json = (payload) => originalJson(finalizeElementorImpactCoverage(payload, req?.body || {}));
        return handler(req, res, next);
      };
    });
    return originalPost(path, ...wrapped);
  };

  try {
    elementorImpactModule.registerRoutes(app);
  } finally {
    app.post = originalPost;
  }
}

export { TARGET_ROUTE as ELEMENTOR_IMPACT_ROUTE };
