import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CircleGauge,
  ExternalLink,
  FileText,
  Globe2,
  RefreshCw,
} from "lucide-react";
import { apiFetch } from "./api";

const fetch = apiFetch;

const severityPriority = (severity) =>
  String(severity || "").toLowerCase() === "alta"
    ? "Alta"
    : String(severity || "").toLowerCase() === "bassa"
      ? "Bassa"
      : "Media";

const normalizePageAudits = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value && typeof value === "object" ? [value] : [];
};

export default function AuditWorkspace({
  client,
  pageAudits,
  siteHistory,
  onSavePageAudit,
  onCompleteSiteAnalysis,
  onCreateTask,
  onOpenTasks,
}) {
  const pageHistory = useMemo(() => normalizePageAudits(pageAudits), [pageAudits]);
  const crawlHistory = useMemo(
    () => (Array.isArray(siteHistory) ? siteHistory.filter(Boolean) : []),
    [siteHistory],
  );
  const [url, setUrl] = useState(client.url);
  const [mode, setMode] = useState("page");
  const [maxPages, setMaxPages] = useState(75);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedResult, setSelectedResult] = useState(
    pageHistory[0] ? { type: "page", data: pageHistory[0] } : crawlHistory[0] ? { type: "site", data: crawlHistory[0] } : null,
  );
  const requestRef = useRef(null);

  const run = async (event) => {
    event?.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    const controller = new AbortController();
    requestRef.current = controller;
    const startedAt = new Date().toISOString();
    try {
      const endpoint = mode === "page" ? "/api/audit" : "/api/site-analysis";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          mode === "page" ? { url } : { url, maxPages },
        ),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Analisi non riuscita");
      const result = {
        ...data,
        auditMode: mode,
        startedAt,
        analyzedAt: data.analyzedAt || new Date().toISOString(),
      };
      if (mode === "page") onSavePageAudit(result);
      else onCompleteSiteAnalysis(result);
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

  return (
    <>
      <div className="page-title">
        <div>
          <h1>Audit SEO — {client.name}</h1>
          <p>
            Scegli chiaramente se analizzare una sola pagina oppure eseguire il crawl dell’intero sito. I risultati restano disponibili nello storico.
          </p>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Nuovo audit</h2>
            <p>La scelta del tipo di analisi è separata prima dell’avvio.</p>
          </div>
          {loading && <span className="live"><i />Analisi in corso</span>}
        </div>

        <div className="tabs" role="tablist" aria-label="Tipo di audit">
          <button
            type="button"
            className={mode === "page" ? "active" : ""}
            onClick={() => setMode("page")}
            disabled={loading}
          >
            <FileText />
            Analizza questa pagina
          </button>
          <button
            type="button"
            className={mode === "site" ? "active" : ""}
            onClick={() => setMode("site")}
            disabled={loading}
          >
            <Globe2 />
            Analizza tutto il sito
          </button>
        </div>

        <form className="site-analysis-form" onSubmit={run}>
          <label>
            {mode === "page" ? "URL della pagina" : "Indirizzo iniziale del sito"}
            <input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              required
              disabled={loading}
            />
          </label>

          {mode === "site" && (
            <label>
              Numero massimo di pagine
              <select
                value={maxPages}
                onChange={(event) => setMaxPages(Number(event.target.value))}
                disabled={loading}
              >
                <option value="25">25 — controllo rapido</option>
                <option value="75">75 — consigliato</option>
                <option value="150">150 — approfondito</option>
                <option value="200">200 — massimo locale</option>
              </select>
            </label>
          )}

          {mode === "site" && (
            <p>
              Controlla metadati, H1, canonical, noindex, immagini, contenuti brevi, profondità, duplicati, sitemap e link interni.
            </p>
          )}

          <div className="inline-actions">
            <button className="primary" disabled={loading}>
              {loading
                ? "Analisi in corso…"
                : mode === "page"
                  ? "Analizza questa pagina"
                  : "Analizza tutto il sito"}
            </button>
            {loading && (
              <button
                type="button"
                className="secondary"
                onClick={() => requestRef.current?.abort()}
              >
                Interrompi
              </button>
            )}
          </div>
          {error && <p className="error" role="alert">{error}</p>}
        </form>
      </section>

      <section className="panel history-list">
        <div className="panel-head">
          <div>
            <h2>Cronologia audit</h2>
            <p>Riapri in qualsiasi momento le analisi già completate.</p>
          </div>
          <span className="count-badge">{pageHistory.length + crawlHistory.length}</span>
        </div>
        <div className="table-scroll">
          <table>
            <caption className="sr-only">Cronologia degli audit SEO</caption>
            <thead>
              <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th>URL</th>
                <th>Pagine</th>
                <th>Problemi</th>
                <th>Azione</th>
              </tr>
            </thead>
            <tbody>
              {[
                ...pageHistory.map((item) => ({ type: "page", item })),
                ...crawlHistory.map((item) => ({ type: "site", item })),
              ]
                .toSorted(
                  (a, b) =>
                    Date.parse(b.item.analyzedAt || b.item.startedAt || 0) -
                    Date.parse(a.item.analyzedAt || a.item.startedAt || 0),
                )
                .map(({ type, item }, index) => (
                  <tr key={`${type}-${item.analyzedAt || item.startedAt || index}`}>
                    <td>{new Date(item.analyzedAt || item.startedAt).toLocaleString("it-IT")}</td>
                    <td>{type === "page" ? "Pagina" : "Sito completo"}</td>
                    <td>
                      <a href={item.url || client.url} target="_blank" rel="noreferrer">
                        {item.url || client.url}
                      </a>
                    </td>
                    <td>{type === "page" ? 1 : item.pagesChecked || 0}</td>
                    <td>{Array.isArray(item.issues) ? item.issues.length : 0}</td>
                    <td>
                      <button
                        className="secondary mini"
                        onClick={() => setSelectedResult({ type, data: item })}
                      >
                        Apri risultati
                      </button>
                    </td>
                  </tr>
                ))}
              {!pageHistory.length && !crawlHistory.length && (
                <tr>
                  <td colSpan="6" className="empty-row">Nessun audit salvato per questo progetto.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {result && (
        <div className="audit-results">
          <section className="score-panel">
            <div
              className="score-ring"
              style={{ "--score": `${Number(result.score || 0) * 3.6}deg` }}
            >
              <span>{result.score ?? "—"}<small>/100</small></span>
            </div>
            <div>
              <h2>{selectedResult.type === "page" ? "Risultato pagina" : "Risultato sito completo"}</h2>
              <a href={result.url || client.url} target="_blank" rel="noreferrer">
                {result.url || client.url}
              </a>
              <p>
                {selectedResult.type === "site"
                  ? `${result.pagesChecked || 0} pagine · ${result.linksChecked || 0} link controllati · ${issues.length} problemi.`
                  : `${issues.length} elementi richiedono attenzione.`}
              </p>
            </div>
          </section>

          <section className="panel issues">
            <div className="panel-head">
              <div>
                <h2>Problemi rilevati</h2>
                <p>Ogni problema può diventare una task operativa.</p>
              </div>
              {selectedResult.type === "site" && (
                <button className="secondary small-button" onClick={onOpenTasks}>
                  Apri Task
                </button>
              )}
            </div>
            {issues.length ? (
              issues.map((issue, index) => {
                const issueUrl = issue.targetUrl || issue.url || result.url || client.url;
                return (
                  <div key={`${issue.type || issue.label}-${issueUrl}-${index}`}>
                    <span className={`priority ${issue.severity || "media"}`}>
                      {issue.severity || "media"}
                    </span>
                    <strong>{issue.label}</strong>
                    {issueUrl && (
                      <a className="task-link" href={issueUrl} target="_blank" rel="noreferrer">
                        <ExternalLink />Apri pagina
                      </a>
                    )}
                    <button
                      className="secondary mini"
                      onClick={() =>
                        onCreateTask({
                          title: issue.label || "Correggi problema SEO",
                          sourceUrl: issueUrl,
                          detail: issue.detail || `Problema rilevato dall’audit ${selectedResult.type === "page" ? "pagina" : "sito"}.`,
                          priority: severityPriority(issue.severity),
                          kind: issue.type || "audit",
                        })
                      }
                    >
                      Crea task
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="success"><Check />Nessun problema tra quelli controllati.</div>
            )}
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
    </>
  );
}
