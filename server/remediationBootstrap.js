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

await import("./wordpressLiveApprovalHook.js");
await import("./wordpressLiveRollbackHook.js");
await import("./wordpressSeoAdapterHook.js");
await import("./wordpressDraftCopyHook.js");
await import("./wordpressRemediationHook.js");
await import("./frontendVerificationHook.js");
await import("./wordpressPatchV2Hook.js");
