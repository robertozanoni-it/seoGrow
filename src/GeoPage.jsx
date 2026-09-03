import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  Download,
  ExternalLink,
  FileQuestion,
  Plus,
  Radar,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { downloadCsv } from "./platform";
import { apiFetch } from "./api";

const fetch = apiFetch;

const unique = (values) => [...new Set(values.filter(Boolean))];

function suggestedQuestions(dataset, topicalMap, clientName) {
  const searchQuestions = (dataset?.queries || []).slice(0, 8).map((row) => {
    const query = String(row.dimension || "").trim();
    if (!query) return "";
    return /^(come|cosa|quanto|quale|perch[eé]|dove|quando)\b/i.test(query)
      ? query
      : `Quali informazioni offre ${clientName} su ${query}?`;
  });
  const topicalQuestions = (topicalMap?.ideas || [])
    .filter((item) => !item.covered)
    .slice(0, 6)
    .map((item) => `Cosa bisogna sapere su ${item.keyword}?`);
  return unique([...searchQuestions, ...topicalQuestions]).slice(0, 12);
}

function ReadinessScore({ score }) {
  return (
    <div
      className="geo-score"
      style={{ "--geo-score": `${Math.max(0, Math.min(100, score || 0))}%` }}
      aria-label={`Indice di preparazione GEO: ${score || 0} su 100`}
    >
      <div>
        <strong>{score ?? "—"}</strong>
        <span>/100</span>
      </div>
      <small>Preparazione GEO</small>
    </div>
  );
}

function Signal({ label, value, status = "neutral", detail }) {
  return (
    <div className={`geo-signal ${status}`}>
      <span>{status === "pass" ? <Check /> : <AlertTriangle />}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        {detail ? <p>{detail}</p> : null}
      </div>
    </div>
  );
}

