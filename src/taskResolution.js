import { issueFamily, issueKey, normalizeIssueUrl } from "./issueIdentity";

const TASKS_KEY = "seogrow-tasks-v2";

const readTasks = () => {
  try {
    const value = JSON.parse(localStorage.getItem(TASKS_KEY));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

const writeTasks = (tasks) => {
  const serialized = JSON.stringify(tasks);
  localStorage.setItem(TASKS_KEY, serialized);
  window.dispatchEvent(new StorageEvent("storage", { key: TASKS_KEY, newValue: serialized }));
  window.dispatchEvent(new CustomEvent("seogrow-storage-ok", { detail: { key: TASKS_KEY } }));
};

const taskIssue = (task) => ({ type: task?.kind || "audit", label: task?.title || "" });

const taskMatches = (task, clientId, issue, url) => {
  if (Number(task?.sourceClientId) !== Number(clientId)) return false;
  const target = normalizeIssueUrl(url);
  const taskUrl = normalizeIssueUrl(task?.sourceUrl || task?.targetUrl || "");
  if (target && taskUrl && target !== taskUrl) return false;
  if (task?.issueKey) return task.issueKey === issueKey(issue, url);
  return issueFamily(taskIssue(task)) === issueFamily(issue);
};

export function completeTaskForIssue(clientId, issue, url, note = "Problema verificato nel frontend.") {
  const tasks = readTasks();
  let changed = false;
  const now = new Date().toISOString();
  const key = issueKey(issue, url);
  const next = tasks.map((task) => {
    if (!taskMatches(task, clientId, issue, url)) return task;
    const alreadyComplete = task.status === "Completato" && task.issueKey === key;
    if (alreadyComplete) return task;
    changed = true;
    return {
      ...task,
      issueKey: key,
      status: "Completato",
      updatedAt: now,
      completedAt: task.completedAt || now,
      completionNote: note,
    };
  });
  if (changed) writeTasks(next);
  return changed;
}

export function reopenTaskForIssue(record, note = "Task riaperta dopo rollback o nuova verifica negativa.") {
  const tasks = readTasks();
  const issue = record?.issue || { type: record?.issueType, label: record?.issueLabel };
  const url = record?.sourceUrl || "";
  const key = record?.issueKey || issueKey(issue, url);
  const now = new Date().toISOString();
  let found = false;
  const next = tasks.map((task) => {
    if (!taskMatches(task, record?.clientId, issue, url)) return task;
    found = true;
    return {
      ...task,
      issueKey: key,
      status: "Da fare",
      updatedAt: now,
      completedAt: null,
      completionNote: "",
      detail: task.detail || note,
    };
  });
  if (!found) {
    const priority = ["alta", "high", "critical", "critica"].includes(String(record?.severity || "").toLowerCase())
      ? "Alta"
      : ["bassa", "low"].includes(String(record?.severity || "").toLowerCase())
        ? "Bassa"
        : "Media";
    next.unshift({
      id: `remediation-${crypto.randomUUID()}`,
      issueKey: key,
      title: record?.issueLabel || issue?.label || "Ricontrolla correzione",
      client: record?.clientName || "",
      sourceClientId: record?.clientId,
      priority,
      due: "Da pianificare",
      status: "Da fare",
      kind: record?.issueType || issue?.type || "audit",
      targetUrl: "",
      sourceUrl: url,
      linkLabel: "Apri pagina",
      detail: note,
      notes: "",
      createdAt: now,
      updatedAt: now,
    });
  }
  writeTasks(next);
  return true;
}

export function removeDuplicateOpenTasks() {
  const tasks = readTasks();
  const seen = new Set();
  const next = [];
  let changed = false;
  for (const task of tasks) {
    if (task.status === "Completato") {
      next.push(task);
      continue;
    }
    const key = `${Number(task.sourceClientId) || 0}|${task.issueKey || issueKey(taskIssue(task), task.sourceUrl || task.targetUrl || "")}`;
    if (seen.has(key)) {
      changed = true;
      continue;
    }
    seen.add(key);
    next.push(task.issueKey ? task : { ...task, issueKey: key.split("|").slice(1).join("|") });
    if (!task.issueKey) changed = true;
  }
  if (changed) writeTasks(next);
  return tasks.length - next.length;
}

export { TASKS_KEY };
