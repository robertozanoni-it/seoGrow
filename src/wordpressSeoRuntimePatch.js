const PATCHED = Symbol.for("seogrow.wordpressSeoRuntimePatch");

const requestInfo = (input, init = {}) => {
  const raw = typeof input === "string" ? input : input?.url || "";
  let url;
  try {
    url = new URL(String(raw), window.location.href);
  } catch {
    url = new URL(window.location.href);
    url.pathname = String(raw).split("?")[0];
  }
  return { pathname: url.pathname, method: String(init?.method || "GET").toUpperCase() };
};

if (typeof window !== "undefined" && !window.fetch[PATCHED]) {
  const previousFetch = window.fetch.bind(window);
  const patchedFetch = (input, init = {}) => {
    const info = requestInfo(input, init);
    if (info.method === "POST" && info.pathname === "/api/wordpress/generate-seo-value") {
      return previousFetch("/api/wordpress/generate-seo-value-v2", init);
    }
    return previousFetch(input, init);
  };
  patchedFetch[PATCHED] = true;
  window.fetch = patchedFetch;
}