export default function GeoPage({
  client,
  dataset,
  analysis,
  topicalMap,
  saved,
  onSave,
  onCreateTask,
  aiConfigured,
  onNavigate,
}) {
  const initialQuestions = useMemo(
    () => suggestedQuestions(dataset, topicalMap, client.name),
    [client.name, dataset, topicalMap],
  );
  const initialQuestionsText = initialQuestions.join("\n");
  const [questionsText, setQuestionsText] = useState(
    (Array.isArray(saved?.questions) ? saved.questions : []).join("\n") ||
      initialQuestionsText,
  );
  const [audit, setAudit] = useState(
    saved?.audit && typeof saved.audit === "object" ? saved.audit : null,
  );
  const [simulation, setSimulation] = useState(
    saved?.simulation && typeof saved.simulation === "object"
      ? saved.simulation
      : null,
  );
  const [auditLoading, setAuditLoading] = useState(false);
  const [simulationLoading, setSimulationLoading] = useState(false);
  const [error, setError] = useState("");
  const auditControllerRef = useRef(null);
  const simulationControllerRef = useRef(null);
  const previousSuggestionsRef = useRef(initialQuestionsText);
  useEffect(
    () => () => {
      auditControllerRef.current?.abort();
      simulationControllerRef.current?.abort();
    },
    [],
  );
  useEffect(() => {
    const previous = previousSuggestionsRef.current;
    if (
      !Array.isArray(saved?.questions) &&
      (!questionsText.trim() || questionsText === previous)
    )
      setQuestionsText(initialQuestionsText);
    previousSuggestionsRef.current = initialQuestionsText;
  }, [initialQuestionsText, questionsText, saved?.questions]);

  const questions = unique(
    questionsText
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean),
  ).slice(0, 20);

  const persist = (next = {}) => {
    const value = {
      questions,
      audit,
      simulation,
      updatedAt: new Date().toISOString(),
      ...next,
    };
    onSave(value);
    return value;
  };

  const runAudit = async () => {
    auditControllerRef.current?.abort();
    const controller = new AbortController();
    auditControllerRef.current = controller;
    setAuditLoading(true);
    setError("");
    try {
      const response = await fetch("/api/geo/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: client.url,
          pageUrls: (analysis?.pages || []).map((page) => page.url).slice(0, 10),
        }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Audit GEO non riuscito");
      setAudit(data);
      persist({ audit: data });
    } catch (err) {
      if (err.message !== "Richiesta annullata.") setError(err.message);
    } finally {
      if (auditControllerRef.current === controller) {
        auditControllerRef.current = null;
        setAuditLoading(false);
      }
    }
  };

  const runSimulation = async () => {
    if (!questions.length) {
      setError("Inserisci almeno una domanda da verificare.");
      return;
    }
    if (!aiConfigured) {
      setError("Configura OpenAI nelle Integrazioni prima della simulazione.");
      return;
    }
    if (
      !window.confirm(
        `Inviare a OpenAI ${questions.length} domande e gli estratti del progetto? La chiamata usa credito API e non misura citazioni reali.`,
      )
    )
      return;
    setSimulationLoading(true);
    setError("");
    simulationControllerRef.current?.abort();
    const controller = new AbortController();
    simulationControllerRef.current = controller;
    try {
      const projectPages = (analysis?.pages || []).slice(0, 40).map((page) => ({
        url: page.url,
        title: page.title,
        words: page.words,
        excerpt: page.contentExcerpt || "",
      }));
      const response = await fetch("/api/geo/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          siteName: client.name,
          siteUrl: client.url,
          questions,
          pages: projectPages,
          searchQueries: (dataset?.queries || []).slice(0, 30).map((row) => ({
            query: row.dimension,
            position: row.position,
            impressions: row.impressions,
          })),
        }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Simulazione GEO non riuscita");
      setSimulation(data);
      persist({ simulation: data, questions });
    } catch (err) {
      if (err.message !== "Richiesta annullata.") setError(err.message);
    } finally {
      if (simulationControllerRef.current === controller) {
        simulationControllerRef.current = null;
        setSimulationLoading(false);
      }
    }
  };

  const exportReport = () => {
    const rows = [
      ...(Array.isArray(audit?.issues) ? audit.issues : []).map((issue) => ({
        sezione: "Audit GEO",
        elemento: issue.title,
        esito: issue.severity,
        dettaglio: issue.detail,
        url: issue.url || client.url,
      })),
      ...(Array.isArray(simulation?.results) ? simulation.results : []).map((item) => ({
        sezione: "Simulazione AI",
        elemento: item.question,
        esito: item.coverage,
        dettaglio: item.gap || item.answer,
        url: item.bestUrl || "",
      })),
    ];
    downloadCsv(rows, `geo-ai-${client.name}.csv`);
  };

  const crawler =
    audit?.crawlerAccess && typeof audit.crawlerAccess === "object"
      ? audit.crawlerAccess
      : {};
  const issues = Array.isArray(audit?.issues) ? audit.issues : [];
  const simulationResults = Array.isArray(simulation?.results)
    ? simulation.results
    : [];
  const highIssues = issues.filter((item) => item.severity === "Alta").length;

  return (
    <>
      <div className="page-title geo-title">
        <div>
          <h1>GEO AI — {client.name}</h1>
          <p>
            Prepara il sito a essere compreso e citato dai motori generativi.
          </p>
        </div>
        <div className="geo-title-actions">
          <button
            className="secondary"
            disabled={!audit && !simulation}
            onClick={exportReport}
          >
            <Download /> Esporta report
          </button>
          <button className="primary" onClick={runAudit} disabled={auditLoading}>
            <RefreshCw className={auditLoading ? "spin" : ""} />
            {auditLoading ? "Analisi…" : audit ? "Ripeti audit" : "Avvia audit GEO"}
          </button>
        </div>
      </div>

      <div className="geo-notice" role="note">
        <ShieldCheck />
        <div>
          <strong>Misurazione trasparente</strong>
          <span>
            L’indice valuta la preparazione tecnica e informativa. La simulazione
            OpenAI non equivale a un posizionamento reale su ChatGPT o Google AI.
          </span>
        </div>
      </div>

      {error ? (
        <div className="geo-error" role="alert">
          <AlertTriangle /> <span>{error}</span>
          {!aiConfigured && (
            <button onClick={() => onNavigate("Integrazioni")}>Configura</button>
          )}
        </div>
      ) : null}

      <section className="geo-overview">
        <div className="panel geo-readiness">
          <div>
            <h2>Indice di preparazione</h2>
            <p>Basato su controlli verificabili, non su metriche inventate.</p>
          </div>
          <ReadinessScore score={audit?.score} />
          <dl>
            <div>
              <dt>Problemi prioritari</dt>
              <dd>{audit ? highIssues : "—"}</dd>
            </div>
            <div>
              <dt>Pagine disponibili dal crawl</dt>
              <dd>{analysis?.pagesChecked || analysis?.pages?.length || 0}</dd>
            </div>
            <div>
              <dt>Domande monitorate</dt>
              <dd>{questions.length}</dd>
            </div>
          </dl>
        </div>

        <div className="panel geo-crawlers">
          <div className="panel-head">
            <div>
              <h2>Accesso dei crawler</h2>
              <p>Controllo diretto del file robots.txt.</p>
            </div>
            <Radar />
          </div>
          {audit ? (
            <div className="geo-signal-list">
              <Signal
                label="ChatGPT Search"
                value={crawler.oaiSearchBot ? "Non bloccato" : "Bloccato"}
                status={crawler.oaiSearchBot ? "pass" : "fail"}
                detail="Solo verifica robots.txt; firewall e CDN non sono verificati"
              />
              <Signal
                label="Google Search e funzioni AI"
                value={crawler.googlebot ? "Non bloccato" : "Bloccato"}
                status={crawler.googlebot ? "pass" : "fail"}
                detail="Solo verifica robots.txt; non è una prova di scansione reale"
              />
              <Signal
                label="Addestramento OpenAI"
                value={crawler.gptBot ? "Non bloccato" : "Bloccato"}
                status={crawler.gptBot ? "pass" : "neutral"}
                detail="GPTBot: scelta indipendente dalla ricerca"
              />
            </div>
          ) : (
            <div className="geo-placeholder">
              <Bot />
              <p>Avvia l’audit per verificare i crawler sul sito reale.</p>
            </div>
          )}
        </div>
      </section>

      {audit ? (
        <section className="panel geo-issues">
          <div className="panel-head">
            <div>
              <h2>Interventi GEO verificati</h2>
              <p>Ogni task include pagina, prova rilevata e correzione richiesta.</p>
            </div>
            <span className="geo-count">{issues.length} controlli da gestire</span>
          </div>
          <div className="geo-issue-list">
            {issues.length ? (
              issues.map((issue) => (
                <article key={issue.id} className="geo-issue">
                  <span className={`priority ${String(issue.severity || "Media").toLowerCase()}`}>
                    {issue.severity || "Media"}
                  </span>
                  <div>
                    <h3>{issue.title}</h3>
                    <p>{issue.detail}</p>
                    <strong>Intervento: {issue.recommendation}</strong>
                    {issue.url ? (
                      <a href={issue.url} target="_blank" rel="noreferrer">
                        <ExternalLink /> Apri pagina verificata
                      </a>
                    ) : null}
                  </div>
                  <button
                    className="secondary mini"
                    onClick={() =>
                      onCreateTask({
                        title: `GEO: ${issue.title}`,
                        sourceUrl: issue.url || client.url,
                        priority: issue.severity,
                        kind: "geo",
                        detail: `Controllo GEO verificato: ${issue.detail}\n\nIntervento richiesto: ${issue.recommendation}\n\nFonte del controllo: audit tecnico eseguito il ${new Date(audit.analyzedAt).toLocaleString("it-IT")}.`,
                      })
                    }
                  >
                    <Plus /> Crea task
                  </button>
                </article>
              ))
            ) : (
              <div className="geo-placeholder compact-placeholder">
                <Check /> <p>Nessun problema GEO rilevato nei controlli disponibili.</p>
              </div>
            )}
          </div>
        </section>
      ) : null}

      <section className="geo-lab">
        <div className="panel geo-questions">
          <div className="panel-head">
            <div>
              <h2>Domande da monitorare</h2>
              <p>Una domanda per riga, massimo 20.</p>
            </div>
            <FileQuestion />
          </div>
          <label className="geo-question-label">
            <span className="sr-only">Domande GEO da monitorare, una per riga</span>
          <textarea
            aria-label="Domande GEO da monitorare"
            value={questionsText}
            onChange={(event) => setQuestionsText(event.target.value)}
            onBlur={() => persist({ questions })}
            placeholder="Es. Qual è il miglior servizio per…?"
          />
          </label>
          <div className="geo-question-actions">
            <span>{questions.length}/20 domande</span>
            <button
              className="secondary"
              onClick={() => {
                setQuestionsText(initialQuestionsText);
                persist({ questions: initialQuestions });
              }}
            >
              Rigenera dai dati
            </button>
            <button
              className="primary"
              onClick={runSimulation}
              disabled={simulationLoading}
            >
              <Sparkles className={simulationLoading ? "spin" : ""} />
              {simulationLoading ? "Simulazione…" : "Simula con OpenAI"}
            </button>
          </div>
        </div>

        <div className="panel geo-simulation-summary">
          <div className="panel-head">
            <div>
              <h2>Copertura simulata</h2>
              <p>Risposte basate esclusivamente sui dati forniti all’API.</p>
            </div>
            <Bot />
          </div>
          {simulation ? (
            <div className="geo-sim-metrics">
              <div>
                <strong>{simulation.summary?.covered || 0}</strong>
                <span>Coperte</span>
              </div>
              <div>
                <strong>{simulation.summary?.partial || 0}</strong>
                <span>Parziali</span>
              </div>
              <div>
                <strong>{simulation.summary?.missing || 0}</strong>
                <span>Scoperte</span>
              </div>
            </div>
          ) : (
            <div className="geo-placeholder">
              <Sparkles />
              <p>Avvia una simulazione per trovare le lacune informative.</p>
            </div>
          )}
        </div>
      </section>

      {simulationResults.length ? (
        <section className="panel geo-results">
          <div className="panel-head">
            <div>
              <h2>Risposte e lacune informative</h2>
              <p>{simulation.disclaimer}</p>
            </div>
          </div>
          <div className="geo-result-list">
            {simulationResults.map((item, index) => (
              <details key={`${item.question}-${index}`}>
                <summary>
                  <span>{item.question}</span>
                  <b className={`coverage ${String(item.coverage).toLowerCase()}`}>
                    {item.coverage}
                  </b>
                </summary>
                <div className="geo-answer">
                  <h3>Risposta simulata</h3>
                  <p>{item.answer}</p>
                  <h3>Lacuna individuata</h3>
                  <p>{item.gap || "Nessuna lacuna sostanziale rilevata."}</p>
                  {item.bestUrl ? (
                    <a href={item.bestUrl} target="_blank" rel="noreferrer">
                      <ExternalLink /> Pagina più pertinente
                    </a>
                  ) : null}
                  <button
                    className="secondary mini"
                    onClick={() =>
                      onCreateTask({
                        title: `GEO: migliora la risposta a “${item.question}”`,
                        sourceUrl: item.bestUrl || client.url,
                        priority: item.coverage === "Scoperta" ? "Alta" : "Media",
                        kind: "geo",
                        detail: `Domanda monitorata: ${item.question}\n\nCopertura simulata: ${item.coverage}\n\nRisposta ottenuta: ${item.answer}\n\nLacuna da colmare: ${item.gap || "Rendere la risposta più diretta, completa e verificabile."}\n\nNota: risultato di una simulazione OpenAI, da verificare editorialmente.`,
                      })
                    }
                  >
                    <Plus /> Crea task dettagliata
                  </button>
                </div>
              </details>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
