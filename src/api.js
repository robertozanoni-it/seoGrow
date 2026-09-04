const SELECTED_CLIENT_KEY = "seogrow-selected-client-v1";
const scopedRequests = new Set();

const selectedClientId = () => {
  try {
    const value = JSON.parse(localStorage.getItem(SELECTED_CLIENT_KEY));
    return Number.isSafeInteger(Number(value)) ? Number(value) : null;
  } catch {
    return null;
  }
};

const isPaidOrLongRunningRequest = (input) => {
  const value = String(input || "");
  return [
    "/api/dataforseo/",
    "/api/geo/simulate",
    "/api/generate",
    "/api/wordpress/generate-patch",
  ].some((path) => value.includes(path));
};

if (typeof window !== "undefined" && !window.__seogrowProjectAbortInstalled) {
  window.__seogrowProjectAbortInstalled = true;
  window.addEventListener("seogrow-storage-ok", (event) => {
    if (event?.detail?.key !== SELECTED_CLIENT_KEY) return;
    const current = selectedClientId();
    for (const entry of [...scopedRequests]) {
      if (entry.clientId != null && current != null && entry.clientId !== current) {
        entry.controller.abort(new DOMException("Progetto cambiato", "AbortError"));
      }
    }
  });
}

const trimGenerateContext = (body) => {
  if (typeof body !== "string") return body;
  try {
    const payload = JSON.parse(body);
    if (!payload || typeof payload !== "object" || typeof payload.context !== "string") return body;
    const maxContext = 10_500;
    if (payload.context.length <= maxContext) return body;
    const headLength = 8_500;
    const tailLength = 1_500;
    payload.context = `${payload.context.slice(0, headLength)}\n\n[...contenuto ridotto automaticamente da SeoGrow per rispettare il limite AI...]\n\n${payload.context.slice(-tailLength)}`;
    return JSON.stringify(payload);
  } catch {
    return body;
  }
};

const wordpressPaginationSkip = (input, init) => {
  const inputText = String(input || "");
  if (!inputText.includes("/api/wordpress/inspect") || String(init?.method || "GET").toUpperCase() !== "POST") return null;
  if (typeof init?.body !== "string") return null;
  try {
    const payload = JSON.parse(init.body);
    const target = new URL(String(payload?.url || ""));
    const path = target.pathname.replace(/\/+$/, "");
    const segments = path.split("/").filter(Boolean);
    const last = segments.at(-1) || "";
    const previous = segments.at(-2) || "";
    const isPagination = /^\d+$/.test(last) && segments.length >= 2;
    const isPagePagination = previous.toLowerCase() === "page" && /^\d+$/.test(last);
    if (!isPagination && !isPagePagination) return null;
    return new Response(
      JSON.stringify({
        error: "Archivio/paginazione WordPress rilevata: SeoGrow salta automaticamente questa URL perché non è una pagina o un articolo modificabile tramite REST.",
        skipped: true,
      }),
      { status: 422, headers: { "content-type": "application/json" } },
    );
  } catch {
    return null;
  }
};

export async function apiFetch(input, init = {}) {
  const method = String(init.method || "GET").toUpperCase();
  const attempts = method === "GET" ? 2 : 1;
  let lastError;
  const inputText = String(input || "");
  const skipped = wordpressPaginationSkip(input, init);
  if (skipped) return skipped;
  const preparedInit = inputText.includes("/api/generate")
    ? { ...init, body: trimGenerateContext(init.body) }
    : init;
  const projectScoped = isPaidOrLongRunningRequest(inputText);
  const projectController = projectScoped ? new AbortController() : null;
  const scopeEntry = projectController
    ? { controller: projectController, clientId: selectedClientId() }
    : null;
  if (scopeEntry) scopedRequests.add(scopeEntry);

  try {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timeoutMs = inputText.includes("/api/dataforseo/")
        ? 960_000
        : inputText.includes("/api/site-analysis")
          ? 210_000
          : 120_000;
      const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
      const signals = [controller.signal];
      if (preparedInit.signal) signals.push(preparedInit.signal);
      if (projectController) signals.push(projectController.signal);
      const signal = (() => {
        if (signals.length === 1) return signals[0];
        if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
        const combined = new AbortController();
        const abort = (event) => combined.abort(event?.target?.reason);
        for (const item of signals) item.addEventListener("abort", abort, { once: true });
        return combined.signal;
      })();
      try {
        const response = await window.fetch(input, { ...preparedInit, signal });
        if (attempt + 1 < attempts && [502, 503, 504].includes(response.status)) {
          await response.body?.cancel();
          await new Promise((resolve) => window.setTimeout(resolve, 250));
          continue;
        }
        return response;
      } catch (error) {
        lastError = error;
        if (attempt + 1 >= attempts)
          throw new Error(
            error.name === "AbortError"
              ? projectController?.signal.aborted
                ? "Richiesta annullata perché hai cambiato progetto."
                : preparedInit.signal?.aborted
                  ? "Richiesta annullata."
                  : "La richiesta ha superato il tempo massimo. Riprova."
              : error.message,
            { cause: error },
          );
      } finally {
        window.clearTimeout(timeout);
      }
    }
    throw lastError;
  } finally {
    if (scopeEntry) scopedRequests.delete(scopeEntry);
  }
}
