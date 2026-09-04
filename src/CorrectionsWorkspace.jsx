import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, ExternalLink, History, RotateCcw, ShieldCheck, XCircle } from "lucide-react";
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
import "./CorrectionsWorkspace.css";

const fetch = apiFetch;
const SELECTED_CLIENT_KEY = "seogrow-selected-client-v1";
const WORDPRESS_PROFILES_KEY = "seogrow-wordpress-profiles-v1";
const OPENED_BATCH_KEY = "seogrow-remediation-opened-batch-v1";

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};

const currentHash = () => {
  try { return decodeURIComponent(window.location.hash.slice(1)); } catch { return ""; }
};

const preview = (value, max = 360) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text || "—";
};

const statusClass = (status) => String(status || "").toLowerCase().replaceAll(" ", "-");

export default function CorrectionsWorkspace() {
  const [active, setActive] = useState(currentHash() === "Correzioni");
  const [navTarget, setNavTarget] = useState(null);
  const [mainTarget, setMainTarget] = useState(null);
  const [version, setVersion] = useState(0);
  const [rows, setRows] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [rollingBack, setRollingBack] = useState("");

  const selectedClientId = Number(readJson(SELECTED_CLIENT_KEY, 0));
  const batchId = lastBatch();
  const profile = readJson(WORDPRESS_PROFILES_KEY, {})[selectedClientId] || null;

  useEffect(() => {
    const syncTargets = () => {
      setNavTarget(document.querySelector(".sidebar nav"));
      setMainTarget(document.querySelector(".app main"));
      setActive(currentHash() === "Correzioni");
    };
    syncTargets();
    const observer = new MutationObserver(syncTargets);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("hashchange", syncTargets);
    window.addEventListener("seogrow-locationchange", syncTargets);
    return () => {
      observer.disconnect();
      window.removeEventListener("hashchange", syncTargets);
      window.removeEventListener("seogrow-locationchange", syncTargets);
    };
  }, []);

  useEffect(() => {
    const refresh = () => setVersion((value) => value + 1);
    const storage = (event) => {
      if ([REMEDIATION_INDEX_KEY, REMEDIATION_LAST_BATCH_KEY, SELECTED_CLIENT_KEY].includes(event.key)) refresh();
    };
    window.addEventListener("storage", storage);
    window.addEventListener("seogrow-remediation-history", refresh);
    return () => {
      window.removeEventListener("storage", storage);
      window.removeEventListener("seogrow-remediation-history", refresh);
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

  useEffect(() => {
    const checkCompletion = () => {
      const node = document.querySelector(".audit-remediation-message");
      const text = String(node?.textContent || "");
      if (!text.startsWith("Remediation completata:")) return;
      const currentBatch = lastBatch();
      if (!currentBatch) return;
      if (sessionStorage.getItem(OPENED_BATCH_KEY) === currentBatch) return;
      sessionStorage.setItem(OPENED_BATCH_KEY, currentBatch);
      window.location.hash = encodeURIComponent("Correzioni");
    };
    const observer = new MutationObserver(checkCompletion);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    checkCompletion();
    return () => observer.disconnect();
  }, []);

  const stats = useMemo(() => ({
    total: rows.length,
    verified: rows.filter((item) => item.status === "Verificato").length,
    pending: rows.filter((item) => item.status === "Applicato" || item.status === "Da verificare").length,
    rolledBack: rows.filter((item) => item.status === "Ripristinato").length,
  }), [rows]);

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
    if (!Object.keys(changes).length) {
      setMessage("Questa correzione non contiene uno snapshot precedente ripristinabile.");
      return;
    }
    if (!window.confirm(`Ripristinare la versione precedente per “${record.issueLabel}”?`)) return;
    setRollingBack(id);
    setMessage("Rollback in corso…");
    try {
      const response = await fetch("/api/wordpress/remediate", {
        method: "POST",
        headers: { "content-type": "application/json", "x-seogrow-rollback": "1" },
        body: JSON.stringify({
          url: record.sourceUrl,
          username: record.username || profile?.username || "",
          applicationPassword: password,
          resource: record.resource,
          id: record.entityId,
          changes,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Rollback WordPress non riuscito");
      const updated = await updateCorrection(id, {
        status: "Ripristinato",
        rollbackAt: new Date().toISOString(),
        rollbackNote: "Versione precedente ripristinata e confermata da WordPress.",
      });
      if (updated) reopenTask(updated);
      setMessage("Rollback completato. La Task relativa è stata riaperta.");
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
          <h1>Correzioni — storico e rollback</h1>
          <p>Modifiche applicate dall’agente, verifica SeoGrow, confronto Prima/Dopo e ripristino della versione precedente.</p>
        </div>
        <div className="corrections-filter">
          <button type="button" className={!showAll ? "primary" : "secondary"} onClick={() => setShowAll(false)}>Ultimo batch</button>
          <button type="button" className={showAll ? "primary" : "secondary"} onClick={() => setShowAll(true)}>Tutto lo storico</button>
        </div>
      </div>

      <div className="corrections-stats">
        <section><strong>{stats.total}</strong><span>Correzioni</span></section>
        <section className="verified"><strong>{stats.verified}</strong><span>Verificate</span></section>
        <section className="pending"><strong>{stats.pending}</strong><span>Da verificare</span></section>
        <section className="rolled"><strong>{stats.rolledBack}</strong><span>Ripristinate</span></section>
      </div>

      <section className="panel corrections-security">
        <div><ShieldCheck /><span><strong>Rollback WordPress</strong><small>La password applicativa viene usata solo per questa sessione e non viene salvata.</small></span></div>
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password applicativa WordPress" autoComplete="new-password" />
      </section>

      {message && <p className="integration-result corrections-message">{message}</p>}

      <div className="corrections-list">
        {rows.map((record) => (
          <article className="panel correction-card" key={record.id}>
            <div className="correction-card-head">
              <div>
                <span className={`correction-status ${statusClass(record.status)}`}>{record.status === "Verificato" ? <CheckCircle2 /> : record.status === "Ripristinato" ? <RotateCcw /> : <XCircle />}{record.status}</span>
                <h2>{record.issueLabel}</h2>
                <a href={record.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink />{record.sourceUrl}</a>
              </div>
              <div className="correction-meta">
                <span>{new Date(record.appliedAt).toLocaleString("it-IT")}</span>
                <small>{record.fields?.join(", ") || "modifica WordPress"}</small>
              </div>
            </div>

            <div className="correction-diff-grid">
              <section className="before"><strong>Prima</strong>{(record.fields || Object.keys(record.before || {})).map((field) => <div key={`before-${field}`}><small>{field}</small><p>{preview(record.before?.[field])}</p>{String(record.before?.[field] || "").length > 360 && <details><summary>Mostra contenuto completo</summary><pre>{String(record.before?.[field] || "")}</pre></details>}</div>)}</section>
              <section className="after"><strong>Dopo</strong>{(record.fields || Object.keys(record.after || {})).map((field) => <div key={`after-${field}`}><small>{field}</small><p>{preview(record.after?.[field])}</p>{String(record.after?.[field] || "").length > 360 && <details><summary>Mostra contenuto completo</summary><pre>{String(record.after?.[field] || "")}</pre></details>}</div>)}</section>
            </div>

            <div className="correction-footer">
              <span>{record.verificationNote || record.rollbackNote || "Modifica registrata."}</span>
              <button type="button" className="secondary" disabled={rollingBack === record.id || record.status === "Ripristinato"} onClick={() => rollback(record.id)}><RotateCcw />{rollingBack === record.id ? "Ripristino…" : "Ripristina versione precedente"}</button>
            </div>
          </article>
        ))}
        {!rows.length && <section className="panel corrections-empty"><History /><h2>Nessuna correzione registrata</h2><p>Le prossime remediation WordPress appariranno qui con Prima/Dopo e rollback.</p></section>}
      </div>
    </div>,
    mainTarget,
  ) : null;

  return <>{nav}{page}</>;
}
