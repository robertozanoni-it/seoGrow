export async function apiFetch(input, init = {}) {
  const method = String(init.method || "GET").toUpperCase();
  const attempts = method === "GET" ? 2 : 1;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const inputText = String(input || "");
    const timeoutMs = inputText.includes("/api/dataforseo/")
      ? 960_000
      : inputText.includes("/api/site-analysis")
        ? 210_000
        : 120_000;
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    const signal = (() => {
      if (!init.signal) return controller.signal;
      if (typeof AbortSignal.any === "function")
        return AbortSignal.any([init.signal, controller.signal]);
      const combined = new AbortController();
      const abort = () => combined.abort();
      init.signal.addEventListener("abort", abort, { once: true });
      controller.signal.addEventListener("abort", abort, { once: true });
      return combined.signal;
    })();
    try {
      const response = await window.fetch(input, { ...init, signal });
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
            ? init.signal?.aborted
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
}
