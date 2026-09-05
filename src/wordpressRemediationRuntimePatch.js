const PATCHED = Symbol.for("seogrow.wordpressRemediationRuntimePatch");
const inspectedByUrl = new Map();

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

const normalizedUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    return `${url.origin}${url.pathname.replace(/\/+$/, "") || "/"}${url.search}`;
  } catch {
    return String(value || "").replace(/\/+$/, "");
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

const clearRuntimeState = () => {
  inspectedByUrl.clear();
};

const archiveResponse = () => new Response(
  JSON.stringify({
    error: "Archivio/tassonomia WordPress rilevata: questa URL non è una pagina o un articolo modificabile tramite REST. SeoGrow la esclude dalla remediation automatica.",
    skipped: true,
    code: "NON_EDITABLE_ARCHIVE",
  }),
  { status: 422, headers: { "content-type": "application/json; charset=utf-8" } },
);

const differenceWindow = (beforeValue, afterValue) => {
  const before = String(beforeValue || "");
  const after = String(afterValue || "");
  if (!before || !after) return null;
  let index = 0;
  const limit = Math.min(before.length, after.length);
  while (index < limit && before[index] === after[index]) index += 1;
  if (index === before.length && index === after.length) return null;
  const start = Math.max(0, index - 180);
  const endBefore = Math.min(before.length, index + 420);
  const endAfter = Math.min(after.length, index + 420);
  return {
    before: `${start > 0 ? "…" : ""}${before.slice(start, endBefore)}${endBefore < before.length ? "…" : ""}`,
    after: `${start > 0 ? "…" : ""}${after.slice(start, endAfter)}${endAfter < after.length ? "…" : ""}`,
  };
};

const improvePreviewResponse = async (response, init) => {
  if (!response.ok) return response;
  try {
    const request = parseBody(init?.body, {});
    const target = normalizedUrl(request?.targetUrl || "");
    const inspected = inspectedByUrl.get(target);
    const beforeElementor = inspected?.entity?.meta?._elementor_data;
    const afterElementor = request?.changes?.meta?._elementor_data;
    const windowed = differenceWindow(beforeElementor, afterElementor);
    if (!windowed) return response;
    const data = await response.clone().json();
    data.previewBefore = {
      ...(data.previewBefore || {}),
      meta: { ...(data.previewBefore?.meta || {}), _elementor_data: windowed.before },
    };
    data.previewAfter = {
      ...(data.previewAfter || {}),
      meta: { ...(data.previewAfter?.meta || {}), _elementor_data: windowed.after },
    };
    return new Response(JSON.stringify(data), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch {
    return response;
  }
};

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
      const response = await previousFetch(effectiveInput, init);
      if (response.ok) {
        try {
          const data = await response.clone().json();
          inspectedByUrl.set(normalizedUrl(request?.url || ""), data);
        } catch {
          inspectedByUrl.delete(normalizedUrl(request?.url || ""));
        }
      }
      return response;
    }

    let response = await previousFetch(effectiveInput, init);

    if (info.pathname === "/api/wordpress/live-preview" && info.method === "POST") {
      response = await improvePreviewResponse(response, init);
    }

    if (
      info.method === "POST" &&
      [
        "/api/wordpress/live-apply",
        "/api/wordpress/live-rollback",
        "/api/wordpress/remediate",
        "/api/wordpress/remediate-draft-copy",
      ].includes(info.pathname) &&
      response.ok
    ) {
      clearRuntimeState();
    }

    return response;
  };

  patchedFetch[PATCHED] = true;
  window.fetch = patchedFetch;

  window.addEventListener("seogrow-storage-ok", (event) => {
    if (event?.detail?.key === "seogrow-selected-client-v1") clearRuntimeState();
  });
}
