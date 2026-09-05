import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleGauge,
  ExternalLink,
  FileSearch,
  Filter,
  Info,
  LayoutList,
  ListTree,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { stableIssueKey } from "./remediationStore";
import "./ProblemsWorkspace.css";
import "./ProblemsWorkspaceRuntime.css";

const CLIENTS_KEY = "seogrow-clients";
const SELECTED_CLIENT_KEY = "seogrow-selected-client-v1";
const TASKS_KEY = "seogrow-tasks-v2";
const ANALYSES_KEY = "seogrow-analyses-v2";
const REMEDIATION_INDEX_KEY = "seogrow-remediation-history-v1";

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const currentHash = () => {
  try { return decodeURIComponent(window.location.hash.slice(1)); } catch { return ""; }
};
const navigate = (page) => {
  const next = `#${encodeURIComponent(page)}`;
  if (page === "Correzioni" || page === "Problemi") {
    if (window.location.hash !== next) window.history.pushState(null, "", next);
    window.dispatchEvent(new CustomEvent("seogrow-locationchange"));
    return;
  }
  window.location.hash = next;
};
const latestAnalysis = (value) => Array.isArray(value) ? value[0] || null : value && typeof value === "object" ? value : null;
const severityLabel = (value) => {
  const text = String(value || "").toLowerCase();
  if (/critical|critico|alta|high|error/.test(text)) return "Critico";
  if (/medium|media|warning|importante/.test(text)) return "Importante";
  return "Opportunità";
};
const statusLabel = (value) => {
  const text = String(value || "").toLowerCase();
  if (/verificat|completat/.test(text)) return "Verificato";
  if (/da verificare|revisione|applicato/.test(text)) return "Da verificare";
  if (/in corso|lavorazione/.test(text)) return "In lavorazione";
  return "Da fare";
};
const formatDate = (value) => {
  if (!value) return "Data non disponibile";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data non disponibile";
  return date.toLocaleString("it-IT", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const compactText = (value, max = 220) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const rowKey = (record) => record.issueKey || stableIssueKey(record);

const fromAudit = (issue, analyzedAt) => {
  const sourceUrl = issue.targetUrl || issue.url || "";
  const record = { issueType: issue.type, issueLabel: issue.label, sourceUrl };
  return {
    key: rowKey(record), title: issue.label || issue.type || "Problema SEO", issueType: issue.type || "",
    severity: severityLabel(issue.severity), status: "Da fare", source: "Audit SeoGrow", sourceKind: "audit",
    sourceUrl, detail: issue.detail || "Problema rilevato nell’ultimo audit del progetto.", observedAt: analyzedAt || "", fields: [],
  };
};
const fromCorrection = (record) => ({
  key: rowKey(record), title: record.issueLabel || record.issueType || "Correzione SEO", issueType: record.issueType || "",
  severity: severityLabel(record.severity), status: statusLabel(record.status), source: "Correzioni WordPress", sourceKind: "correction",
  sourceUrl: record.sourceUrl || "", detail: record.status === "Verificato" ? "La correzione è stata applicata e verificata sul sito." : "Correzione registrata nello storico SeoGrow.",
  observedAt: record.verifiedAt || record.appliedAt || record.rollbackAt || "", fields: Array.isArray(record.fields) ? record.fields : [],
});
const fromTask = (task) => {
  const sourceUrl = task.sourceUrl || task.targetUrl || "";
  const record = { issueType: task.kind, issueLabel: task.title, sourceUrl };
  return {
    key: rowKey(record), title: task.title || "Task SEO", issueType: task.kind || "task", severity: severityLabel(task.priority),
    status: statusLabel(task.status), source: "Task SeoGrow", sourceKind: "task", sourceUrl,
    detail: task.detail || task.notes || "Attività generata dai controlli del progetto.", observedAt: task.updatedAt || task.createdAt || "", fields: [],
  };
};

function buildProblems(clientId, clientName) {
  if (!clientId) return [];
  const analysis = latestAnalysis(readJson(ANALYSES_KEY, {})[clientId]);
  const auditRows = (analysis?.issues || []).map((issue) => fromAudit(issue, analysis?.analyzedAt));
  const correctionRows = readJson(REMEDIATION_INDEX_KEY, [])
    .filter((record) => Number(record.clientId) === Number(clientId))
    .map(fromCorrection);
  const taskRows = readJson(TASKS_KEY, [])
    .filter((task) => {
      const sameClient = Number(task.sourceClientId) === Number(clientId) || (!task.sourceClientId && task.client === clientName);
      const technical = String(task.id || "").startsWith("analysis-") || task.kind === "broken-link" || task.regression;
      return sameClient && technical;
    })
    .map(fromTask);

  const merged = new Map();
  for (const row of auditRows) merged.set(row.key, row);
  for (const row of taskRows) {
    const previous = merged.get(row.key);
    merged.set(row.key, previous ? { ...previous, ...row, detail: row.detail || previous.detail } : row);
  }
  for (const row of correctionRows) {
    const previous = merged.get(row.key);
    merged.set(row.key, previous ? { ...previous, ...row, detail: previous.detail || row.detail, source: `${previous.source} · ${row.source}` } : row);
  }
  const statusWeight = { "Da fare": 0, "In lavorazione": 1, "Da verificare": 2, Verificato: 3 };
  const severityWeight = { Critico: 0, Importante: 1, Opportunità: 2 };
  return [...merged.values()].toSorted((a, b) =>
    (statusWeight[a.status] ?? 9) - (statusWeight[b.status] ?? 9) ||
    (severityWeight[a.severity] ?? 9) - (severityWeight[b.severity] ?? 9) ||
    Date.parse(b.observedAt || 0) - Date.parse(a.observedAt || 0));
}

function ProblemDrawer({ problem, onClose }) {
  if (!problem) return null;
  const originPage = problem.sourceKind === "correction" ? "Correzioni" : problem.sourceKind === "task" ? "Task" : "Audit SEO";
  return createPortal(
    <>
      <button className="problem-drawer-scrim" aria-label="Chiudi dettaglio problema" onClick={onClose} />
      <aside className="problem-drawer" aria-label={`Dettaglio: ${problem.title}`}>
        <div className="problem-drawer-head">
          <div><span className={`problem-severity ${problem.severity.toLowerCase()}`}>{problem.severity}</span><h2>{problem.title}</h2></div>
          <button className="icon-btn" aria-label="Chiudi" onClick={onClose}><X /></button>
        </div>
        <div className="problem-drawer-status">
          <span className={`problem-status ${problem.status.toLowerCase().replaceAll(" ", "-")}`}>{problem.status === "Verificato" ? <CheckCircle2 /> : <AlertTriangle />}{problem.status}</span>
          {problem.issueType && <small>{problem.issueType}</small>}
        </div>
        <section><h3>Problema ed evidenze</h3><p>{problem.detail || "Dettaglio non disponibile."}</p>
          {problem.fields.length > 0 && <div className="problem-field-list"><strong>Campi coinvolti</strong><span>{problem.fields.join(", ")}</span></div>}
        </section>
        <section className="problem-why"><h3><Info /> Perché lo vedo?</h3><dl>
          <div><dt>Fonte</dt><dd>{problem.source}</dd></div><div><dt>Rilevato/aggiornato</dt><dd>{formatDate(problem.observedAt)}</dd></div><div><dt>Stato</dt><dd>{problem.status}</dd></div>
        </dl></section>
        {problem.sourceUrl && <a className="secondary problem-resource" href={problem.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink /> Apri la pagina interessata</a>}
        <div className="problem-next-step"><span>Prossima azione</span>
          <button className="primary" onClick={() => navigate(originPage)}>{problem.status === "Da verificare" ? "Verifica ora" : problem.status === "Verificato" ? "Vedi dettaglio" : "Apri intervento"}</button>
          <button className="secondary" onClick={() => navigate("SEO Agent")}><Sparkles /> Chiedi a SeoGrow</button>
        </div>
      </aside>
    </>, document.body);
}

export default function ProblemsWorkspace() {
  const [active, setActive] = useState(currentHash() === "Problemi");
  const [mainTarget, setMainTarget] = useState(null);
  const [, refreshVersion] = useState(0);
  const [filter, setFilter] = useState("Tutti");
  const [view, setView] = useState("compact");
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setMainTarget(document.querySelector(".app main")));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const refresh = () => {
      const nextActive = currentHash() === "Problemi";
      setActive(nextActive);
      if (!nextActive) setSelected(null);
      refreshVersion((value) => value + 1);
    };
    window.addEventListener("hashchange", refresh);
    window.addEventListener("seogrow-locationchange", refresh);
    window.addEventListener("seogrow-storage-ok", refresh);
    window.addEventListener("seogrow-remediation-history", refresh);
    return () => {
      window.removeEventListener("hashchange", refresh);
      window.removeEventListener("seogrow-locationchange", refresh);
      window.removeEventListener("seogrow-storage-ok", refresh);
      window.removeEventListener("seogrow-remediation-history", refresh);
    };
  }, []);
  useEffect(() => {
    if (active) document.body.dataset.seogrowWorkspace = "Problemi";
    else if (document.body.dataset.seogrowWorkspace === "Problemi") delete document.body.dataset.seogrowWorkspace;
    return () => {
      if (document.body.dataset.seogrowWorkspace === "Problemi") delete document.body.dataset.seogrowWorkspace;
    };
  }, [active]);

  const clients = readJson(CLIENTS_KEY, []);
  const domClientId = Number(document.querySelector(".client-select select")?.value || 0);
  const selectedClientId = domClientId || Number(readJson(SELECTED_CLIENT_KEY, 0));
  const client = clients.find((item) => item.id === selectedClientId) || clients[0] || null;
  const rows = buildProblems(client?.id, client?.name);
  const counts = {
    all: rows.length,
    critical: rows.filter((row) => row.severity === "Critico" && row.status !== "Verificato").length,
    todo: rows.filter((row) => row.status === "Da fare" || row.status === "In lavorazione").length,
    verify: rows.filter((row) => row.status === "Da verificare").length,
    verified: rows.filter((row) => row.status === "Verificato").length,
  };
  const filtered = rows.filter((row) => filter === "Critici" ? row.severity === "Critico" && row.status !== "Verificato" : filter === "Da fare" ? row.status === "Da fare" || row.status === "In lavorazione" : filter === "Da verificare" ? row.status === "Da verificare" : filter === "Verificati" ? row.status === "Verificato" : true);

  if (!active || !mainTarget) return null;
  return createPortal(
    <div className="problems-workspace-root">
      <div className="page-title problems-title"><div><span className="problems-eyebrow">Centro operativo</span><h1>Problemi — {client?.name || "progetto"}</h1><p>Audit, Task tecniche e Correzioni raccolti in un’unica vista. Apri un problema per capire fonte, evidenze e prossima azione.</p></div>
        <div className="problems-view-toggle" aria-label="Tipo di visualizzazione"><button className={view === "compact" ? "active" : ""} onClick={() => setView("compact")}><LayoutList /> Compatta</button><button className={view === "detailed" ? "active" : ""} onClick={() => setView("detailed")}><ListTree /> Dettagliata</button></div>
      </div>
      <section className="problems-overview" aria-label="Filtri problemi">
        <button className={filter === "Tutti" ? "active" : ""} onClick={() => setFilter("Tutti")}><strong>{counts.all}</strong><span>Tutti</span></button>
        <button className={`critical ${filter === "Critici" ? "active" : ""}`} onClick={() => setFilter("Critici")}><strong>{counts.critical}</strong><span>Critici</span></button>
        <button className={filter === "Da fare" ? "active" : ""} onClick={() => setFilter("Da fare")}><strong>{counts.todo}</strong><span>Da fare</span></button>
        <button className={`verify ${filter === "Da verificare" ? "active" : ""}`} onClick={() => setFilter("Da verificare")}><strong>{counts.verify}</strong><span>Da verificare</span></button>
        <button className={`verified ${filter === "Verificati" ? "active" : ""}`} onClick={() => setFilter("Verificati")}><strong>{counts.verified}</strong><span>Verificati</span></button>
      </section>
      <div className="problems-toolbar"><span><Filter /> {filtered.length} elementi visualizzati</span><span className="problems-source-note"><ShieldCheck /> Stati derivati da Audit, Task e storico Correzioni già presenti in SeoGrow.</span></div>
      <section className={`problems-list ${view}`}>
        {filtered.length ? filtered.map((problem) => <button className="problem-row" key={problem.key} onClick={() => setSelected(problem)}>
          <span className={`problem-severity ${problem.severity.toLowerCase()}`}>{problem.severity}</span><span className="problem-main"><strong>{problem.title}</strong><small>{problem.sourceUrl || "URL non disponibile"}</small>{view === "detailed" && <p>{compactText(problem.detail)}</p>}</span><span className="problem-source"><FileSearch /> {problem.source}</span><span className={`problem-status ${problem.status.toLowerCase().replaceAll(" ", "-")}`}>{problem.status}</span><ChevronRight className="problem-chevron" />
        </button>) : <div className="problems-empty"><CheckCircle2 /><h2>Nessun problema in questo filtro</h2><p>Cambia filtro oppure esegui un nuovo audit per aggiornare la situazione.</p><button className="secondary" onClick={() => navigate("Audit SEO")}><CircleGauge /> Apri Audit SEO</button></div>}
      </section>
      <ProblemDrawer problem={selected} onClose={() => setSelected(null)} />
    </div>, mainTarget);
}
