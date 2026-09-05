const DB_NAME = "seogrow-remediation";
const DB_VERSION = 1;
const STORE_NAME = "corrections";
const CLIENTS_KEY = "seogrow-clients";

export const REMEDIATION_INDEX_KEY = "seogrow-remediation-history-v1";
export const REMEDIATION_LAST_BATCH_KEY = "seogrow-remediation-last-batch-v1";
export const TASKS_KEY = "seogrow-tasks-v2";

const readJson = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key, value) => {
  const serialized = JSON.stringify(value);
  localStorage.setItem(key, serialized);
  window.dispatchEvent(new StorageEvent("storage", { key, newValue: serialized }));
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
      try {
        result = action(store);
      } catch (error) {
        reject(error);
        return;
      }
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || new Error("Errore archivio remediation."));
      transaction.onabort = () => reject(transaction.error || new Error("Operazione remediation annullata."));
    });
  } finally {
    db.close();
  }
};

const readAllCorrections = async () => {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = () => reject(request.error || new Error("Storico correzioni non leggibile."));
    });
  } finally {
    db.close();
  }
};

const metadataOf = (record) => ({
  id: record.id,
  batchId: record.batchId,
  clientId: record.clientId,
  clientName: record.clientName,
  issueLabel: record.issueLabel,
  issueType: record.issueType,
  issueKey: record.issueKey || stableIssueKey(record),
  severity: record.severity,
  sourceUrl: record.sourceUrl,
  status: record.status,
  fields: record.fields,
  appliedAt: record.appliedAt,
  verifiedAt: record.verifiedAt || "",
  rollbackAt: record.rollbackAt || "",
});

const syncIndex = (record) => {
  const current = readJson(REMEDIATION_INDEX_KEY, []);
  const next = [metadataOf(record), ...current.filter((item) => item.id !== record.id)]
    .toSorted((a, b) => Date.parse(b.appliedAt || 0) - Date.parse(a.appliedAt || 0));
  writeJson(REMEDIATION_INDEX_KEY, next);
  window.dispatchEvent(new CustomEvent("seogrow-remediation-history", { detail: { id: record.id } }));
};

const replaceIndex = (records) => {
  const index = records
    .map(metadataOf)
    .toSorted((a, b) => Date.parse(b.appliedAt || 0) - Date.parse(a.appliedAt || 0));
  writeJson(REMEDIATION_INDEX_KEY, index);
  window.dispatchEvent(new CustomEvent("seogrow-remediation-history", { detail: { restored: true } }));
};

const activeClientIds = () => {
  const clients = readJson(CLIENTS_KEY, []);
  if (!Array.isArray(clients) || !clients.length) return null;
  return new Set(
    clients
      .map((client) => Number(client?.id))
      .filter((id) => Number.isSafeInteger(id) && id > 0),
  );
};

const normalizedUrl = (value) => {
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    return `${url.protocol}//${url.hostname}${url.pathname.replace(/\/+$/, "") || "/"}${url.search}`;
  } catch {
    return String(value || "").replace(/\/+$/, "");
  }
};

const normalizeIssueFamily = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/\b\d+(?:[.,]\d+)?\b/g, "#")
  .replace(/\s+/g, " ")
  .trim();

export const stableIssueKey = (record = {}) => {
  const issue = record.issue || {};
  const type = String(record.issueType || issue.type || "").trim().toLowerCase();
  const family = type || normalizeIssueFamily(record.issueLabel || issue.label || "audit");
  const url = normalizedUrl(record.sourceUrl || issue.targetUrl || issue.url || "");
  return `${family}::${url}`;
};

export const remediationIndex = () => readJson(REMEDIATION_INDEX_KEY, []);

export async function saveCorrection(record) {
  const next = { ...record, issueKey: record.issueKey || stableIssueKey(record) };
  await withStore("readwrite", (store) => store.put(next));
  syncIndex(next);
  return next;
}

export async function readCorrection(id) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("Correzione non leggibile."));
    });
  } finally {
    db.close();
  }
}

export async function updateCorrection(id, patch) {
  const current = await readCorrection(id);
  if (!current) return null;
  const next = { ...current, ...patch };
  next.issueKey = next.issueKey || stableIssueKey(next);
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
    .map((item) => ({ ...item, issueKey: item.issueKey || stableIssueKey(item) }))
    .toSorted((a, b) => Date.parse(b.appliedAt || 0) - Date.parse(a.appliedAt || 0));
}

export async function replaceCorrections(records) {
  const safeRecords = Array.isArray(records)
    ? records
        .filter((record) => record && typeof record.id === "string")
        .map((record) => ({ ...record, issueKey: record.issueKey || stableIssueKey(record) }))
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
  const orphanIds = all
    .filter((item) => !validClients.has(Number(item.clientId)))
    .map((item) => item.id);
  if (!orphanIds.length) return 0;
  await withStore("readwrite", (store) => {
    for (const id of orphanIds) store.delete(id);
  });
  const retained = all.filter((item) => !orphanIds.includes(item.id));
  replaceIndex(retained);
  window.dispatchEvent(new CustomEvent("seogrow-remediation-history", {
    detail: { purgedOrphans: orphanIds.length },
  }));
  return orphanIds.length;
}

export function setLastBatch(batchId) {
  writeJson(REMEDIATION_LAST_BATCH_KEY, batchId || "");
}

export function lastBatch() {
  return readJson(REMEDIATION_LAST_BATCH_KEY, "");
}

export function removeVerifiedTask(record) {
  const tasks = readJson(TASKS_KEY, []);
  const targetKey = stableIssueKey(record);
  let changed = false;
  const next = tasks.map((task) => {
    if (Number(task.sourceClientId) !== Number(record.clientId)) return task;
    const taskKey = stableIssueKey({
      issueType: task.kind,
      issueLabel: task.title,
      sourceUrl: task.sourceUrl || task.targetUrl || "",
    });
    if (taskKey !== targetKey || task.status === "Completato") return task;
    changed = true;
    return {
      ...task,
      status: "Completato",
      completedAt: task.completedAt || new Date().toISOString(),
      completionReason: "Correzione verificata da SeoGrow",
    };
  });
  if (changed) writeJson(TASKS_KEY, next);
}

export function reopenTask(record) {
  const tasks = readJson(TASKS_KEY, []);
  const targetKey = stableIssueKey(record);
  const matchingIndex = tasks.findIndex((task) =>
    Number(task.sourceClientId) === Number(record.clientId) &&
    stableIssueKey({
      issueType: task.kind,
      issueLabel: task.title,
      sourceUrl: task.sourceUrl || task.targetUrl || "",
    }) === targetKey,
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
    writeJson(TASKS_KEY, next);
    return;
  }
  const priority = ["alta", "high", "critical", "critica"].includes(String(record.severity || "").toLowerCase())
    ? "Alta"
    : ["bassa", "low"].includes(String(record.severity || "").toLowerCase())
      ? "Bassa"
      : "Media";
  writeJson(TASKS_KEY, [{
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
  }, ...tasks]);
}

if (typeof window !== "undefined") {
  const cleanupAfterClientSave = (event) => {
    if (event?.detail?.key !== CLIENTS_KEY) return;
    void purgeOrphanCorrections().catch((error) =>
      console.warn("Pulizia storico remediation non completata:", error),
    );
  };
  window.addEventListener("seogrow-storage-ok", cleanupAfterClientSave);
}
