const normalizedUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    return {
      pathname: url.pathname.replace(/\/+$/, "") || "/",
      hostname: url.hostname.toLowerCase().replace(/^www\./, ""),
    };
  } catch {
    return { pathname: "", hostname: "" };
  }
};

const normalizedHost = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return raw.toLowerCase().replace(/^www\./, "").replace(/^\[|\]$/g, "");
  }
};

export function pickExactWordPressEntity(rows, requestedPathname, requestedHost = "") {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const targetPath = String(requestedPathname || "").replace(/\/+$/, "") || "/";
  const targetHost = normalizedHost(requestedHost);
  return rows.find((row) => {
    const candidate = normalizedUrl(row?.link);
    if (candidate.pathname !== targetPath) return false;
    if (targetHost && candidate.hostname !== targetHost) return false;
    return true;
  }) || null;
}

export const normalizedPathname = (value) => normalizedUrl(value).pathname;
export { normalizedHost };
