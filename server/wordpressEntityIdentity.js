const normalizedPathname = (value) => {
  try {
    const pathname = new URL(String(value || "")).pathname.replace(/\/+$/, "");
    return pathname || "/";
  } catch {
    return "";
  }
};

export function pickExactWordPressEntity(rows, requestedPathname) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const target = String(requestedPathname || "").replace(/\/+$/, "") || "/";
  return rows.find((row) => normalizedPathname(row?.link) === target) || null;
}

export { normalizedPathname };
