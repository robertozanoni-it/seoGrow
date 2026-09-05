import { issueIdentity } from "./reliabilityModel.js";

const DB_NAME = "seogrow-remediation";
const DB_VERSION = 1;
const STORE_NAME = "corrections";
const CLIENTS_KEY = "seogrow-clients";

export const REMEDIATION_INDEX_KEY = "seogrow-remediation-history-v1";
export const REMEDIATION_LAST_BATCH_KEY = "seogrow-remediation-last-batch-v1";
export const TASKS_KEY = "seogrow-tasks-v2";

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};

const writeJson = (key, value) => {
  const serialized = JSON.stringify(value);
  localStorage.setItem(key, serialized);
  window.dispatchEvent(new StorageEvent("storage", { key, newValue: serialized }));
};

const writeJsonBestEffort = (key, value, detail = {}) => {
  try {
    writeJson(key, value);
    return true;
  } catch (error) {
    console.warn(`Indice locale ${key} non aggiornato; IndexedDB resta la source of truth.`, error);
    window.dispatchEvent(new CustomEvent("seogrow-remediation-index-warning", {
      detail: { key, message: error?.message || String(error), ...detail },
    }));
    return false;
  }
};

const openDb = () => new Promise((resolve, reject) => {
  if (!window.indexedDB) {
    reject(new Error("IndexedDB non disponibile: impossibile salvare snapshot di rollback."));
    return;
  }
  const request = window.indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
      store.createIndex("clientId", "clientId", { unique: false });
      store.createIndex("batchId", "batchId", { unique: false });
      store.createIndex("appliedAt", "appliedAt", { unique: false });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error("Archivio remediation non disponibile."));
});

const withStore = async (mode, action) => {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      let result;
      try { result = action(store); } catch (error) { reject(error); return; }
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || new Error("Errore archivio remediation."));
      transaction.onabort = () => reject(transaction.error || new Error("Operazione remediation annullata."));
    });
  } finally { db.close(); }
};

const readAllCorrections = async () => {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = () => reject(request.error || new Error("Storico correzioni non leggibile."));
    });
  } finally { db.close(); }
};

export const stableIssueKey = (record = {}) => issueIdentity(record);

const exactUrlKey = (record = {}) => issueIdentity({
  ...record,
  wordpressId: undefined,
  resourceId: undefined,
  entityId: undefined,
  idWordPress: undefined,
  wordpressResource: undefined,
  resource: undefined,
  finalUrl: undefined,
  resolvedUrl: undefined,
  canonical: undefined,
  canonicalUrl: undefined,
  canonicalConfirmed: false,
});

const issueKeyCandidates = (record = {}) => new Set([
  stableIssueKey(record),
  exactUrlKey(record),
  record.legacyIssueKey,
].filter(Boolean));

const migrateIdentity = (record = {}) => {
  const nextKey = stableIssueKey(record);
  const legacy = record.issueKey && record.issueKey !== nextKey ? record.issueKey : record.legacyIssueKey;
  return {
    ...record,
    issueKey: nextKey,
    ...(legacy ? { legacyIssueKey: legacy } : {}),
    identityVersion: 2,
  };
};

const metadataOf = (input) => {
  const record = migrateIdentity(input);
  return {
    id: record.id,
    batchId: record.batchId,
    clientId: record.clientId,
    clientName: record.clientName,
    issueLabel: record.issueLabel,
    issueType: record.issueType,
    issueKey: record.issueKey,
    legacyIssueKey: record.legacyIssueKey || "",
    identityVersion: 2,
    severity: record.severity,
    sourceUrl: record.sourceUrl,
    siteUrl: record.siteUrl || "",
    finalUrl: record.finalUrl || "",
    canonical: record.canonical || "",
    canonicalConfirmed: Boolean(record.canonicalConfirmed),
    resource: record.resource || record.wordpressResource || "",
    entityId: record.entityId || record.wordpressId || null,
    adapter: record.adapter || "",
    status: record.status,
    fields: record.fields,
    appliedAt: record.appliedAt,
    verifiedAt: record.verifiedAt || "",
    rollbackAt: record.rollbackAt || "",
    quality: record.editorialQuality || record.quality || null,
  };
};

const syncIndex = (record) => {
  const current = readJson(REMEDIATION_INDEX_KEY, []);
  const next = [metadataOf(record), ...current.filter((item) => item.id !== record.id)]
    .toSorted((a, b) => Date.parse(b.appliedAt || 0) - Date.parse(a.appliedAt || 0));
  const written = writeJsonBestEffort(REMEDIATION_INDEX_KEY, next, { id: record.id });
  window.dispatchEvent(new CustomEvent("seogrow-remediation-history", { detail: { id: record.id, indexUpdated: written } }));
};

const replaceIndex = (records) => {
  const index = records.map(metadataOf).toSorted((a, b) => Date.parse(b.appliedAt || 0) - Date.parse(a.appliedAt || 0));
  const written = writeJsonBestEffort(REMEDIATION_INDEX_KEY, index, { restored: true });
  window.dispatchEvent(new CustomEvent("seogrow-remediation-history", { detail: { restored: true, indexUpdated: written } }));
};

const activeClientIds = () => {
  const clients = readJson(CLIENTS_KEY, []);
  if (!Array.isArray(clients) || !clients.length) return null;
  return new Set(clients.map((client) => Number(client?.id)).filter((id) => Number.isSafeInteger(id) && id > 0));
};

export const remediationIndex = () => {
  const index = readJson(REMEDIATION_INDEX_KEY, []);
  return Array.isArray(index) ? index.map(migrateIdentity) : [];
};

