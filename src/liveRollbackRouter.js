const PATCHED = Symbol.for("seogrow.liveRollbackRouter");

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

const nestedRollbackChanges = (changes) => {
  const source = changes && typeof changes === "object" ? changes : {};
  const direct = {};
  const meta = {};
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith("meta.")) meta[key.slice(5)] = value;
    else direct[key] = value;
  }
  if (Object.keys(meta).length) direct.meta = meta;
  return direct;
};

if (typeof window !== "undefined" && !window.fetch[PATCHED]) {
  const previousFetch = window.fetch.bind(window);
  const routedFetch = async (input, init = {}) => {
    const { pathname, method } = requestInfo(input, init);
    if (pathname === "/api/wordpress/remediate" && method === "POST" && isRollback(init)) {
      const body = typeof init?.body === "string" ? parseJson(init.body, {}) : {};
      return previousFetch("/api/wordpress/live-rollback", {
        ...init,
        body: JSON.stringify({
          siteUrl: body.url,
          targetUrl: body.url,
          username: body.username,
          applicationPassword: body.applicationPassword,
          resource: body.resource,
          id: body.id,
          changes: nestedRollbackChanges(body.changes),
          expectedCurrent: body.expectedCurrent,
        }),
      });
    }
    return previousFetch(input, init);
  };
  routedFetch[PATCHED] = true;
  window.fetch = routedFetch;
}

export { nestedRollbackChanges };
