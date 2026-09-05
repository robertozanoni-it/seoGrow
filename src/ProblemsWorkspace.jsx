import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleGauge,
  ExternalLink,
  FileSearch,
  Filter,
  LayoutList,
  ListTree,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { buildUnifiedProblems } from "./problemsModel";
import { listCorrections } from "./remediationStore";
import { recheckCorrectionById } from "./remediationIntegrity";
import {
  freshnessLabel,
  normalizeClientId,
  normalizeHttpUrl,
  safeHttpHref,
} from "./reliabilityModel";
import "./ProblemsWorkspace.css";
import "./ProblemsWorkspaceRuntime.css";

const CLIENTS_KEY = "seogrow-clients";
const SELECTED_CLIENT_KEY = "seogrow-selected-client-v1";
const TASKS_KEY = "seogrow-tasks-v2";
const ANALYSES_KEY = "seogrow-analyses-v2";
const PAGE_HISTORY_KEY = "seogrow-page-audit-history-v2";
const AGENT_PREFILL_KEY = "seogrow-agent-prefill-v1";

const currentHash = () => {
  try { return decodeURIComponent(window.location.hash.slice(1)); } catch { return ""; }
};

const navigate = (page) => {
  const next = `#${encodeURIComponent(page)}`;
  if (window.location.hash !== next) window.history.pushState(null, "", next);
  window.dispatchEvent(new CustomEvent("seogrow-locationchange"));
};

const readStore = (key, expected) => {
  const raw = localStorage.getItem(key);
  if (raw == null) return { ok: true, value: expected === "array" ? [] : expected === "object" ? {} : null, state: "absent" };
  try {
    const value = JSON.parse(raw);
    if (expected === "array" && !Array.isArray(value)) return { ok: false, value: [], state: "schema", error: `${key}: formato non compatibile.` };
    if (expected === "object" && (!value || typeof value !== "object" || Array.isArray(value))) return { ok: false, value: {}, state: "schema", error: `${key}: formato non compatibile.` };
    return { ok: true, value, state: "ready" };
  } catch (error) {
    return { ok: false, value: expected === "array" ? [] : expected === "object" ? {} : null, state: "corrupt", error: `${key}: dati locali non leggibili (${error.message}).` };
  }
};

