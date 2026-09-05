import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ExternalLink, FileText, Globe2, Sparkles } from "lucide-react";
import { apiFetch } from "./api";
import { analysisDiff, normalizeAnalysisHistory, tasksFromAnalysis } from "./platform";
import { isIssueResolved, issueKey } from "./issueIdentity";
import "./AuditWorkspace.css";

const fetch = apiFetch;
const PAGE_HISTORY_KEY = "seogrow-page-audit-history-v2";
const SITE_HISTORY_KEY = "seogrow-analyses-v2";
const TASKS_KEY = "seogrow-tasks-v2";

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};

const writeJson = (key, value) => {
  const serialized = JSON.stringify(value);
  localStorage.setItem(key, serialized);
  window.dispatchEvent(new StorageEvent("storage", { key, newValue: serialized }));
  window.dispatchEvent(new CustomEvent("seogrow-storage-ok", { detail: { key } }));
};

const severityPriority = (severity) => {
  const value = String(severity || "").toLowerCase();
  if (["alta", "high", "critical", "critica"].includes(value)) return "Alta";
  if (["bassa", "low"].includes(value)) return "Bassa";
  return "Media";
};

const currentPage = () => {
  try { return decodeURIComponent(window.location.hash.slice(1)); } catch { return ""; }
};

const timestamp = (item) => Date.parse(item?.analyzedAt || item?.startedAt || 0) || 0;
const issueUrl = (issue, result, client) => issue?.targetUrl || issue?.url || issue?.sourceUrl || result?.url || client?.url || "";

const latestSavedResult = (pageHistory, siteHistory) => {
  const combined = [
    ...pageHistory.map((data) => ({ type: "page", data })),
    ...siteHistory.map((data) => ({ type: "site", data })),
  ].toSorted((a, b) => timestamp(b.data) - timestamp(a.data));
  return combined[0] || null;
};

