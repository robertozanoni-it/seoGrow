import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Eye,
  History,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { apiFetch } from "./api";
import {
  lastBatch,
  listCorrections,
  readCorrection,
  reopenTask,
  REMEDIATION_INDEX_KEY,
  REMEDIATION_LAST_BATCH_KEY,
  updateCorrection,
} from "./remediationStore";
import { rollbackRequest } from "./rollbackPayload";
import "./CorrectionsWorkspace.css";

const fetch = apiFetch;
const SELECTED_CLIENT_KEY = "seogrow-selected-client-v1";
const WORDPRESS_PROFILES_KEY = "seogrow-wordpress-profiles-v1";

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const currentHash = () => {
  try { return decodeURIComponent(window.location.hash.slice(1)); } catch { return ""; }
};
const preview = (value, max = 300) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text || "—";
};
const statusClass = (status) => String(status || "").toLowerCase().replaceAll(" ", "-");
const isVerified = (record) => record.status === "Verificato";
const isPending = (record) => record.status === "Applicato" || record.status === "Da verificare";
const isRolledBack = (record) => record.status === "Ripristinato";

export default function CorrectionsWorkspace() {
  const [active, setActive] = useState(currentHash() === "Correzioni");
  const [navTarget, setNavTarget] = useState(null);
  const [mainTarget, setMainTarget] = useState(null);
  const [version, setVersion] = useState(0);
  const [rows, setRows] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [expanded, setExpanded] = useState(() => new Set());
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [rollingBack, setRollingBack] = useState("");

  const selectedClientId = Number(readJson(SELECTED_CLIENT_KEY, 0));
  const batchId = lastBatch();
  const profile = readJson(WORDPRESS_PROFILES_KEY, {})[selectedClientId] || null;

  useEffect(() => {
    let frame = 0;
    let attempts = 0;
    const syncTargets = () => {
      const nav = document.querySelector(".sidebar nav");
      const main = document.querySelector(".app main");
      setNavTarget((current) => current === nav ? current : nav);
      setMainTarget((current) => current === main ? current : main);
      const nextActive = currentHash() === "Correzioni";
      setActive(nextActive);
      window.__seogrowCorrectionsMode = nextActive;
      if ((!nav || !main) && attempts < 120) {
        attempts += 1;
        frame = window.requestAnimationFrame(syncTargets);
      }
    };
    const refreshNavigation = () => {
      window.cancelAnimationFrame(frame);
      attempts = 0;
      frame = window.requestAnimationFrame(syncTargets);
    };
    frame = window.requestAnimationFrame(syncTargets);
    window.addEventListener("hashchange", refreshNavigation);
    window.addEventListener("seogrow-locationchange", refreshNavigation);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", refreshNavigation);
      window.removeEventListener("seogrow-locationchange", refreshNavigation);
    };
  }, []);

  useEffect(() => {
    const refresh = () => setVersion((value) => value + 1);
    const storage = (event) => {
      if ([REMEDIATION_INDEX_KEY, REMEDIATION_LAST_BATCH_KEY, SELECTED_CLIENT_KEY].includes(event.key)) refresh();
    };
    window.addEventListener("storage", storage);
    window.addEventListener("seogrow-remediation-history", refresh);
    window.addEventListener("seogrow-remediation-applied", refresh);
    return () => {
      window.removeEventListener("storage", storage);
      window.removeEventListener("seogrow-remediation-history", refresh);
      window.removeEventListener("seogrow-remediation-applied", refresh);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    listCorrections({ clientId: selectedClientId || undefined, batchId: showAll ? undefined : batchId || undefined })
      .then((items) => { if (!cancelled) setRows(items); })
      .catch((error) => { if (!cancelled) setMessage(error.message); });
    return () => { cancelled = true; };
  }, [selectedClientId, batchId, showAll, version]);

  useEffect(() => {
    if (!mainTarget) return undefined;
    if (active) mainTarget.dataset.correctionsOpen = "true";
    else delete mainTarget.dataset.correctionsOpen;
    return () => { delete mainTarget.dataset.correctionsOpen; };
  }, [active, mainTarget]);

  const stats = useMemo(() => ({
    total: rows.length,
    verified: rows.filter(isVerified).length,
    pending: rows.filter(isPending).length,
    rolledBack: rows.filter(isRolledBack).length,
  }), [rows]);

  const filteredRows = useMemo(() => rows.filter((record) => {
    if (statusFilter === "verified") return isVerified(record);
    if (statusFilter === "pending") return isPending(record);
    if (statusFilter === "rolled") return isRolledBack(record);
    return true;
  }), [rows, statusFilter]);

  const toggleExpanded = (id) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const rollback = async (id) => {
    if (!password) {
      setMessage("Inserisci la password applicativa WordPress per eseguire il rollback.");
      return;
    }
    const record = await readCorrection(id);
    if (!record) {
      setMessage("Snapshot di rollback non disponibile.");
      return;
    }
    const changes = record.before && typeof record.before === "object" ? record.before : {};
    const expectedCurrent = record.after && typeof record.after === "object" ? record.after : {};
    if (!Object.keys(changes).length) {
      setMessage("Questa correzione non contiene uno snapshot precedente ripristinabile.");
      return;
    }
    if (!Object.keys(expectedCurrent).length) {
      setMessage("Rollback bloccato: manca lo snapshot dello stato applicato necessario per verificare che WordPress non sia cambiato nel frattempo.");
      return;
    }
    if (!window.confirm(`Ripristinare la versione precedente per “${record.issueLabel}”? Prima del rollback SeoGrow controllerà che WordPress sia ancora nello stato applicato da questa correzione.`)) return;
    setRollingBack(id);
    setMessage("Controllo stale-state e rollback in corso…");
    try {
      const response = await fetch("/api/wordpress/live-rollback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(rollbackRequest(record, {
          username: profile?.username || "",
          applicationPassword: password,
        })),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Rollback WordPress non riuscito");
      if (data.staleChecked !== true) throw new Error("Rollback rifiutato: il server non ha confermato il controllo stale-state.");
      const updated = await updateCorrection(id, {
        status: "Ripristinato",
        rollbackAt: new Date().toISOString(),
        rollbackNote: "Versione precedente ripristinata dopo verifica che lo stato WordPress non fosse cambiato.",
      });
      if (updated) reopenTask(updated);
      setMessage("Rollback completato in sicurezza. La Task relativa è stata riaperta.");
      setVersion((value) => value + 1);
    } catch (error) {
      setMessage(`Rollback non riuscito: ${error.message}`);
    } finally {
      setRollingBack("");
    }
  };

  const nav = navTarget ? createPortal(
    <button
      type="button"
      className={active ? "active corrections-nav-button" : "corrections-nav-button"}
      aria-current={active ? "page" : undefined}
      onClick={() => { window.location.hash = encodeURIComponent("Correzioni"); }}
    >
      <History />
      <span>Correzioni</span>
    </button>,
    navTarget,
  ) : null;

  const page = active && mainTarget ? createPortal(
    <div className="corrections-workspace-root">
      <div className="page-title corrections-title">
        <div>
          <h1>Correzioni</h1>
          <p>Qui vedi cosa è stato scritto in WordPress, cosa è realmente visibile sul sito e quali Task possono essere chiuse.</p>
        </div>
        <div className="corrections-filter">
          <button type="button" className={!showAll ? "primary" : "secondary"} onClick={() => setShowAll(false)}>Ultimo batch</button>
          <button type="button" className={showAll ? "primary" : "secondary"} onClick={() => setShowAll(true)}>Tutto lo storico</button>
        </div>
      </div>

      <section className="corrections-logic panel">
        <div><span>1</span><strong>Salvato in WordPress</strong><small>REST conferma la scrittura</small></div>
        <i>→</i>
        <div><span>2</span><strong>Visibile sul sito</strong><small>confronto con il frontend</small></div>
        <i>→</i>
        <div><span>3</span><strong>Problema SEO risolto</strong><small>nuovo controllo SeoGrow</small></div>
        <i>→</i>
        <div><span>4</span><strong>Task chiusa</strong><small>solo dopo conferma</small></div>
      </section>

      <div className="corrections-stats" aria-label="Filtra correzioni per stato">
        <button type="button" className={statusFilter === "all" ? "active" : ""} onClick={() => setStatusFilter("all")}><strong>{stats.total}</strong><span>Tutte</span></button>
        <button type="button" className={`verified ${statusFilter === "verified" ? "active" : ""}`} onClick={() => setStatusFilter("verified")}><strong>{stats.verified}</strong><span>Verificate</span></button>
        <button type="button" className={`pending ${statusFilter === "pending" ? "active" : ""}`} onClick={() => setStatusFilter("pending")}><strong>{stats.pending}</strong><span>Da verificare</span></button>
        <button type="button" className={`rolled ${statusFilter === "rolled" ? "active" : ""}`} onClick={() => setStatusFilter("rolled")}><strong>{stats.rolledBack}</strong><span>Ripristinate</span></button>
      </div>

      <section className="panel corrections-security">
        <div><ShieldCheck /><span><strong>Rollback WordPress stale-safe</strong><small>Prima di ripristinare, SeoGrow verifica che i campi live siano ancora uguali allo snapshot applicato. Modifiche successive bloccano il rollback.</small></span></div>
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password applicativa WordPress" autoComplete="new-password" />
      </section>

      {message && <p className="integration-result corrections-message">{message}</p>}

      <div className="corrections-list">
        {filteredRows.map((record) => {
          const open = expanded.has(record.id);
          const verified = isVerified(record);
          const pending = isPending(record);
          return (
            <article className={`panel correction-card ${open ? "open" : ""}`} key={record.id}>
              <button type="button" className="correction-summary" onClick={() => toggleExpanded(record.id)} aria-expanded={open}>
                <span className={`correction-status ${statusClass(record.status)}`}>{verified ? <CheckCircle2 /> : pending ? <AlertTriangle /> : <RotateCcw />}{record.status}</span>
                <span className="correction-summary-main">
                  <strong>{record.issueLabel}</strong>
                  <small>{record.fields?.join(", ") || "modifica WordPress"} · {new Date(record.appliedAt).toLocaleString("it-IT")}</small>
                </span>
                <span className="correction-quick-state">
                  <span className="ok">1 WordPress</span>
                  <span className={record.frontendConfirmed ? "ok" : "wait"}>2 Frontend</span>
                  <span className={verified ? "ok" : "wait"}>3 SEO</span>
                  <span className={verified ? "ok" : "wait"}>4 Task</span>
                </span>
                <ChevronDown className="correction-chevron" />
              </button>

              <div className="correction-summary-actions">
                <a href={record.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink />Apri pagina</a>
                <button type="button" className="secondary mini" onClick={() => toggleExpanded(record.id)}><Eye />{open ? "Nascondi dettagli" : "Vedi Prima / Dopo"}</button>
              </div>

              <p className={`correction-verification-note ${verified ? "verified" : "pending"}`}>{record.verificationNote || record.rollbackNote || "Modifica registrata."}</p>

              {open && (
                <div className="correction-details">
                  <div className="correction-diff-grid">
                    <section className="before"><strong>Prima — versione precedente</strong>{(record.fields || Object.keys(record.before || {})).map((field) => <div key={`before-${field}`}><small>{field}</small><p>{preview(record.before?.[field])}</p>{String(record.before?.[field] || "").length > 300 && <details><summary>Mostra contenuto completo</summary><pre>{String(record.before?.[field] || "")}</pre></details>}</div>)}</section>
                    <section className="after"><strong>Dopo — versione inviata a WordPress</strong>{(record.fields || Object.keys(record.after || {})).map((field) => <div key={`after-${field}`}><small>{field}</small><p>{preview(record.after?.[field])}</p>{String(record.after?.[field] || "").length > 300 && <details><summary>Mostra contenuto completo</summary><pre>{String(record.after?.[field] || "")}</pre></details>}</div>)}</section>
                  </div>

                  <div className="correction-footer">
                    <div>
                      <strong>{verified ? "Correzione confermata" : "Correzione non ancora chiudibile"}</strong>
                      <span>{verified ? "Il frontend e il controllo SEO hanno confermato il risultato; la Task relativa può essere chiusa." : "La scrittura WordPress da sola non basta: la Task resta attiva finché il frontend e SeoGrow non confermano il risultato."}</span>
                    </div>
                    <button type="button" className="secondary" disabled={rollingBack === record.id || record.status === "Ripristinato"} onClick={() => rollback(record.id)}><RotateCcw />{rollingBack === record.id ? "Ripristino…" : "Ripristina versione precedente"}</button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
        {!filteredRows.length && <section className="panel corrections-empty"><History /><h2>Nessuna correzione in questo filtro</h2><p>Cambia filtro oppure esegui una nuova remediation.</p></section>}
      </div>
    </div>,
    mainTarget,
  ) : null;

  return <>{nav}{page}</>;
}
