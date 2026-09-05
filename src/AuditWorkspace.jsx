import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  FileText,
  Globe2,
  ListChecks,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { apiFetch } from "./api";
import {
  analysisDiff,
  normalizeAnalysisHistory,
  tasksFromAnalysis,
} from "./platform";
import {
  issueCorrectability,
  issueIdentity,
  latestAudit,
  normalizeClientId,
  normalizeHttpUrl,
  safeHttpHref,
} from "./reliabilityModel";
import { normalizeSiteAnalysis } from "./seoResponseIntegrity";
import "./AuditWorkspace.css";

const PAGE_HISTORY_KEY = "seogrow-page-audit-history-v2";
const SITE_HISTORY_KEY = "seogrow-analyses-v2";
const TASKS_KEY = "seogrow-tasks-v2";
const FOCUS_KEY = "seogrow-remediation-focus-v1";
const AGENT_PREFILL_KEY = "seogrow-agent-prefill-v1";

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};

const writeJson = (key, value) => {
  const serialized = JSON.stringify(value);
  localStorage.setItem(key, serialized);
  window.dispatchEvent(new StorageEvent("storage", { key, newValue: serialized }));
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

const resultTimestamp = (item) => item?.analyzedAt || item?.startedAt || "";
const resultSourceUrl = (issue, result, client) => issue?.targetUrl || issue?.url || result?.url || client?.url || "";

const pageKindFromUrl = (value) => {
  try {
    const first = new URL(value).pathname.toLowerCase().split("/").filter(Boolean)[0] || "";
    if (/^(?:category|categoria|tag|author|autore|date|page)$/.test(first)) return "archive";
    if (/^(?:contatti?|contact|contacts)$/.test(first)) return "utility";
    return "content";
  } catch { return "unknown"; }
};

const taskIssueKey = (task) => issueIdentity({
  issueType: task?.kind,
  issueLabel: task?.title,
  sourceUrl: task?.sourceUrl || task?.targetUrl || "",
});

function AuditWorkspaceView({ client, clientId, refresh }) {
  const pageStore = readJson(PAGE_HISTORY_KEY, {});
  const siteStore = readJson(SITE_HISTORY_KEY, {});
  const pageHistory = Array.isArray(pageStore[clientId]) ? pageStore[clientId] : [];
  const siteHistory = normalizeAnalysisHistory(siteStore[clientId]).map((item) => normalizeSiteAnalysis({ ...item }));
  const history = [
    ...pageHistory.map((item) => ({ type: "page", item: normalizeSiteAnalysis({ ...item }) })),
    ...siteHistory.map((item) => ({ type: "site", item })),
  ].toSorted((a, b) => Date.parse(resultTimestamp(b.item) || 0) - Date.parse(resultTimestamp(a.item) || 0));
  const initial = latestAudit(history);

  const [url, setUrl] = useState(client.url);
  const [mode, setMode] = useState("page");
  const [maxPages, setMaxPages] = useState(75);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedResult, setSelectedResult] = useState(initial ? { type: initial.type, data: initial.item } : null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const requestRef = useRef(null);

  useEffect(() => () => requestRef.current?.abort(), []);

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
      scoreDelta: previous?.score != null ? Number(result.score || 0) - Number(previous.score || 0) : 0,
      hasPrevious: previous?.score != null,
    };
    writeJson(SITE_HISTORY_KEY, {
      ...current,
      [clientId]: [enriched, ...previousHistory].slice(0, 20),
    });

    const generated = tasksFromAnalysis(enriched, client);
    const tasks = readJson(TASKS_KEY, []);
    const generatedKeys = new Set(generated.map(taskIssueKey));
    const retained = tasks.filter((task) => {
      if (normalizeClientId(task.sourceClientId) !== normalizeClientId(clientId)) return true;
      if (!String(task.id || "").startsWith("analysis-") || task.kind === "manual" || task.status === "Completato") return true;
      return !generatedKeys.has(taskIssueKey(task));
    });
    const existingKeys = new Set(retained.map(taskIssueKey));
    writeJson(TASKS_KEY, [...retained, ...generated.filter((task) => !existingKeys.has(taskIssueKey(task)))]);
    refresh();
    return enriched;
  };

  const createTask = (issue, resultType, result) => {
    const sourceUrl = resultSourceUrl(issue, result, client);
    const tasks = readJson(TASKS_KEY, []);
    const title = issue.label || "Correggi problema SEO";
    const issueKey = issueIdentity({ issueType: issue.type, issueLabel: title, sourceUrl, issue });
    const duplicate = tasks.find((task) =>
      normalizeClientId(task.sourceClientId) === normalizeClientId(clientId) &&
      task.status !== "Completato" &&
      taskIssueKey(task) === issueKey,
    );
    if (duplicate) return;
    const task = {
      id: `manual-${crypto.randomUUID()}`,
      title,
      client: client.name,
      sourceClientId: clientId,
      priority: severityPriority(issue.severity),
      due: "",
      status: "Da fare",
      kind: issue.type || "audit",
      targetUrl: "",
      sourceUrl,
      linkLabel: "Apri pagina",
      detail: issue.detail || `Problema rilevato dall’audit ${resultType === "page" ? "pagina" : "sito"}.`,
      notes: "",
      createdAt: new Date().toISOString(),
    };
    writeJson(TASKS_KEY, [task, ...tasks]);
  };

  const openRemediation = (issueIndex, targetResult = selectedResult) => {
    window.dispatchEvent(new CustomEvent("seogrow-remediation-open", {
      detail: {
        clientId,
        issueIndex,
        auditType: targetResult?.type || "page",
        analyzedAt: resultTimestamp(targetResult?.data),
      },
    }));
  };

  const locateFocusedIssue = (request) => {
    if (!request || normalizeClientId(request.clientId) !== normalizeClientId(clientId)) return false;
    const wantedType = String(request.issueType || "").toLowerCase();
    const wantedUrl = normalizeHttpUrl(request.sourceUrl || "", { stripSlash: false });
    for (const entry of history) {
      const issues = Array.isArray(entry.item?.issues) ? entry.item.issues : [];
      const index = issues.findIndex((issue) => {
        const typeMatches = !wantedType || String(issue?.type || "").toLowerCase() === wantedType;
        const issueUrl = normalizeHttpUrl(resultSourceUrl(issue, entry.item, client), { stripSlash: false });
        return typeMatches && (!wantedUrl || wantedUrl === issueUrl);
      });
      if (index >= 0) {
        const target = { type: entry.type, data: entry.item };
        setSelectedResult(target);
        window.setTimeout(() => openRemediation(index, target), 0);
        return true;
      }
    }
    return false;
  };

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(FOCUS_KEY);
      if (raw) {
        const request = JSON.parse(raw);
        if (locateFocusedIssue(request)) sessionStorage.removeItem(FOCUS_KEY);
      }
    } catch { sessionStorage.removeItem(FOCUS_KEY); }
    const onFocus = (event) => locateFocusedIssue(event.detail);
    window.addEventListener("seogrow-remediation-focus", onFocus);
    return () => window.removeEventListener("seogrow-remediation-focus", onFocus);
  }, [clientId]);

  const askAgent = (issue, result) => {
    const detail = {
      clientId,
      title: issue.label || issue.type || "Problema SEO",
      sourceUrl: resultSourceUrl(issue, result, client),
      problemState: issue.diagnosisState || "confirmed",
      evidence: [{ source: "Audit SeoGrow", detail: issue.detail || issue.label || "", at: resultTimestamp(result) }],
      detail: issue.detail || "",
    };
    sessionStorage.setItem(AGENT_PREFILL_KEY, JSON.stringify(detail));
    const next = `#${encodeURIComponent("SEO Agent")}`;
    window.history.pushState(null, "", next);
    window.dispatchEvent(new CustomEvent("seogrow-locationchange"));
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("seogrow-agent-prefill", { detail })), 0);
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
      const response = await apiFetch(mode === "page" ? "/api/audit" : "/api/site-analysis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "page" ? { url } : { url, maxPages }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Analisi non riuscita");
      const normalized = normalizeSiteAnalysis({
        ...data,
        auditMode: mode,
        startedAt,
        analyzedAt: data.analyzedAt || new Date().toISOString(),
      });
      const result = mode === "page" ? normalized : saveSiteAudit(normalized);
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
  const reviewItems = Array.isArray(result?.reviewItems) ? result.reviewItems : [];
  const actionable = issues.filter((issue) => ["automatic", "assisted"].includes(issueCorrectability(issue, { pageKind: pageKindFromUrl(resultSourceUrl(issue, result, client)) })));
  const manualCount = issues.length - actionable.length;

  return (
    <div className="audit-enhancer-root">
      <div className="page-title">
        <div>
          <h1>Audit SEO — {client.name}</h1>
          <p>Analizza una pagina o il sito. I problemi confermati restano separati dai segnali che richiedono interpretazione.</p>
        </div>
        <button type="button" className="secondary" onClick={() => {
          window.history.pushState(null, "", `#${encodeURIComponent("Problemi")}`);
          window.dispatchEvent(new CustomEvent("seogrow-locationchange"));
        }}><ListChecks /> Centro Problemi</button>
      </div>

      <section className="panel audit-launcher">
        <div className="panel-head">
          <div><h2>Nuovo audit</h2><p>Scegli il perimetro prima di avviare il controllo.</p></div>
          {loading && <span className="live"><i />Analisi in corso</span>}
        </div>
        <div className="audit-mode-grid">
          <button type="button" className={`audit-mode-card ${mode === "page" ? "active" : ""}`} onClick={() => setMode("page")} disabled={loading}>
            <FileText /><span><strong>Analizza questa pagina</strong><small>Controllo rapido dell’URL indicato</small></span>
          </button>
          <button type="button" className={`audit-mode-card ${mode === "site" ? "active" : ""}`} onClick={() => setMode("site")} disabled={loading}>
            <Globe2 /><span><strong>Analizza tutto il sito</strong><small>Crawl tecnico fino a 200 pagine</small></span>
          </button>
        </div>
        <form className="site-analysis-form audit-inline-form" onSubmit={run}>
          <label>{mode === "page" ? "URL della pagina" : "Indirizzo iniziale del sito"}<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} required disabled={loading} /></label>
          {mode === "site" && <label>Numero massimo di pagine<select value={maxPages} onChange={(event) => setMaxPages(Number(event.target.value))} disabled={loading}><option value="25">25 — controllo rapido</option><option value="75">75 — consigliato</option><option value="150">150 — approfondito</option><option value="200">200 — massimo locale</option></select></label>}
          <div className="inline-actions"><button className="primary" disabled={loading}>{loading ? "Analisi in corso…" : mode === "page" ? "Analizza questa pagina" : "Analizza tutto il sito"}</button>{loading && <button type="button" className="secondary" onClick={() => requestRef.current?.abort()}>Interrompi</button>}</div>
          {error && <p className="error" role="alert">{error}</p>}
        </form>
      </section>

      <section className="panel audit-history-panel audit-history-collapsible">
        <div className="panel-head">
          <div><h2>Cronologia audit</h2><p>Conservazione locale: fino a 30 audit pagina e 20 crawl sito per progetto.</p></div>
          <button type="button" className="secondary mini" aria-expanded={historyOpen} onClick={() => setHistoryOpen((value) => !value)}>{historyOpen ? "Nascondi" : `Mostra (${history.length})`}</button>
        </div>
        {historyOpen && <div className="table-scroll"><table><caption className="sr-only">Cronologia audit SEO</caption><thead><tr><th>Data</th><th>Tipo</th><th>URL</th><th>Pagine</th><th>Confermati</th><th>Da confermare</th><th>Azione</th></tr></thead><tbody>{history.map(({ type, item }, index) => <tr key={`${type}-${resultTimestamp(item) || index}`}><td>{new Date(resultTimestamp(item)).toLocaleString("it-IT")}</td><td><span className={`audit-type ${type}`}>{type === "page" ? "Pagina" : "Sito completo"}</span></td><td>{safeHttpHref(item.url || client.url) ? <a href={safeHttpHref(item.url || client.url)} target="_blank" rel="noreferrer">{item.url || client.url}</a> : item.url || client.url}</td><td>{type === "page" ? 1 : item.pagesChecked || 0}</td><td>{Array.isArray(item.issues) ? item.issues.length : 0}</td><td>{Array.isArray(item.reviewItems) ? item.reviewItems.length : 0}</td><td><button className="secondary mini" onClick={() => setSelectedResult({ type, data: item })}>Apri</button></td></tr>)}{!history.length && <tr><td colSpan="7" className="empty-row">Nessun audit salvato per questo progetto.</td></tr>}</tbody></table></div>}
      </section>

      {result && <div className="audit-results audit-persistent-results">
        <section className="score-panel audit-truth-score">
          <div className="score-ring" style={{ "--score": `${Number(result.score || 0) * 3.6}deg` }}><span>{result.score ?? "—"}<small>/100</small></span></div>
          <div><span className="audit-derived-label"><ShieldCheck /> Indice interno SeoGrow</span><h2>{result.scoreLabel || "Indice di salute tecnica SeoGrow"}</h2>{safeHttpHref(result.url || client.url) && <a href={safeHttpHref(result.url || client.url)} target="_blank" rel="noreferrer">{result.url || client.url}</a>}<p>{result.scoreMethodology || "Indice derivato dai controlli SeoGrow; non è un voto Google."}</p></div>
        </section>

        <section className="audit-result-summary" aria-label="Riepilogo risultati">
          <div><small>Problemi confermati</small><strong>{issues.length}</strong><span>inclusi nello score</span></div>
          <div><small>Da confermare</small><strong>{reviewItems.length}</strong><span>non penalizzano lo score</span></div>
          <div><small>Preparabili</small><strong>{actionable.length}</strong><span>automatici o assistiti</span></div>
          <div><small>Manuali / non supportati</small><strong>{manualCount}</strong><span>nessuna falsa CTA automatica</span></div>
        </section>

        {actionable.length > 0 && <div className="gptsites-bulk-slot" />}

        <section className="panel issues audit-issues-list">
          <div className="panel-head"><div><h2>Problemi confermati</h2><p>Le azioni cambiano in base alla correggibilità reale del problema.</p></div></div>
          {issues.length ? issues.map((issue, index) => {
            const sourceUrl = resultSourceUrl(issue, result, client);
            const correctability = issueCorrectability(issue, { pageKind: pageKindFromUrl(sourceUrl) });
            const href = safeHttpHref(sourceUrl);
            return <div key={issueIdentity({ issueType: issue.type, issueLabel: issue.label, sourceUrl, issue })}>
              <span className={`priority ${issue.severity || "media"}`}>{issue.severity || "media"}</span>
              <strong>{issue.label}</strong>
              {["automatic", "assisted"].includes(correctability) ? <button type="button" className="primary mini audit-agent-action" onClick={() => openRemediation(index)}><Sparkles />{correctability === "automatic" ? "Prepara correzione" : "Esamina e prepara"}</button> : <button type="button" className="secondary mini" onClick={() => askAgent(issue, result)}><Sparkles />Apri guida</button>}
              {href && <a className="task-link" href={href} target="_blank" rel="noreferrer"><ExternalLink />Apri pagina</a>}
              <button type="button" className="secondary mini" onClick={() => createTask(issue, selectedResult.type, result)}>Crea task</button>
              <small className="audit-correctability-note">Correggibilità: {correctability === "automatic" ? "automatica con approvazione" : correctability === "assisted" ? "assistita" : correctability === "manual" ? "manuale" : "non supportata"}</small>
            </div>;
          }) : <div className="success"><Check />Nessun problema confermato tra quelli controllati.</div>}
        </section>

        {reviewItems.length > 0 && <section className="panel audit-review-items">
          <div className="panel-head"><div><h2>Da confermare prima di correggere</h2><p>Canonical, noindex e altri segnali contestuali non vengono trattati automaticamente come errori.</p></div><span className="count-badge">{reviewItems.length}</span></div>
          {reviewItems.map((issue) => {
            const sourceUrl = resultSourceUrl(issue, result, client);
            const href = safeHttpHref(sourceUrl);
            return <article key={issueIdentity({ issueType: issue.type, issueLabel: issue.label, sourceUrl, issue })} className="audit-review-row"><AlertTriangle /><div><strong>{issue.label}</strong><p>{issue.reviewReason || issue.detail || "Serve una verifica del contesto."}</p><small>Segnale osservato · non incluso nello score come problema confermato</small></div><div className="inline-actions">{href && <a className="secondary mini" href={href} target="_blank" rel="noreferrer">Apri pagina</a>}<button type="button" className="secondary mini" onClick={() => askAgent(issue, result)}>Esamina configurazione</button><button type="button" className="secondary mini" onClick={() => createTask(issue, selectedResult.type, result)}>Crea task</button></div></article>;
          })}
        </section>}

        {selectedResult.type === "page" && <section className="panel audit-details"><h2>Controlli principali</h2><dl><div><dt>Title</dt><dd>{result.title || "Mancante"} <small>{result.titleLength ?? 0} caratteri</small></dd></div><div><dt>Meta description</dt><dd>{result.description || "Mancante"} <small>{result.descriptionLength ?? 0} caratteri</small></dd></div><div><dt>H1</dt><dd>{result.h1 || "Mancante"}</dd></div><div><dt>Canonical</dt><dd>{result.canonical || "Non rilevata"}</dd></div><div><dt>Immagini</dt><dd>{result.images || 0} totali · {result.missingAlt || 0} senza alt</dd></div></dl></section>}
      </div>}
    </div>
  );
}