function AuditWorkspaceView({ client, clientId, refresh }) {
  const pageStore = readJson(PAGE_HISTORY_KEY, {});
  const siteStore = readJson(SITE_HISTORY_KEY, {});
  const pageHistory = Array.isArray(pageStore[clientId]) ? pageStore[clientId] : [];
  const siteHistory = normalizeAnalysisHistory(siteStore[clientId]);
  const [url, setUrl] = useState(client.url);
  const [mode, setMode] = useState("page");
  const [maxPages, setMaxPages] = useState(75);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedResult, setSelectedResult] = useState(() => latestSavedResult(pageHistory, siteHistory));
  const requestRef = useRef(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  const activeIssueEntries = (result) => {
    const all = Array.isArray(result?.issues) ? result.issues : [];
    return all
      .map((issue, index) => ({ issue, index, sourceUrl: issueUrl(issue, result, client) }))
      .filter((entry) => !isIssueResolved(clientId, entry.issue, entry.sourceUrl));
  };

  const savePageAudit = (result) => {
    const current = readJson(PAGE_HISTORY_KEY, {});
    writeJson(PAGE_HISTORY_KEY, { ...current, [clientId]: [result, ...(current[clientId] || [])].slice(0, 30) });
    refresh();
  };

  const saveSiteAudit = (result) => {
    const current = readJson(SITE_HISTORY_KEY, {});
    const previousHistory = normalizeAnalysisHistory(current[clientId]);
    const previous = previousHistory[0];
    const diff = analysisDiff(result, previous);
    const enriched = {
      ...result,
      ...diff,
      scoreDelta: previous?.score != null ? Number(result.score || 0) - previous.score : 0,
      hasPrevious: previous?.score != null,
    };
    writeJson(SITE_HISTORY_KEY, { ...current, [clientId]: [enriched, ...previousHistory].slice(0, 20) });

    const activeIssues = activeIssueEntries(enriched).map((entry) => entry.issue);
    const generated = tasksFromAnalysis({ ...enriched, issues: activeIssues }, client).map((task) => {
      const matchingIssue = activeIssues.find((issue) => issue.label === task.title && issueUrl(issue, enriched, client) === (task.targetUrl || client.url));
      return matchingIssue ? { ...task, issueKey: issueKey(matchingIssue, issueUrl(matchingIssue, enriched, client)) } : task;
    });
    const tasks = readJson(TASKS_KEY, []);
    const retained = tasks.filter((task) => !(
      task.sourceClientId === clientId &&
      String(task.id || "").startsWith("analysis-") &&
      task.kind !== "manual" &&
      task.status !== "Completato"
    ));
    writeJson(TASKS_KEY, [...retained, ...generated]);
    refresh();
    return enriched;
  };

  const createTask = (issue, resultType, result) => {
    const sourceUrl = issueUrl(issue, result, client);
    const key = issueKey(issue, sourceUrl);
    const tasks = readJson(TASKS_KEY, []);
    const duplicate = tasks.find((task) => task.sourceClientId === clientId && task.status !== "Completato" && (task.issueKey === key || (task.title === issue.label && (task.sourceUrl || task.targetUrl || "") === sourceUrl)));
    if (duplicate) return;
    const now = new Date().toISOString();
    const task = {
      id: `manual-${crypto.randomUUID()}`,
      issueKey: key,
      title: issue.label || "Correggi problema SEO",
      client: client.name,
      sourceClientId: clientId,
      priority: severityPriority(issue.severity),
      due: "Da pianificare",
      status: "Da fare",
      kind: issue.type || "audit",
      targetUrl: "",
      sourceUrl,
      linkLabel: "Apri pagina",
      detail: issue.detail || `Problema rilevato dall’audit ${resultType === "page" ? "pagina" : "sito"}.`,
      notes: "",
      createdAt: now,
      updatedAt: now,
    };
    writeJson(TASKS_KEY, [task, ...tasks]);
  };

  const openRemediation = (originalIssueIndex) => {
    window.dispatchEvent(new CustomEvent("seogrow-remediation-open", {
      detail: {
        clientId,
        issueIndex: originalIssueIndex,
        auditType: selectedResult?.type || "page",
        analyzedAt: selectedResult?.data?.analyzedAt || selectedResult?.data?.startedAt || "",
      },
    }));
  };

  const run = async (event) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    const controller = new AbortController();
    requestRef.current = controller;
    const startedAt = new Date().toISOString();
    try {
      const response = await fetch(mode === "page" ? "/api/audit" : "/api/site-analysis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "page" ? { url } : { url, maxPages }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Analisi non riuscita");
      const baseResult = { ...data, auditMode: mode, startedAt, analyzedAt: data.analyzedAt || new Date().toISOString() };
      const result = mode === "page" ? baseResult : saveSiteAudit(baseResult);
      if (mode === "page") savePageAudit(result);
      setSelectedResult({ type: mode, data: result });
    } catch (runError) {
      if (runError.message !== "Richiesta annullata.") setError(runError.message);
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      setLoading(false);
    }
  };

  const result = selectedResult?.data;
  const allIssues = Array.isArray(result?.issues) ? result.issues : [];
  const activeEntries = result ? activeIssueEntries(result) : [];
  const resolvedCount = Math.max(0, allIssues.length - activeEntries.length);
  const history = [
    ...pageHistory.map((item) => ({ type: "page", item })),
    ...siteHistory.map((item) => ({ type: "site", item })),
  ].toSorted((a, b) => timestamp(b.item) - timestamp(a.item));

  return (
    <div className="audit-enhancer-root">
      <div className="page-title"><div><h1>Audit SEO — {client.name}</h1><p>Analizza una singola pagina oppure l’intero sito. I risultati salvati restano riapribili dalla Cronologia audit.</p></div></div>

      <section className="panel audit-launcher">
        <div className="panel-head"><div><h2>Nuovo audit</h2><p>Scegli prima il tipo di controllo da eseguire.</p></div>{loading && <span className="live"><i />Analisi in corso</span>}</div>
        <div className="audit-mode-grid">
          <button type="button" className={`audit-mode-card ${mode === "page" ? "active" : ""}`} onClick={() => setMode("page")} disabled={loading}><FileText /><span><strong>Analizza questa pagina</strong><small>Controllo rapido dell’URL indicato</small></span></button>
          <button type="button" className={`audit-mode-card ${mode === "site" ? "active" : ""}`} onClick={() => setMode("site")} disabled={loading}><Globe2 /><span><strong>Analizza tutto il sito</strong><small>Crawl tecnico fino a 200 pagine</small></span></button>
        </div>
        <form className="site-analysis-form audit-inline-form" onSubmit={run}>
          <label>{mode === "page" ? "URL della pagina" : "Indirizzo iniziale del sito"}<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} required disabled={loading} /></label>
          {mode === "site" && <label>Numero massimo di pagine<select value={maxPages} onChange={(event) => setMaxPages(Number(event.target.value))} disabled={loading}><option value="25">25 — controllo rapido</option><option value="75">75 — consigliato</option><option value="150">150 — approfondito</option><option value="200">200 — massimo locale</option></select></label>}
          <div className="inline-actions"><button className="primary" disabled={loading}>{loading ? "Analisi in corso…" : mode === "page" ? "Analizza questa pagina" : "Analizza tutto il sito"}</button>{loading && <button type="button" className="secondary" onClick={() => requestRef.current?.abort()}>Interrompi</button>}</div>
          {error && <p className="error" role="alert">{error}</p>}
        </form>
      </section>

      <section className="panel history-list audit-history-panel">
        <div className="panel-head"><div><h2>Cronologia audit</h2><p>Riapri analisi pagina e crawl completi senza perderne i risultati.</p></div><span className="count-badge">{history.length}</span></div>
        <div className="table-scroll"><table><caption className="sr-only">Cronologia degli audit SEO</caption><thead><tr><th>Data</th><th>Tipo</th><th>URL</th><th>Pagine</th><th>Problemi</th><th>Azione</th></tr></thead><tbody>
          {history.map(({ type, item }, index) => {
            const active = activeIssueEntries(item).length;
            const total = Array.isArray(item.issues) ? item.issues.length : 0;
            return <tr key={`${type}-${item.analyzedAt || item.startedAt || index}`}><td>{new Date(item.analyzedAt || item.startedAt).toLocaleString("it-IT")}</td><td><span className={`audit-type ${type}`}>{type === "page" ? "Pagina" : "Sito completo"}</span></td><td><a href={item.url || client.url} target="_blank" rel="noreferrer">{item.url || client.url}</a></td><td>{type === "page" ? 1 : item.pagesChecked || 0}</td><td>{active} aperti / {total} rilevati</td><td><button className="secondary mini" onClick={() => setSelectedResult({ type, data: item })}>Apri risultati</button></td></tr>;
          })}
          {!history.length && <tr><td colSpan="6" className="empty-row">Nessun audit salvato per questo progetto.</td></tr>}
        </tbody></table></div>
      </section>

      {result && <div className="audit-results audit-persistent-results">
        <section className="score-panel"><div className="score-ring" style={{ "--score": `${Number(result.score || 0) * 3.6}deg` }}><span>{result.score ?? "—"}<small>/100</small></span></div><div><h2>{selectedResult.type === "page" ? "Risultato pagina" : "Risultato sito completo"}</h2><a href={result.url || client.url} target="_blank" rel="noreferrer">{result.url || client.url}</a><p>{activeEntries.length} problemi ancora da correggere · {resolvedCount} risolti dopo l’audit · {allIssues.length} rilevati in origine.</p></div></section>
        {activeEntries.length > 0 && <div className="gptsites-bulk-slot" />}
        <section className="panel issues audit-issues-list">
          <div className="panel-head"><div><h2>Problemi da correggere</h2><p>Questa lista contiene solo problemi ancora attivi. I risolti restano nello storico dell’audit e non vengono riproposti come Task.</p></div></div>
          {activeEntries.length ? activeEntries.map(({ issue, index, sourceUrl }) => <div key={`${issueKey(issue, sourceUrl)}-${index}`}><span className={`priority ${issue.severity || "media"}`}>{issue.severity || "media"}</span><strong>{issue.label}</strong><button type="button" className="primary mini audit-agent-action" onClick={() => openRemediation(index)}><Sparkles />Correggi con agente</button>{sourceUrl && <a className="task-link" href={sourceUrl} target="_blank" rel="noreferrer"><ExternalLink />Apri pagina</a>}<button type="button" className="secondary mini" onClick={() => createTask(issue, selectedResult.type, result)}>Crea task</button></div>) : <div className="success"><Check />Nessun problema attivo tra quelli controllati.</div>}
        </section>
        {selectedResult.type === "page" && <section className="panel audit-details"><h2>Controlli principali</h2><dl><div><dt>Title</dt><dd>{result.title || "Mancante"} <small>{result.titleLength ?? 0} caratteri</small></dd></div><div><dt>Meta description</dt><dd>{result.description || "Mancante"} <small>{result.descriptionLength ?? 0} caratteri</small></dd></div><div><dt>H1</dt><dd>{result.h1 || "Mancante"}</dd></div><div><dt>Canonical</dt><dd>{result.canonical || "Non rilevata"}</dd></div><div><dt>Immagini</dt><dd>{result.images || 0} totali · {result.missingAlt || 0} senza alt</dd></div></dl></section>}
      </div>}
    </div>
  );
}

