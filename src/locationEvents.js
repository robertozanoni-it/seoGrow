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
