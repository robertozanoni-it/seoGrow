import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ExternalLink, FileText, Globe2, Sparkles } from "lucide-react";
import { apiFetch } from "./api";
import {
  analysisDiff,
  normalizeAnalysisHistory,
  tasksFromAnalysis,
} from "./platform";
import "./AuditWorkspace.css";

const fetch = apiFetch;
const PAGE_HISTORY_KEY = "seogrow-page-audit-history-v2";
const SITE_HISTORY_KEY = "seogrow-analyses-v2";
const TASKS_KEY = "seogrow-tasks-v2";

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
  window.dispatchEvent(
    new StorageEvent("storage", { key, newValue: serialized }),
  );
};

const severityPriority = (severity) => {
  const value = String(severity || "").toLowerCase();
  if (["alta", "high", "critical", "critica"].includes(value)) return "Alta";
  if (["bassa", "low"].includes(value)) return "Bassa";
  return "Media";
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
  const [selectedResult, setSelectedResult] = useState(
    pageHistory[0]
      ? { type: "page", data: pageHistory[0] }
      : siteHistory[0]
        ? { type: "site", data: siteHistory[0] }
        : null,
  );
  const requestRef = useRef(null);

  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => {
    setUrl(client.url);
  }, [client.url, clientId]);

  const savePageAudit = (result) => {
    const current = readJson(PAGE_HISTORY_KEY, {});
    writeJson(PAGE_HISTORY_KEY, {
      ...current,
      [clientId]: [result, ...(current[clientId] || [])].slice(0, 30),
    });
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
      scoreDelta:
        previous?.score != null ? Number(result.score || 0) - previous.score : 0,
      hasPrevious: previous?.score != null,
    };
    writeJson(SITE_HISTORY_KEY, {
      ...current,
      [clientId]: [enriched, ...previousHistory].slice(0, 20),
    });

    const generated = tasksFromAnalysis(enriched, client);
    const tasks = readJson(TASKS_KEY, []);
    const retained = tasks.filter(
      (task) =>
        !(
          task.sourceClientId === clientId &&
          String(task.id || "").startsWith("analysis-") &&
          task.kind !== "manual" &&
          task.status !== "Completato"
        ),
    );
    writeJson(TASKS_KEY, [...retained, ...generated]);
    refresh();
    return enriched;
  };

  const createTask = (issue, resultType, result) => {
    const issueUrl = issue.targetUrl || issue.url || result.url || client.url;
    const tasks = readJson(TASKS_KEY, []);
    const title = issue.label || "Correggi problema SEO";
    const duplicate = tasks.find(
      (task) =>
        task.sourceClientId === clientId &&
        task.status !== "Completato" &&
        task.title === title &&
        (task.sourceUrl || "") === issueUrl,
    );
    if (duplicate) return;
    const task = {
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title,
      client: client.name,
      sourceClientId: clientId,
      priority: severityPriority(issue.severity),
      due: "",
      status: "Da fare",
      kind: issue.type || "audit",
      targetUrl: "",
      sourceUrl: issueUrl,
      linkLabel: "Apri pagina",
      detail:
        issue.detail ||
        `Problema rilevato dall’audit ${resultType === "page" ? "pagina" : "sito"}.`,
      notes: "",
      createdAt: new Date().toISOString(),
    };
    writeJson(TASKS_KEY, [task, ...tasks]);
  };

  const openRemediation = (issueIndex) => {
    window.dispatchEvent(
      new CustomEvent("seogrow-remediation-open", {
        detail: {
          clientId,
          issueIndex,
          auditType: selectedResult?.type || "page",
          analyzedAt:
            selectedResult?.data?.analyzedAt ||
            selectedResult?.data?.startedAt ||
            "",
        },
      }),
    );
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
      const response = await fetch(
        mode === "page" ? "/api/audit" : "/api/site-analysis",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            mode === "page" ? { url } : { url, maxPages },
          ),
          signal: controller.signal,
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Analisi non riuscita");
      const baseResult = {
        ...data,
        auditMode: mode,
        startedAt,
        analyzedAt: data.analyzedAt || new Date().toISOString(),
      };
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
  const issues = Array.isArray(result?.issues) ? result.issues : [];
  const history = useMemo(
    () =>
      [
        ...pageHistory.map((item) => ({ type: "page", item })),
        ...siteHistory.map((item) => ({ type: "site", item })),
      ].toSorted(
        (a, b) =>
          Date.parse(b.item.analyzedAt || b.item.startedAt || 0) -
          Date.parse(a.item.analyzedAt || a.item.startedAt || 0),
      ),
    [pageHistory, siteHistory],
  );

  return (
    <div className="audit-enhancer-root">
      <div className="page-title">
        <div>
          <h1>Audit SEO — {client.name}</h1>
          <p>
            Analizza una singola pagina oppure l’intero sito. Ogni risultato resta salvato e riapribile dalla Cronologia audit.
          </p>
        </div>
      </div>

      <section className="panel audit-launcher">
        <div className="panel-head">
          <div>
            <h2>Nuovo audit</h2>
            <p>Scegli prima il tipo di controllo da eseguire.</p>
          </div>
          {loading && <span className="live"><i />Analisi in corso</span>}
        </div>
        <div className="audit-mode-grid">
          <button
            type="button"
            className={`audit-mode-card ${mode === "page" ? "active" : ""}`}
            onClick={() => setMode("page")}
            disabled={loading}
          >
            <FileText />
            <span><strong>Analizza questa pagina</strong><small>Controllo rapido dell’URL indicato</small></span>
          </button>
          <button
            type="button"
            className={`audit-mode-card ${mode === "site" ? "active" : ""}`}
            onClick={() => setMode("site")}
            disabled={loading}
          >
            <Globe2 />
            <span><strong>Analizza tutto il sito</strong><small>Crawl tecnico fino a 200 pagine</small></span>
          </button>
        </div>
        <form className="site-analysis-form audit-inline-form" onSubmit={run}>
          <label>
            {mode === "page" ? "URL della pagina" : "Indirizzo iniziale del sito"}
            <input type="url" value={url} onChange={(event) => setUrl(event.target.value)} required disabled={loading} />
          </label>
          {mode === "site" && (
            <label>
              Numero massimo di pagine
              <select value={maxPages} onChange={(event) => setMaxPages(Number(event.target.value))} disabled={loading}>
                <option value="25">25 — controllo rapido</option>
                <option value="75">75 — consigliato</option>
                <option value="150">150 — approfondito</option>
                <option value="200">200 — massimo locale</option>
              </select>
            </label>
          )}
          <div className="inline-actions">
            <button className="primary" disabled={loading}>
              {loading ? "Analisi in corso…" : mode === "page" ? "Analizza questa pagina" : "Analizza tutto il sito"}
            </button>
            {loading && <button type="button" className="secondary" onClick={() => requestRef.current?.abort()}>Interrompi</button>}
          </div>
          {error && <p className="error" role="alert">{error}</p>}
        </form>
      </section>

      <section className="panel history-list audit-history-panel">
        <div className="panel-head">
          <div><h2>Cronologia audit</h2><p>Riapri analisi pagina e crawl completi senza perderne i risultati.</p></div>
          <span className="count-badge">{history.length}</span>
        </div>
        <div className="table-scroll">
          <table>
            <caption className="sr-only">Cronologia degli audit SEO</caption>
            <thead><tr><th>Data</th><th>Tipo</th><th>URL</th><th>Pagine</th><th>Problemi</th><th>Azione</th></tr></thead>
            <tbody>
              {history.map(({ type, item }, index) => (
                <tr key={`${type}-${item.analyzedAt || item.startedAt || index}`}>
                  <td>{new Date(item.analyzedAt || item.startedAt).toLocaleString("it-IT")}</td>
                  <td><span className={`audit-type ${type}`}>{type === "page" ? "Pagina" : "Sito completo"}</span></td>
                  <td><a href={item.url || client.url} target="_blank" rel="noreferrer">{item.url || client.url}</a></td>
                  <td>{type === "page" ? 1 : item.pagesChecked || 0}</td>
                  <td>{Array.isArray(item.issues) ? item.issues.length : 0}</td>
                  <td><button className="secondary mini" onClick={() => setSelectedResult({ type, data: item })}>Apri risultati</button></td>
                </tr>
              ))}
              {!history.length && <tr><td colSpan="6" className="empty-row">Nessun audit salvato per questo progetto.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {result && (
        <div className="audit-results audit-persistent-results">
          <section className="score-panel">
            <div className="score-ring" style={{ "--score": `${Number(result.score || 0) * 3.6}deg` }}>
              <span>{result.score ?? "—"}<small>/100</small></span>
            </div>
            <div>
              <h2>{selectedResult.type === "page" ? "Risultato pagina" : "Risultato sito completo"}</h2>
              <a href={result.url || client.url} target="_blank" rel="noreferrer">{result.url || client.url}</a>
              <p>{selectedResult.type === "site" ? `${result.pagesChecked || 0} pagine · ${result.linksChecked || 0} link controllati · ${issues.length} problemi.` : `${issues.length} elementi richiedono attenzione.`}</p>
            </div>
          </section>

          <section className="panel issues audit-issues-list">
            <div className="panel-head">
              <div>
                <h2>Problemi rilevati</h2>
                <p>Correggi direttamente con l’agente del progetto oppure crea una Task solo se vuoi inserirlo nel backlog.</p>
              </div>
            </div>
            {issues.length ? issues.map((issue, index) => {
              const issueUrl = issue.targetUrl || issue.url || result.url || client.url;
              return (
                <div key={`${issue.type || issue.label}-${issueUrl}-${index}`}>
                  <span className={`priority ${issue.severity || "media"}`}>{issue.severity || "media"}</span>
                  <strong>{issue.label}</strong>
                  <button
                    type="button"
                    className="primary mini audit-agent-action"
                    onClick={() => openRemediation(index)}
                  >
                    <Sparkles />Correggi con agente
                  </button>
                  {issueUrl && <a className="task-link" href={issueUrl} target="_blank" rel="noreferrer"><ExternalLink />Apri pagina</a>}
                  <button type="button" className="secondary mini" onClick={() => createTask(issue, selectedResult.type, result)}>Crea task</button>
                </div>
              );
            }) : <div className="success"><Check />Nessun problema tra quelli controllati.</div>}
          </section>

          {selectedResult.type === "page" && (
            <section className="panel audit-details">
              <h2>Controlli principali</h2>
              <dl>
                <div><dt>Title</dt><dd>{result.title || "Mancante"} <small>{result.titleLength ?? 0} caratteri</small></dd></div>
                <div><dt>Meta description</dt><dd>{result.description || "Mancante"} <small>{result.descriptionLength ?? 0} caratteri</small></dd></div>
                <div><dt>H1</dt><dd>{result.h1 || "Mancante"}</dd></div>
                <div><dt>Canonical</dt><dd>{result.canonical || "Non rilevata"}</dd></div>
                <div><dt>Immagini</dt><dd>{result.images || 0} totali · {result.missingAlt || 0} senza alt</dd></div>
              </dl>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

export default function AuditWorkspace() {
  const [version, setVersion] = useState(0);
  const [active, setActive] = useState(false);
  const [target, setTarget] = useState(null);
  const refresh = () => setVersion((value) => value + 1);

  useEffect(() => {
    const sync = () => {
      let page = "";
      try { page = decodeURIComponent(window.location.hash.slice(1)); } catch { page = ""; }
      const main = document.querySelector(".workspace main");
      setActive(page === "Audit SEO" && Boolean(main));
      setTarget(main);
      if (main) main.classList.toggle("audit-workspace-active", page === "Audit SEO");
      refresh();
    };
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("seogrow-locationchange", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("seogrow-locationchange", sync);
      document.querySelector(".workspace main")?.classList.remove("audit-workspace-active");
    };
  }, []);

  if (!active || !target) return null;
  const clients = readJson("seogrow-clients", []);
  const selectedClientId = Number(readJson("seogrow-selected-client-v1", clients[0]?.id));
  const client = clients.find((item) => item.id === selectedClientId) || clients[0];
  if (!client) return null;

  return createPortal(
    <AuditWorkspaceView key={`${selectedClientId}-${version}`} client={client} clientId={selectedClientId} refresh={refresh} />,
    target,
  );
}
