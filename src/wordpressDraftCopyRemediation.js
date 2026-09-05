const PATCHED = Symbol.for("seogrow.wordpressDraftCopyRemediation");
const statusByUrl = new Map();

const normalizeUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    return `${url.origin}${url.pathname.replace(/\/+$/, "") || "/"}${url.search}`;
  } catch {
    return String(value || "").replace(/\/+$/, "");
  }
};

const parseJson = (value, fallback = {}) => {
  try {
    return JSON.parse(String(value ?? ""));
  } catch {
    return fallback;
  }
};

const requestInfo = (input, init = {}) => {
  const raw = typeof input === "string" ? input : input?.url || "";
  let pathname;
  try {
    pathname = new URL(String(raw), window.location.href).pathname;
  } catch {
    pathname = String(raw).split("?")[0];
  }
  return { pathname, method: String(init?.method || input?.method || "GET").toUpperCase() };
};

const isRollback = (init) =>
  new Headers(init?.headers || {}).get("x-seogrow-rollback") === "1";

if (typeof window !== "undefined" && !window.fetch[PATCHED]) {
  const previousFetch = window.fetch.bind(window);
  const routedFetch = async (input, init = {}) => {
    const { pathname, method } = requestInfo(input, init);

    if (pathname === "/api/wordpress/remediate" && method === "POST" && !isRollback(init)) {
      const body = typeof init?.body === "string" ? parseJson(init.body, {}) : {};
      const target = normalizeUrl(body?.url || "");
      const inspected = target ? statusByUrl.get(target) : null;
      const status = String(inspected?.status || "").toLowerCase();
      if (status && status !== "draft" && !["trash", "auto-draft", "inherit"].includes(status)) {
        return previousFetch("/api/wordpress/remediate-draft-copy", init);
      }
    }

    const response = await previousFetch(input, init);

    if (pathname === "/api/wordpress/inspect" && method === "POST" && response.ok) {
      try {
        const request = typeof init?.body === "string" ? parseJson(init.body, {}) : {};
        const data = await response.clone().json();
        const target = normalizeUrl(request?.url || "");
        if (target) {
          statusByUrl.set(target, {
            status: data?.entity?.status || "",
            resource: data?.resource || "",
            id: Number(data?.entity?.id || 0),
            recordedAt: Date.now(),
          });
        }
      } catch {
        // Il normale flusso UI gestisce risposte non interpretabili.
      }
    }

    return response;
  };

  routedFetch[PATCHED] = true;
  window.fetch = routedFetch;
}
