import { pinnedHttpsFetch } from "./pinnedHttpsFetch.js";

const nativeFetch = globalThis.fetch.bind(globalThis);
if (!globalThis.fetch.__seogrowPinnedRemediation) {
  const guardedFetch = async (input, options = {}) => {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
    let userAgent = "";
    try { userAgent = new Headers(options.headers || input?.headers || {}).get("user-agent") || ""; } catch { userAgent = ""; }
    const needsPinning = /^https:\/\//i.test(String(url || "")) && /seoGrowAI\/1\.4-(?:wordpress-remediation|frontend-verification)/i.test(userAgent);
    if (needsPinning) return pinnedHttpsFetch(url, options);
    return nativeFetch(input, options);
  };
  guardedFetch.__seogrowPinnedRemediation = true;
  globalThis.fetch = guardedFetch;
}

await import("./wordpressRemediationHook.js");
await import("./frontendVerificationHook.js");