const labelMap = {
  problem: {
    open: "Aperto",
    needs_verification: "Da confermare",
    resolved: "Risolto",
    reappeared: "Ricomparso",
    intentional: "Intenzionale",
  },
  intervention: {
    not_prepared: "Da preparare",
    prepared: "Pronto",
    approved: "Approvato",
    applied: "Applicato",
    verified: "Verificato tecnicamente",
    failed: "Fallito",
    rolled_back: "Ripristinato",
    task_completed: "Task completata",
  },
  correctability: {
    automatic: "Automatica",
    assisted: "Assistita",
    manual: "Manuale",
    not_supported: "Non supportata",
  },
  confidence: {
    observed: "Osservato",
    measured_html: "Misurato su HTML",
    needs_confirmation: "Da confermare",
  },
  severity: { high: "Alta", medium: "Media", low: "Bassa", unknown: "Non classificata" },
  priority: { high: "Alta", medium: "Media", low: "Bassa", unknown: "Non assegnata" },
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

const sameProblemCorrection = (problem, correction) => {
  if (!problem || !correction) return false;
  if (String(problem.issueType || "").toLowerCase() !== String(correction.issueType || "").toLowerCase()) return false;
  const problemUrl = normalizeHttpUrl(problem.sourceUrl || "", { stripSlash: false });
  const correctionUrl = normalizeHttpUrl(correction.sourceUrl || "", { stripSlash: false });
  return Boolean(problemUrl && correctionUrl && problemUrl === correctionUrl);
};

function ProblemDrawer({ problem, clientId, corrections, onClose, onRefresh }) {
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);
  const [actionMessage, setActionMessage] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!problem) return undefined;
    previousFocusRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => dialogRef.current?.focus(), 0);
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus?.();
    };
  }, [problem, onClose]);

  if (!problem) return null;

  const latestCorrection = corrections
    .filter((item) => sameProblemCorrection(problem, item))
    .toSorted((a, b) => Date.parse(b.verifiedAt || b.appliedAt || 0) - Date.parse(a.verifiedAt || a.appliedAt || 0))[0] || null;
  const href = safeHttpHref(problem.sourceUrl);

  const openSpecificIntervention = () => {
    const request = { clientId, issueKey: problem.key, issueType: problem.issueType, sourceUrl: problem.sourceUrl };
    sessionStorage.setItem("seogrow-remediation-focus-v1", JSON.stringify(request));
    navigate("Audit SEO");
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("seogrow-remediation-focus", { detail: request })), 0);
    onClose();
  };

  const verifyNow = async () => {
    if (!latestCorrection?.id) {
      openSpecificIntervention();
      return;
    }
    setWorking(true);
    setActionMessage("Riverifica specifica in corso…");
    try {
      const result = await recheckCorrectionById(latestCorrection.id);
      setActionMessage(result?.needsAudit
        ? "Controllo frontend eseguito. Per confermare la condizione SEO serve un nuovo audit della pagina o del sito."
        : "Riverifica completata. Stato aggiornato con la nuova evidenza.");
      await onRefresh();
    } catch (error) {
      setActionMessage(`Riverifica non completata: ${error.message}`);
    } finally {
      setWorking(false);
    }
  };

  const askAgent = () => {
    const detail = {
      clientId,
      title: problem.title,
      sourceUrl: problem.sourceUrl,
      problemState: labelMap.problem[problem.problemState] || problem.problemState,
      evidence: problem.evidence,
      detail: problem.detail,
    };
    sessionStorage.setItem(AGENT_PREFILL_KEY, JSON.stringify(detail));
    navigate("SEO Agent");
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("seogrow-agent-prefill", { detail })), 0);
    onClose();
  };

  return createPortal(
    <div className="problem-dialog-layer">
      <button className="problem-drawer-scrim" aria-label="Chiudi dettaglio problema" onClick={onClose} />
      <aside
        ref={dialogRef}
        className="problem-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="problem-dialog-title"
        tabIndex="-1"
      >
        <div className="problem-drawer-head">
          <div>
            <span className={`problem-severity ${problem.severity}`}>Gravità {labelMap.severity[problem.severity]}</span>
            <h2 id="problem-dialog-title">{problem.title}</h2>
          </div>
          <button className="icon-btn" aria-label="Chiudi" onClick={onClose}><X /></button>
        </div>

        <div className="problem-state-grid" aria-label="Stati del problema">
          <div><small>Stato problema</small><strong>{labelMap.problem[problem.problemState] || problem.problemState}</strong></div>
          <div><small>Stato intervento</small><strong>{labelMap.intervention[problem.interventionState] || problem.interventionState}</strong></div>
          <div><small>Correggibilità</small><strong>{labelMap.correctability[problem.correctability] || problem.correctability}</strong></div>
        </div>

        <section>
          <h3>1. Che cosa è stato rilevato</h3>
          <p>{problem.detail}</p>
          <dl className="problem-facts">
            <div><dt>Tipo</dt><dd>{problem.issueType || "Non classificato"}</dd></div>
            <div><dt>Gravità tecnica</dt><dd>{labelMap.severity[problem.severity]}</dd></div>
            <div><dt>Priorità operativa</dt><dd>{labelMap.priority[problem.priority]}</dd></div>
            <div><dt>Certezza</dt><dd>{labelMap.confidence[problem.confidence] || problem.confidence}</dd></div>
            <div><dt>Ultima osservazione</dt><dd>{formatDate(problem.observedAt)} · {freshnessLabel(problem.observedAt)}</dd></div>
            <div><dt>Copertura</dt><dd>{problem.auditScopes.length ? problem.auditScopes.map((scope) => scope === "site" ? "Crawl sito" : "Audit pagina").join(" + ") : "Non disponibile"}</dd></div>
          </dl>
        </section>

        <section>
          <h3>2. Qual è la prova</h3>
          {problem.evidence.length ? (
            <ol className="problem-evidence-list">
              {problem.evidence.map((item, index) => (
                <li key={`${item.source}-${item.at}-${index}`}>
                  <strong>{item.source}</strong>
                  <span>{item.detail}</span>
                  <small>{formatDate(item.at)} · {item.nature === "verified" ? "verifica tecnica" : item.nature === "observed" ? "dato osservato" : "dato operativo"}</small>
                </li>
              ))}
            </ol>
          ) : <p>Nessuna evidenza strutturata disponibile. Il problema resta da confermare.</p>}
        </section>

        <section>
          <h3>3. Che cosa propone SeoGrow</h3>
          {problem.ownershipBlocked ? (
            <p>La correzione automatica è bloccata perché SeoGrow non può attribuire con certezza il frontend a un singolo campo/widget. Il blocco di sicurezza resta attivo.</p>
          ) : (
            <p>
              {problem.correctability === "automatic" && "SeoGrow può preparare una proposta, ma la scrittura richiede anteprima e approvazione."}
              {problem.correctability === "assisted" && "Serve una verifica del contesto prima di autorizzare la modifica."}
              {problem.correctability === "manual" && "SeoGrow può guidare l'intervento, ma non deve applicarlo automaticamente."}
              {problem.correctability === "not_supported" && "Questo caso non dispone di un adapter automatico sicuro."}
            </p>
          )}
          {problem.fields.length > 0 && <p><strong>Campi coinvolti:</strong> {problem.fields.join(", ")}</p>}
          {problem.adapters.length > 0 && <p><strong>Adapter:</strong> {problem.adapters.join(", ")}</p>}
          {problem.quality && <p><strong>Quality gate:</strong> {problem.quality.publishable === false ? "revisione richiesta" : "superato"}</p>}
        </section>

        <section>
          <h3>4. Che cosa succede dopo l’approvazione</h3>
          <p>La modifica viene registrata come applicata. Solo una verifica frontend recente e, quando richiesto dal tipo di problema, un nuovo audit possono portare lo stato SEO a risolto.</p>
        </section>

        {href && <a className="secondary problem-resource" href={href} target="_blank" rel="noreferrer"><ExternalLink /> Apri la pagina interessata</a>}
        {actionMessage && <p className="integration-result" role="status">{actionMessage}</p>}

        <div className="problem-next-step">
          <span>Prossima azione</span>
          {problem.problemState === "resolved" ? (
            <button className="primary" onClick={verifyNow} disabled={working}><RefreshCw /> {working ? "Controllo…" : "Riverifica"}</button>
          ) : problem.interventionState === "applied" || problem.interventionState === "verified" || problem.problemState === "needs_verification" ? (
            <button className="primary" onClick={verifyNow} disabled={working}><RefreshCw /> {working ? "Verifica…" : "Verifica ora"}</button>
          ) : (
            <button className="primary" onClick={openSpecificIntervention}>{problem.ownershipBlocked ? "Identifica widget" : problem.correctability === "not_supported" ? "Apri istruzioni" : "Apri intervento"}</button>
          )}
          <button className="secondary" onClick={askAgent}><Sparkles /> Chiedi a SeoGrow</button>
        </div>
      </aside>
    </div>,
    document.body,
  );
}

