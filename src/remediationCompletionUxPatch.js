import { remediationIndex, TASKS_KEY } from "./remediationStore";
import "./remediationCompletionUxPatch.css";

const PATCHED = Symbol.for("seogrow.remediationCompletionUxPatch");
const CLIENT_KEY = "seogrow-selected-client-v1";
const RESOLVED_EVIDENCE_KEY = "seogrow-remediation-resolved-evidence-v1";

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
  window.dispatchEvent(new CustomEvent("seogrow-storage-ok", { detail: { key } }));
};

const normalizeUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    return `${url.origin}${url.pathname.replace(/\/+$/, "") || "/"}${url.search}`;
  } catch {
    return String(value || "").replace(/\/+$/, "");
  }
};

const normalizeText = (value) =>
  String(value || "").trim().toLocaleLowerCase("it");

const selectedClientId = () => Number(readJson(CLIENT_KEY, 0));

const allAuditIssueRows = () =>
  [...document.querySelectorAll(".audit-issues-list > div")]
    .filter((row) => !row.classList.contains("panel-head"));

const activeAuditIssueRows = () =>
  allAuditIssueRows().filter((row) => !row.classList.contains("seogrow-issue-resolved"));

const issueFromRow = (row) => ({
  label: row?.querySelector("strong")?.textContent?.trim() || "",
  url: row?.querySelector("a.task-link")?.href || "",
});

const matchingTask = (task, clientId, label, url) =>
  Number(task?.sourceClientId) === Number(clientId) &&
  normalizeText(task?.title) === normalizeText(label) &&
  normalizeUrl(task?.sourceUrl || task?.targetUrl || "") === normalizeUrl(url);

const matchingCorrection = (record, clientId, label, url) =>
  Number(record?.clientId) === Number(clientId) &&
  normalizeText(record?.issueLabel) === normalizeText(label) &&
  normalizeUrl(record?.sourceUrl || "") === normalizeUrl(url);

const evidenceKey = (clientId, label, url) =>
  `${Number(clientId)}|${normalizeText(label)}|${normalizeUrl(url)}`;

const rememberResolvedEvidence = (clientId, label, url) => {
  if (!clientId || !label || !url) return;
  const current = readJson(RESOLVED_EVIDENCE_KEY, {});
  const key = evidenceKey(clientId, label, url);
  const next = {
    ...current,
    [key]: { verifiedAt: new Date().toISOString() },
  };
  const entries = Object.entries(next)
    .toSorted((a, b) => Date.parse(b[1]?.verifiedAt || 0) - Date.parse(a[1]?.verifiedAt || 0))
    .slice(0, 500);
  writeJson(RESOLVED_EVIDENCE_KEY, Object.fromEntries(entries));
};

function completeResolvedTask(label, url) {
  const clientId = selectedClientId();
  if (!clientId || !label || !url) return;
  const tasks = readJson(TASKS_KEY, []);
  let changed = false;
  const now = new Date().toISOString();
  const next = tasks.map((task) => {
    if (!matchingTask(task, clientId, label, url) || task.status === "Completato") return task;
    changed = true;
    return {
      ...task,
      status: "Completato",
      updatedAt: now,
      completedAt: now,
      notes: task.notes || "Chiusa automaticamente: SeoGrow ha confermato che il problema non è più presente nel frontend.",
    };
  });
  if (changed) writeJson(TASKS_KEY, next);
}

