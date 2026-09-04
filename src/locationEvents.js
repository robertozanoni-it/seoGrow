// React navigation in seoGrow updates the hash with history.pushState().
// Browsers do not emit hashchange for pushState, so components mounted outside
// App (Audit workspace/remediation) would occasionally miss navigation changes.
// Emit one location-change signal only when the URL really changes.
const patchHistoryMethod = (methodName) => {
  const original = window.history[methodName];
  if (typeof original !== "function" || original.__seogrowPatched) return;

  const patched = function patchedHistoryMethod(...args) {
    const oldURL = window.location.href;
    const result = original.apply(this, args);
    const newURL = window.location.href;
    if (newURL !== oldURL) {
      window.dispatchEvent(
        new HashChangeEvent("hashchange", { oldURL, newURL }),
      );
      window.dispatchEvent(new Event("seogrow-locationchange"));
    }
    return result;
  };

  patched.__seogrowPatched = true;
  window.history[methodName] = patched;
};

patchHistoryMethod("pushState");
patchHistoryMethod("replaceState");

// La remediation WordPress necessita di output JSON deterministico. L'endpoint
// generico /api/generate produce contenuti editoriali Markdown e non garantisce
// uno schema. Reindirizza solo le richieste di remediation WordPress al relativo
// endpoint strutturato, lasciando invariati tutti gli altri usi dell'API AI.
const originalFetch = window.fetch.bind(window);
if (!window.fetch.__seogrowRemediationPatched) {
  const patchedFetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url;
    if (url === "/api/generate" && String(init?.method || "GET").toUpperCase() === "POST") {
      try {
        const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
        if (/^Remediation WordPress\s+(?:title|content|excerpt|h1)$/i.test(String(body?.topic || ""))) {
          return originalFetch("/api/wordpress/generate-patch", init);
        }
      } catch {
        // Se il body non è JSON valido, lascia che l'endpoint originale gestisca l'errore.
      }
    }
    return originalFetch(input, init);
  };
  patchedFetch.__seogrowRemediationPatched = true;
  window.fetch = patchedFetch;
}