export async function rebuildRemediationIndex() {
  const records = (await readAllCorrections()).map(migrateIdentity);
  replaceIndex(records);
  return records.length;
}

export async function saveCorrection(record) {
  const next = migrateIdentity(record);
  await withStore("readwrite", (store) => store.put(next));
  syncIndex(next);
  return next;
}

export async function readCorrection(id) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result ? migrateIdentity(request.result) : null);
      request.onerror = () => reject(request.error || new Error("Correzione non leggibile."));
    });
  } finally { db.close(); }
}

export async function updateCorrection(id, patch) {
  const current = await readCorrection(id);
  if (!current) return null;
  const next = migrateIdentity({ ...current, ...patch, issueKey: current.issueKey });
  await withStore("readwrite", (store) => store.put(next));
  syncIndex(next);
  return next;
}

export async function listCorrections({ clientId, batchId, includeOrphans = false } = {}) {
  const validClients = includeOrphans ? null : activeClientIds();
  const rows = await readAllCorrections();
  return rows
    .filter((item) =>
      (validClients == null || validClients.has(Number(item.clientId))) &&
      (clientId == null || Number(item.clientId) === Number(clientId)) &&
      (!batchId || item.batchId === batchId),
    )
    .map(migrateIdentity)
    .toSorted((a, b) => Date.parse(b.appliedAt || 0) - Date.parse(a.appliedAt || 0));
}

export async function replaceCorrections(records) {
  const safeRecords = Array.isArray(records)
    ? records.filter((record) => record && typeof record.id === "string").map(migrateIdentity)
    : [];
  await withStore("readwrite", (store) => {
    store.clear();
    for (const record of safeRecords) store.put(record);
  });
  replaceIndex(safeRecords);
  return safeRecords;
}

export async function purgeOrphanCorrections() {
  const validClients = activeClientIds();
  if (!validClients) return 0;
  const all = await readAllCorrections();
  const orphanIds = all.filter((item) => !validClients.has(Number(item.clientId))).map((item) => item.id);
  if (!orphanIds.length) return 0;
  await withStore("readwrite", (store) => { for (const id of orphanIds) store.delete(id); });
  replaceIndex(all.filter((item) => !orphanIds.includes(item.id)));
  window.dispatchEvent(new CustomEvent("seogrow-remediation-history", { detail: { purgedOrphans: orphanIds.length } }));
  return orphanIds.length;
}

export function setLastBatch(batchId) {
  writeJsonBestEffort(REMEDIATION_LAST_BATCH_KEY, batchId || "", { kind: "batch" });
}

export function lastBatch() { return readJson(REMEDIATION_LAST_BATCH_KEY, ""); }

const taskRecord = (task) => ({
  issueType: task.kind,
  issueLabel: task.title,
  sourceUrl: task.sourceUrl || task.targetUrl || "",
});

const sameIssue = (left, right) => {
  const leftKeys = issueKeyCandidates(left);
  const rightKeys = issueKeyCandidates(right);
  return [...leftKeys].some((key) => rightKeys.has(key));
};

export function removeVerifiedTask(record) {
  const tasks = readJson(TASKS_KEY, []);
  let changed = false;
  const next = tasks.map((task) => {
    if (Number(task.sourceClientId) !== Number(record.clientId)) return task;
    if (!sameIssue(record, taskRecord(task)) || task.status === "Completato") return task;
    changed = true;
    return {
      ...task,
      status: "Completato",
      completedAt: task.completedAt || new Date().toISOString(),
      completionReason: "Correzione verificata da SeoGrow",
    };
  });
  if (changed) writeJsonBestEffort(TASKS_KEY, next, { kind: "task-completion" });
}

export function reopenTask(record) {
  const tasks = readJson(TASKS_KEY, []);
  const matchingIndex = tasks.findIndex((task) =>
    Number(task.sourceClientId) === Number(record.clientId) && sameIssue(record, taskRecord(task)),
  );
  if (matchingIndex >= 0) {
    const current = tasks[matchingIndex];
    if (current.status !== "Completato") return;
    const next = [...tasks];
    next[matchingIndex] = {
      ...current,
      status: "Da fare",
      completedAt: "",
      completionReason: "",
      reopenedAt: new Date().toISOString(),
    };
    writeJsonBestEffort(TASKS_KEY, next, { kind: "task-reopen" });
    return;
  }
  const priority = ["alta", "high", "critical", "critica"].includes(String(record.severity || "").toLowerCase())
    ? "Alta"
    : ["bassa", "low"].includes(String(record.severity || "").toLowerCase()) ? "Bassa" : "Media";
  writeJsonBestEffort(TASKS_KEY, [{
    id: `rollback-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: record.issueLabel || "Ricontrolla correzione ripristinata",
    client: record.clientName || "",
    sourceClientId: record.clientId,
    priority,
    due: "",
    status: "Da fare",
    kind: record.issueType || "audit",
    targetUrl: "",
    sourceUrl: record.sourceUrl || "",
    linkLabel: "Apri pagina",
    detail: `Task riaperta automaticamente dopo rollback della correzione del ${new Date(record.appliedAt).toLocaleString("it-IT")}.`,
    notes: "",
    createdAt: new Date().toISOString(),
  }, ...tasks], { kind: "task-reopen-create" });
}

if (typeof window !== "undefined") {
  const cleanupAfterClientSave = (event) => {
    if (event?.detail?.key !== CLIENTS_KEY) return;
    void purgeOrphanCorrections().catch((error) => console.warn("Pulizia storico remediation non completata:", error));
  };
  window.addEventListener("seogrow-storage-ok", cleanupAfterClientSave);
}