export default function AuditWorkspaceV2() {
  const [version, setVersion] = useState(0);
  const [active, setActive] = useState(false);
  const [target, setTarget] = useState(null);
  const refresh = () => setVersion((value) => value + 1);

  useEffect(() => {
    const sync = () => {
      const page = currentPage();
      const main = document.querySelector(".workspace main");
      setActive(page === "Audit SEO" && Boolean(main));
      setTarget(main);
      if (main) main.classList.toggle("audit-workspace-active", page === "Audit SEO");
      setVersion((value) => value + 1);
    };
    const deferredSync = window.setTimeout(sync, 0);
    window.addEventListener("hashchange", sync);
    window.addEventListener("seogrow-locationchange", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.clearTimeout(deferredSync);
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("seogrow-locationchange", sync);
      window.removeEventListener("storage", sync);
      document.querySelector(".workspace main")?.classList.remove("audit-workspace-active");
    };
  }, []);

  if (!active || !target) return null;
  const clients = readJson("seogrow-clients", []);
  const selectedClientId = Number(readJson("seogrow-selected-client-v1", clients[0]?.id));
  const client = clients.find((item) => item.id === selectedClientId) || clients[0];
  if (!client) return null;
  return createPortal(<AuditWorkspaceView key={`${selectedClientId}-${version}`} client={client} clientId={selectedClientId} refresh={refresh} />, target);
}