export default function AuditWorkspace() {
  const [version, setVersion] = useState(0);
  const [active, setActive] = useState(false);
  const [target, setTarget] = useState(null);
  const refresh = () => setVersion((value) => value + 1);

  useEffect(() => {
    let frame = 0;
    let attempts = 0;
    const sync = () => {
      const page = currentPage();
      const main = document.querySelector(".workspace main");
      if (!main && attempts < 120) {
        attempts += 1;
        frame = window.requestAnimationFrame(sync);
        return;
      }
      setActive(page === "Audit SEO" && Boolean(main));
      setTarget(main);
      if (main) main.classList.toggle("audit-workspace-active", page === "Audit SEO");
      setVersion((value) => value + 1);
    };
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    window.addEventListener("seogrow-locationchange", sync);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
      window.removeEventListener("seogrow-locationchange", sync);
      document.querySelector(".workspace main")?.classList.remove("audit-workspace-active");
    };
  }, []);

  if (!active || !target) return null;
  const clients = readJson("seogrow-clients", []);
  const selectedClientId = normalizeClientId(readJson("seogrow-selected-client-v1", null));
  const client = clients.find((item) => normalizeClientId(item?.id) === selectedClientId) || null;
  if (!client) return createPortal(<div className="audit-enhancer-root"><section className="panel" role="alert"><h2>Seleziona un progetto</h2><p>L’audit non usa più un fallback silenzioso sul primo cliente.</p></section></div>, target);

  return createPortal(<AuditWorkspaceView key={`${selectedClientId}-${version}`} client={client} clientId={selectedClientId} refresh={refresh} />, target);
}