function syncResolvedPreviewRows() {
  document.querySelectorAll(".wp-live-preview-row.resolved").forEach((row) => {
    const label = row.querySelector("strong")?.textContent?.trim() || "";
    const url = [...row.querySelectorAll("small")]
      .map((item) => item.textContent?.trim() || "")
      .find((value) => /^https?:\/\//i.test(value)) || "";
    if (!label || !url) return;
    const clientId = selectedClientId();
    completeResolvedTask(label, url);
    if (row.dataset.seogrowEvidenceStored !== "1") {
      rememberResolvedEvidence(clientId, label, url);
      row.dataset.seogrowEvidenceStored = "1";
    }
    row.dataset.seogrowTaskSynced = "1";
  });
}

const autoVerifiedTask = (task) =>
  task?.status === "Completato" &&
  /Chiusa automaticamente: SeoGrow ha confermato/i.test(String(task?.notes || ""));

const recordTime = (record) =>
  Date.parse(record?.verifiedAt || record?.appliedAt || 0) || 0;

const taskTime = (task) =>
  Date.parse(task?.createdAt || task?.updatedAt || 0) || 0;

function syncAuditIssueRows() {
  const clientId = selectedClientId();
  if (!clientId) return;
  let tasks = readJson(TASKS_KEY, []);
  const corrections = remediationIndex();
  const evidence = readJson(RESOLVED_EVIDENCE_KEY, {});
  let resolved = 0;
  let active = 0;

  for (const row of allAuditIssueRows()) {
    const { label, url } = issueFromRow(row);
    if (!label || !url) continue;
    let relatedTasks = tasks.filter((task) => matchingTask(task, clientId, label, url));
    const verifiedRecords = corrections
      .filter((record) => matchingCorrection(record, clientId, label, url) && record.status === "Verificato")
      .toSorted((a, b) => recordTime(b) - recordTime(a));
    const latestVerified = verifiedRecords[0] || null;
    const latestVerifiedAt = recordTime(latestVerified);
    const activeTasks = relatedTasks.filter((task) => task.status !== "Completato" && !task.stale);

    if (
      latestVerifiedAt > 0 &&
      activeTasks.length > 0 &&
      activeTasks.every((task) => taskTime(task) <= latestVerifiedAt)
    ) {
      completeResolvedTask(label, url);
      tasks = readJson(TASKS_KEY, []);
      relatedTasks = tasks.filter((task) => matchingTask(task, clientId, label, url));
    }

    const hasActiveTask = relatedTasks.some((task) => task.status !== "Completato" && !task.stale);
    const hasAutoVerifiedTask = relatedTasks.some(autoVerifiedTask);
    const hasStoredEvidence = Boolean(evidence[evidenceKey(clientId, label, url)]);
    const hasVerifiedEvidence = Boolean(latestVerified) || hasAutoVerifiedTask || hasStoredEvidence;
    const isResolved = !hasActiveTask && hasVerifiedEvidence;

    row.classList.toggle("seogrow-issue-resolved", isResolved);
    let badge = row.querySelector(".seogrow-resolved-badge");
    if (isResolved) {
      resolved += 1;
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "seogrow-resolved-badge";
        badge.textContent = "Risolto";
        row.querySelector("strong")?.insertAdjacentElement("afterend", badge);
      }
      row.hidden = true;
      row.setAttribute("aria-hidden", "true");
      row.style.setProperty("display", "none", "important");
      row.querySelectorAll("button").forEach((button) => {
        button.hidden = true;
        button.setAttribute("aria-hidden", "true");
        button.style.setProperty("display", "none", "important");
      });
    } else {
      active += 1;
      badge?.remove();
      row.hidden = false;
      row.removeAttribute("aria-hidden");
      row.style.removeProperty("display");
      row.querySelectorAll("button").forEach((button) => {
        if (button.dataset.seogrowLegacyCorrection === "1") return;
        button.hidden = false;
        button.removeAttribute("aria-hidden");
        button.style.removeProperty("display");
      });
    }
  }

  const description = document.querySelector(".audit-issues-list .panel-head p");
  if (description) {
    const desired = resolved > 0
      ? `${active} problemi ancora da correggere · ${resolved} risolti dopo l’audit e rimossi da questa lista. I problemi risolti restano disponibili nello storico audit.`
      : "Correggi direttamente con l’agente del progetto oppure crea una Task solo se vuoi inserirlo nel backlog.";
    if (description.textContent !== desired) description.textContent = desired;
  }
}

let requestedIssueIndex = null;

function selectedIssue() {
  const rows = allAuditIssueRows();
  if (Number.isSafeInteger(requestedIssueIndex) && requestedIssueIndex >= 0) {
    const row = rows[requestedIssueIndex];
    if (row && !row.classList.contains("seogrow-issue-resolved")) {
      const issue = issueFromRow(row);
      if (issue.label) return issue;
    }
  }

  const select = document.querySelector(".audit-issue-select select");
  if (select) {
    const originalIndex = Number(select.value || 0);
    const row = rows[originalIndex];
    if (row && !row.classList.contains("seogrow-issue-resolved")) {
      const option = select.options?.[select.selectedIndex];
      const issue = issueFromRow(row);
      return {
        label: issue.label || option?.textContent?.trim() || "",
        url: issue.url || "",
      };
    }
  }

  return issueFromRow(activeAuditIssueRows()[0]);
}