export default function ProblemsWorkspace() {
  const [active, setActive] = useState(currentHash() === "Problemi");
  const [mainTarget, setMainTarget] = useState(null);
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState("compact");
  const [selectedKey, setSelectedKey] = useState("");
  const [corrections, setCorrections] = useState([]);
  const [correctionsState, setCorrectionsState] = useState({ loading: false, error: "" });
  const [filters, setFilters] = useState({
    state: "active",
    query: "",
    type: "",
    source: "",
    adapter: "",
    correctability: "",
    special: "",
  });

  useEffect(() => {
    let frame = 0;
    let attempts = 0;
    const findMain = () => {
      const target = document.querySelector(".app main");
      if (target) {
        setMainTarget(target);
        return;
      }
      attempts += 1;
      if (attempts < 120) frame = window.requestAnimationFrame(findMain);
    };
    findMain();
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const refresh = () => {
      const nextActive = currentHash() === "Problemi";
      setActive(nextActive);
      if (!nextActive) setSelectedKey("");
      setRevision((value) => value + 1);
    };
    const onVisibility = () => { if (!document.hidden) refresh(); };
    window.addEventListener("hashchange", refresh);
    window.addEventListener("popstate", refresh);
    window.addEventListener("seogrow-locationchange", refresh);
    window.addEventListener("seogrow-storage-ok", refresh);
    window.addEventListener("seogrow-remediation-history", refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("hashchange", refresh);
      window.removeEventListener("popstate", refresh);
      window.removeEventListener("seogrow-locationchange", refresh);
      window.removeEventListener("seogrow-storage-ok", refresh);
      window.removeEventListener("seogrow-remediation-history", refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const clientsStore = readStore(CLIENTS_KEY, "array");
  const tasksStore = readStore(TASKS_KEY, "array");
  const analysesStore = readStore(ANALYSES_KEY, "object");
  const pagesStore = readStore(PAGE_HISTORY_KEY, "object");
  const selectedStore = readStore(SELECTED_CLIENT_KEY, "scalar");
  const selectedClientId = normalizeClientId(selectedStore.value);
  const client = clientsStore.value.find((item) => normalizeClientId(item?.id) === selectedClientId) || null;

  const reloadCorrections = async () => {
    if (!selectedClientId) {
      setCorrections([]);
      return;
    }
    setCorrectionsState({ loading: true, error: "" });
    try {
      const rows = await listCorrections({ clientId: selectedClientId });
      setCorrections(rows);
      setCorrectionsState({ loading: false, error: "" });
    } catch (error) {
      setCorrections([]);
      setCorrectionsState({ loading: false, error: `Storico correzioni non leggibile: ${error.message}` });
    }
  };

  useEffect(() => {
    if (!active || !selectedClientId) return undefined;
    let cancelled = false;
    setCorrectionsState({ loading: true, error: "" });
    listCorrections({ clientId: selectedClientId })
      .then((rows) => {
        if (cancelled) return;
        setCorrections(rows);
        setCorrectionsState({ loading: false, error: "" });
      })
      .catch((error) => {
        if (cancelled) return;
        setCorrections([]);
        setCorrectionsState({ loading: false, error: `Storico correzioni non leggibile: ${error.message}` });
      });
    return () => { cancelled = true; };
  }, [active, selectedClientId, revision]);

  const storeErrors = [clientsStore, tasksStore, analysesStore, pagesStore, selectedStore]
    .filter((store) => !store.ok)
    .map((store) => store.error);

  const model = useMemo(() => {
    if (!client) return { rows: [], warnings: [], coverage: null };
    return buildUnifiedProblems({
      clientId: client.id,
      siteHistory: analysesStore.value[client.id] || analysesStore.value[String(client.id)] || [],
      pageHistory: pagesStore.value[client.id] || pagesStore.value[String(client.id)] || [],
      tasks: tasksStore.value,
      corrections,
    });
  }, [client, analysesStore.value, pagesStore.value, tasksStore.value, corrections, revision]);

  const rows = model.rows;
  const typeOptions = [...new Set(rows.map((row) => row.issueType).filter(Boolean))].toSorted();
  const adapterOptions = [...new Set(rows.flatMap((row) => row.adapters).filter(Boolean))].toSorted();
  const sourceOptions = [...new Set(rows.flatMap((row) => row.sources.map((source) => source.kind)).filter(Boolean))].toSorted();

  const filtered = rows.filter((row) => {
    if (filters.state === "active" && ["resolved", "intentional"].includes(row.problemState)) return false;
    if (filters.state === "resolved" && row.problemState !== "resolved") return false;
    if (filters.state === "reappeared" && row.problemState !== "reappeared") return false;
    if (filters.query) {
      const haystack = `${row.title} ${row.sourceUrl} ${row.detail}`.toLowerCase();
      if (!haystack.includes(filters.query.toLowerCase())) return false;
    }
    if (filters.type && row.issueType !== filters.type) return false;
    if (filters.adapter && !row.adapters.includes(filters.adapter)) return false;
    if (filters.source && !row.sources.some((source) => source.kind === filters.source)) return false;
    if (filters.correctability && row.correctability !== filters.correctability) return false;
    if (filters.special === "ownership" && !row.ownershipBlocked) return false;
    if (filters.special === "regression" && !row.regression) return false;
    if (filters.special === "stale" && !row.stale) return false;
    if (filters.special === "error" && !row.technicalError) return false;
    return true;
  });

  const counts = {
    active: rows.filter((row) => !["resolved", "intentional"].includes(row.problemState)).length,
    high: rows.filter((row) => row.severity === "high" && !["resolved", "intentional"].includes(row.problemState)).length,
    verify: rows.filter((row) => row.problemState === "needs_verification").length,
    reappeared: rows.filter((row) => row.problemState === "reappeared").length,
    resolved: rows.filter((row) => row.problemState === "resolved").length,
  };
  const selected = rows.find((row) => row.key === selectedKey) || null;

  if (!active || !mainTarget) return null;

  const content = !selectedClientId || !client ? (
    <div className="problems-workspace-root">
      <div className="page-title problems-title"><div><span className="problems-eyebrow">Centro operativo</span><h1>Problemi</h1><p>Seleziona un progetto valido per leggere audit, task e correzioni.</p></div></div>
      <section className="panel problems-blocking-state" role="alert"><AlertTriangle /><div><h2>Nessun progetto valido selezionato</h2><p>SeoGrow non seleziona automaticamente il primo cliente quando l’identità del progetto è ambigua. Torna a Clienti e seleziona esplicitamente il progetto.</p></div></section>
    </div>
  ) : (
    <div className="problems-workspace-root">
      <div className="page-title problems-title">
        <div>
          <span className="problems-eyebrow">Centro operativo</span>
          <h1>Problemi — {client.name}</h1>
          <p>Una sola lista operativa con stato del problema, stato dell’intervento, correggibilità, prova e freschezza.</p>
        </div>
        <div className="problems-view-toggle" aria-label="Tipo di visualizzazione">
          <button aria-pressed={view === "compact"} className={view === "compact" ? "active" : ""} onClick={() => setView("compact")}><LayoutList /> Compatta</button>
          <button aria-pressed={view === "detailed"} className={view === "detailed" ? "active" : ""} onClick={() => setView("detailed")}><ListTree /> Dettagliata</button>
        </div>
      </div>

      <section className="problems-coverage" aria-label="Copertura audit">
        <div><small>Ultimo crawl sito</small><strong>{model.coverage?.siteAuditAt ? formatDate(model.coverage.siteAuditAt) : "Non disponibile"}</strong><span>{model.coverage?.sitePages || 0} pagine</span></div>
        <div><small>Audit pagina conservati</small><strong>{model.coverage?.pageAudits || 0}</strong><span>non sostituiscono il crawl sito</span></div>
        <div><small>Storico correzioni</small><strong>{correctionsState.loading ? "…" : corrections.length}</strong><span>fonte: IndexedDB</span></div>
      </section>

      {(storeErrors.length > 0 || correctionsState.error || model.warnings.length > 0) && (
        <section className="panel problems-data-warning" role="alert">
          <AlertTriangle />
          <div><strong>Qualità dati da controllare</strong>{[...storeErrors, correctionsState.error, ...model.warnings].filter(Boolean).map((message) => <p key={message}>{message}</p>)}</div>
        </section>
      )}

      <section className="problems-overview" aria-label="Filtri rapidi">
        <button aria-pressed={filters.state === "active"} className={filters.state === "active" ? "active" : ""} onClick={() => setFilters((value) => ({ ...value, state: "active" }))}><strong>{counts.active}</strong><span>Attivi</span></button>
        <button onClick={() => setFilters((value) => ({ ...value, state: "active", special: "" }))}><strong>{counts.high}</strong><span>Alta gravità</span></button>
        <button aria-pressed={filters.state === "reappeared"} className="critical" onClick={() => setFilters((value) => ({ ...value, state: "reappeared" }))}><strong>{counts.reappeared}</strong><span>Ricomparsi</span></button>
        <button aria-pressed={filters.state === "resolved"} className="verified" onClick={() => setFilters((value) => ({ ...value, state: "resolved" }))}><strong>{counts.resolved}</strong><span>Risolti</span></button>
        <button aria-pressed={filters.state === "all"} onClick={() => setFilters((value) => ({ ...value, state: "all", special: "" }))}><strong>{rows.length}</strong><span>Tutti</span></button>
      </section>

      <section className="panel problems-filters" aria-label="Filtri avanzati">
        <label className="problem-search"><span><Search /> Cerca URL o problema</span><input value={filters.query} onChange={(event) => setFilters((value) => ({ ...value, query: event.target.value }))} placeholder="Es. canonical, /yoga-blog/…" /></label>
        <label><span>Tipo</span><select value={filters.type} onChange={(event) => setFilters((value) => ({ ...value, type: event.target.value }))}><option value="">Tutti</option>{typeOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Fonte</span><select value={filters.source} onChange={(event) => setFilters((value) => ({ ...value, source: event.target.value }))}><option value="">Tutte</option>{sourceOptions.map((item) => <option key={item} value={item}>{item === "audit" ? "Audit" : item === "task" ? "Task" : "Correzioni"}</option>)}</select></label>
        <label><span>Adapter</span><select value={filters.adapter} onChange={(event) => setFilters((value) => ({ ...value, adapter: event.target.value }))}><option value="">Tutti</option>{adapterOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Correggibilità</span><select value={filters.correctability} onChange={(event) => setFilters((value) => ({ ...value, correctability: event.target.value }))}><option value="">Tutte</option><option value="automatic">Automatica</option><option value="assisted">Assistita</option><option value="manual">Manuale</option><option value="not_supported">Non supportata</option></select></label>
        <label><span>Segnale speciale</span><select value={filters.special} onChange={(event) => setFilters((value) => ({ ...value, special: event.target.value }))}><option value="">Nessuno</option><option value="ownership">Blocco ownership</option><option value="regression">Regressione</option><option value="stale">Dati obsoleti</option><option value="error">Errore tecnico</option></select></label>
      </section>

      <div className="problems-toolbar">
        <span><Filter /> {filtered.length} elementi visualizzati</span>
        <span className="problems-source-note"><ShieldCheck /> Score e proposte AI non sono prove: apri il dettaglio per vedere fonte e data.</span>
      </div>

      <section className={`problems-list ${view}`} aria-live="polite">
        {filtered.length ? filtered.map((problem) => {
          const href = safeHttpHref(problem.sourceUrl);
          return (
            <button className="problem-row" key={problem.key} onClick={() => setSelectedKey(problem.key)}>
              <span className={`problem-severity ${problem.severity}`}>{labelMap.severity[problem.severity]}</span>
              <span className="problem-main"><strong>{problem.title}</strong><small>{href || "URL non disponibile"}</small>{view === "detailed" && <p>{compactText(problem.detail)}</p>}</span>
              <span className="problem-source"><FileSearch /> {problem.sources[0]?.label || "Fonte non disponibile"}<small>{freshnessLabel(problem.observedAt)}</small></span>
              <span className={`problem-state ${problem.problemState}`}>{labelMap.problem[problem.problemState] || problem.problemState}</span>
              <span className={`problem-correctability ${problem.correctability}`}>{labelMap.correctability[problem.correctability] || problem.correctability}</span>
              {problem.stale && <span className="problem-flag">Obsoleto</span>}
              <ChevronRight className="problem-chevron" />
            </button>
          );
        }) : (
          <div className="problems-empty"><CheckCircle2 /><h2>Nessun problema in questo filtro</h2><p>Cambia filtro oppure esegui un nuovo audit per aggiornare la situazione.</p><button className="secondary" onClick={() => navigate("Audit SEO")}><CircleGauge /> Apri Audit SEO</button></div>
        )}
      </section>

      <ProblemDrawer
        problem={selected}
        clientId={client.id}
        corrections={corrections}
        onClose={() => setSelectedKey("")}
        onRefresh={reloadCorrections}
      />
    </div>
  );

  return createPortal(content, mainTarget);
}
