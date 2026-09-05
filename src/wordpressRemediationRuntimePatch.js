const PATCHED = Symbol.for("seogrow.wordpressRemediationRuntimePatch");

const requestInfo = (input, init = {}) => {
  const raw = typeof input === "string" ? input : input?.url || "";
  let url;
  try {
    url = new URL(String(raw), window.location.href);
  } catch {
    url = new URL(window.location.href);
    url.pathname = String(raw).split("?")[0];
  }
  const method = String(init?.method || input?.method || "GET").toUpperCase();
  return { url, pathname: url.pathname, method };
};

const parseBody = (body, fallback = {}) => {
  if (typeof body !== "string") return fallback;
  try {
    return JSON.parse(body);
  } catch {
    return fallback;
  }
};

export function isNonEditableWordPressUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (/\/(?:category|categoria|tag|author|autore|date|feed)(?:\/|$)/i.test(path)) return true;
    if (/\/page\/\d+$/i.test(path)) return true;
    if (/\/(?:search)(?:\/|$)/i.test(path)) return true;
    for (const key of ["s", "cat", "tag", "paged", "author", "feed"]) {
      if (url.searchParams.has(key)) return true;
    }
    return false;
  } catch {
    return true;
  }
}

const archiveResponse = () => new Response(
  JSON.stringify({
    error: "Archivio/tassonomia WordPress rilevata: questa URL non è una pagina o un articolo modificabile tramite REST. SeoGrow la esclude dalla remediation automatica.",
    skipped: true,
    code: "NON_EDITABLE_ARCHIVE",
  }),
  { status: 422, headers: { "content-type": "application/json; charset=utf-8" } },
);

if (typeof window !== "undefined" && !window.fetch[PATCHED]) {
  const previousFetch = window.fetch.bind(window);

  const patchedFetch = async (input, init = {}) => {
    const info = requestInfo(input, init);
    let effectiveInput = input;

    if (info.pathname === "/api/wordpress/generate-patch" && info.method === "POST") {
      effectiveInput = "/api/wordpress/generate-patch-v2";
    }

    if (info.pathname === "/api/wordpress/inspect" && info.method === "POST") {
      const request = parseBody(init?.body, {});
      if (isNonEditableWordPressUrl(request?.url)) return archiveResponse();
      effectiveInput = "/api/wordpress/inspect-fast";
    }

    // Non riscrivere mai previewBefore/previewAfter: il payload mostrato per
    // l'approvazione deve coincidere con quello completo preparato dal server.
    return previousFetch(effectiveInput, init);
  };

  patchedFetch[PATCHED] = true;
  window.fetch = patchedFetch;
}