function syncSelectedIssueBanner() {
  const root = document.querySelector(".wp-live-remediation");
  const actions = root?.querySelector(".wp-live-remediation-actions");
  if (!root || !actions) return;
  const issue = selectedIssue();
  if (!issue.label) return;

  let banner = root.querySelector(".wp-live-selected-issue");
  if (!banner) {
    banner = document.createElement("div");
    banner.className = "wp-live-selected-issue";
    const title = document.createElement("strong");
    title.textContent = "Problema selezionato";
    const label = document.createElement("span");
    label.className = "wp-live-selected-issue-label";
    const url = document.createElement("small");
    url.className = "wp-live-selected-issue-url";
    banner.append(title, label, url);
    root.insertBefore(banner, actions);
  }
  const labelNode = banner.querySelector(".wp-live-selected-issue-label");
  if (labelNode.textContent !== issue.label) labelNode.textContent = issue.label;
  const urlNode = banner.querySelector(".wp-live-selected-issue-url");
  if (urlNode.textContent !== (issue.url || "")) urlNode.textContent = issue.url || "";
  urlNode.hidden = !issue.url;

  const singleButton = [...actions.querySelectorAll("button")]
    .find((button) => /Prepara solo questo problema/i.test(button.textContent || ""));
  if (singleButton) {
    const title = `Prepara solo: ${issue.label}`;
    const aria = `Prepara solo il problema selezionato: ${issue.label}`;
    if (singleButton.title !== title) singleButton.title = title;
    if (singleButton.getAttribute("aria-label") !== aria) singleButton.setAttribute("aria-label", aria);
  }
}

function syncBulkActionTotal() {
  const root = document.querySelector(".wp-live-remediation");
  const actions = root?.querySelector(".wp-live-remediation-actions");
  if (!actions) return;
  const bulkButton = [...actions.querySelectorAll("button")]
    .find((button) => /Prepara anteprima di tutte le correzioni|Preparazione…/i.test(button.textContent || ""));
  if (!bulkButton) return;
  const totalAudit = allAuditIssueRows().length;
  const totalActive = activeAuditIssueRows().length;
  let badge = bulkButton.querySelector(".seogrow-bulk-total");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "seogrow-bulk-total";
    bulkButton.appendChild(badge);
  }
  const label = `(${totalActive})`;
  if (badge.textContent !== label) badge.textContent = label;
  bulkButton.title = `${totalActive} problemi ancora da correggere su ${totalAudit} rilevati nell'audit corrente`;
  bulkButton.setAttribute("aria-label", `Prepara anteprima di tutte le correzioni: ${totalActive} problemi ancora da correggere su ${totalAudit} rilevati`);
}

function syncBlockedRows() {
  document.querySelectorAll(".wp-live-preview-row.unsupported, .wp-live-preview-row.error").forEach((row) => {
    if (row.querySelector(".seogrow-blocked-badge")) return;
    const badge = document.createElement("span");
    badge.className = "seogrow-blocked-badge";
    badge.textContent = "Non corretto";
    row.querySelector("strong")?.insertAdjacentElement("afterend", badge);
  });
}

function syncVerificationMessage() {
  const message = document.querySelector(".wp-live-remediation-message");
  if (!message) return;
  const current = message.textContent || "";
  if (!/Applicazione live completata:/i.test(current) || /SeoGrow riverifica automaticamente/i.test(current)) return;
  message.textContent = `${current.replace(/Le modifiche applicate[\s\S]*$/i, "").trim()} SeoGrow riverifica automaticamente il frontend. Un nuovo audit serve soltanto ad aggiornare il report storico e il conteggio dei problemi.`;
}

function arrange() {
  syncResolvedPreviewRows();
  syncAuditIssueRows();
  syncSelectedIssueBanner();
  syncBulkActionTotal();
  syncBlockedRows();
  syncVerificationMessage();
}

if (typeof window !== "undefined" && !window[PATCHED]) {
  window[PATCHED] = true;
  const observer = new MutationObserver(arrange);
  const start = () => {
    arrange();
    if (document.body) observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  window.addEventListener("seogrow-remediation-open", (event) => {
    const value = Number(event?.detail?.issueIndex);
    requestedIssueIndex = Number.isSafeInteger(value) && value >= 0 ? value : null;
    window.setTimeout(arrange, 0);
  });
  window.addEventListener("storage", () => window.setTimeout(arrange, 0));
  window.addEventListener("seogrow-remediation-history", () => window.setTimeout(arrange, 0));
  window.addEventListener("seogrow-remediation-applied", () => window.setTimeout(arrange, 0));
  document.addEventListener("change", (event) => {
    if (event.target?.matches?.(".audit-issue-select select")) {
      requestedIssueIndex = Number(event.target.value || 0);
      window.setTimeout(arrange, 0);
    }
  });
}

export { arrange as arrangeRemediationCompletionUx };
