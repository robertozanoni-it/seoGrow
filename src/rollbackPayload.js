export const nestedRollbackChanges = (changes) => {
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

export function rollbackRequest(record, { username = "", applicationPassword = "" } = {}) {
  const before = record?.before && typeof record.before === "object" ? record.before : {};
  const after = record?.after && typeof record.after === "object" ? record.after : {};
  return {
    siteUrl: record?.siteUrl || record?.sourceUrl || "",
    targetUrl: record?.sourceUrl || "",
    username: record?.username || username,
    applicationPassword,
    resource: record?.resource || record?.wordpressResource || "",
    id: Number(record?.entityId || record?.wordpressId || 0),
    adapter: record?.adapter || "",
    taxonomy: record?.taxonomy || "",
    taxonomyField: record?.taxonomyField || (record?.resource === "taxonomy" ? record?.fields?.[0] || "" : ""),
    changes: nestedRollbackChanges(before),
    expectedCurrent: after,
  };
}
