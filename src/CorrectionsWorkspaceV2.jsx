import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, ChevronDown, ExternalLink, Eye, History, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";
import { apiFetch } from "./api";
import { lastBatch, listCorrections, readCorrection, updateCorrection } from "./remediationStore";
import { verifyCorrectionRecord } from "./remediationIntegrityV2";
import { forgetResolvedIssue } from "./issueIdentity";
import { reopenTaskForIssue } from "./taskResolution";
import "./CorrectionsWorkspace.css";

const SELECTED_CLIENT_KEY = "seogrow-selected-client-v1";
const WORDPRESS_PROFILES_KEY = "seogrow-wordpress-profiles-v1";

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};

const currentHash = () => {
  try { return decodeURIComponent(window.location.hash.slice(1)); } catch { return ""; }
};

const preview = (value, max = 500) => {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized || "—";
};

const statusClass = (status) => String(status || "").toLowerCase().replaceAll(" ", "-");
const isVerified = (record) => record.status === "Verificato";
const isPending = (record) => record.status === "Applicato" || record.status === "Da verificare";
const isRolledBack = (record) => record.status === "Ripristinato";

const nestedChanges = (value) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const direct = {};
  const meta = {};
  for (const [key, item] of Object.entries(source)) {
    if (key.startsWith("meta.")) meta[key.slice(5)] = item;
    else if (key !== "meta") direct[key] = item;
  }
  if (source.meta && typeof source.meta === "object" && !Array.isArray(source.meta)) Object.assign(meta, source.meta);
  if (Object.keys(meta).length) direct.meta = meta;
  return direct;
};

export default function CorrectionsWorkspaceV2() {
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
  const [busy, setBusy] = useState("");

  const selectedClientId = Number(readJson(SELECTED_CLIENT_KEY, 0));
  const batchId = lastBatch();
  const profile = readJson(WORDPRESS_PROFILES_KEY, {})[selectedClientId] || null;

  useEffect(() => {
    const sync = () => {
      setNavTarget(document.querySelector(".sidebar nav"));
      setMainTarget(document.querySelector(".app main"));
      setActive(currentHash() === "Correzioni");
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("hashchange", sync);
    window.addEventListener("seogrow-locationchange", sync);
    return () => { observer.disconnect(); window.removeEventListener("hashchange", sync); window.removeEventListener("seogrow-locationchange", sync); };
  }, []);

  useEffect(() => {
    const refresh = () => setVersion((value) => value + 1);
    window.addEventListener("storage", refresh);
    window.addEventListener("seogrow-remediation-history", refresh);
    return () => { window.removeEventListener("storage", refresh); window.removeEventListener("seogrow-remediation-history", refresh); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const filter = { clientId: selectedClientId || undefined, batchId: showAll ? undefined : batchId || undefined };
    listCorrections(filter)
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

  const toggleExpanded = (id) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const recheck = async (id) => {
    setBusy(`verify:${id}`);
    setMessage("Riverifica frontend e SEO in corso…");
    try {
      const record = await readCorrection(id);
      if (!record) throw new Error("Correzione non trovata.");
      const updated = await verifyCorrectionRecord(record);
      setMessage(updated?.status === "Verificato"
        ? "Correzione verificata: frontend e controllo SEO confermano il risultato."
        : updated?.verificationNote || "Correzione ancora da verificare.");
      setVersion((value) => value + 1);
    } catch (error) {
      setMessage(`Riverifica non riuscita: ${error.message}`);
    } finally {
      setBusy("");
    }
  };

  const recheckAll = async () => {
    const pending = rows.filter(isPending);
    if (!pending.length) {
      setMessage("Non ci sono correzioni in attesa di verifica in questo filtro.");
      return;
    }
    setBusy("verify-all");
    let verified = 0;
    let pendingCount = 0;
    for (let index = 0; index < pending.length; index += 1) {
      setMessage(`Riverifica ${index + 1}/${pending.length}: ${pending[index].issueLabel}…`);
      const updated = await verifyCorrectionRecord(pending[index]);
      if (updated?.status === "Verificato") verified += 1; else pendingCount += 1;
    }
    setMessage(`Riverifica completata: ${verified} confermate, ${pendingCount} ancora da verificare.`);
    setBusy("");
    setVersion((value) => value + 1);
  };

  const rollback = async (id) => {
    if (!password) {
      setMessage("Inserisci la password applicativa WordPress per eseguire il rollback.");
      return;
    }
    const record = await readCorrection(id);
    if (!record) return setMessage("Snapshot di rollback non disponibile.");
    const changes = record.rollbackChanges && typeof record.rollbackChanges === "object"
      ? record.rollbackChanges
      : nestedChanges(record.before);
    const expectedCurrent = record.rollbackExpectedCurrent && typeof record.rollbackExpectedCurrent === "object"
      ? record.rollbackExpectedCurrent
      : nestedChanges(record.after);
    if (!Object.keys(changes).length) return setMessage("Questa correzione non contiene una versione precedente ripristinabile.");
    if (!window.confirm(`Ripristinare la versione precedente per “${record.issueLabel}”? Il rollback verrà bloccato se il campo è cambiato dopo la correzione.`)) return;
    setBusy(`rollback:${id}`);
    setMessage("Controllo anti-sovrascrittura e rollback in corso…");
    try {
      const response = await apiFetch("/api/wordpress/live-rollback-v2", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          siteUrl: profile?.url || record.sourceUrl,
          targetUrl: record.sourceUrl,
          username: record.username || profile?.username || "",
          applicationPassword: password,
          resource: record.resource,
          id: record.entityId,
          changes,
          expectedCurrent,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Rollback WordPress non riuscito.");
      const updated = await updateCorrection(id, {
        status: "Ripristinato",
        rollbackAt: new Date().toISOString(),
        rollbackNote: "Versione precedente ripristinata con controllo anti-sovrascrittura.",
        frontendConfirmed: false,
      });
      if (updated) {
        forgetResolvedIssue(updated.clientId, updated.issue || { type: updated.issueType, label: updated.issueLabel }, updated.sourceUrl);
        reopenTaskForIssue(updated, "Task riaperta automaticamente dopo rollback.");
      }
      setMessage("Rollback completato. La Task è stata riaperta senza cancellare lo storico.");
      setVersion((value) => value + 1);
    } catch (error) {
      setMessage(`Rollback bloccato o non riuscito: ${error.message}`);
    } finally {
      setBusy("");
    }
  };

  const nav = navTarget ? createPortal(
    <button type="button" className={active ? "active corrections-nav-button" : "corrections-nav-button"} aria-current={active ? "page" : undefined} onClick={() => { window.location.hash = encodeURIComponent("Correzioni"); }}>
      <History /><span>Correzioni</span>
    </button>, navTarget,
  ) : null;

  const page = active && mainTarget ? createPortal(
    <div className="corrections-workspace-root">
      <div className="page-title corrections-title">
        <div><h1>Correzioni</h1><p>Una correzione è chiusa solo quando WordPress, frontend e nuovo controllo SEO concordano.</p></div>
        <div className="corrections-filter">
          <button type="button" className={!showAll ? "primary" : "secondary"} onClick={() => setShowAll(false)}>Ultimo batch</button>
          <button type="button" className={showAll ? "primary" : "secondary"} onClick={() => setShowAll(true)}>Tutto lo storico</button>
          <button type="button" className="secondary" disabled={busy === "verify-all"} onClick={recheckAll}><RefreshCw />{busy === "verify-all" ? "Riverifica…" : "Riverifica tutte"}</button>
        </div>
      </div>

      <section className="corrections-logic panel">
        <div><span>1</span><strong>Salvato in WordPress</strong><small>REST conferma la scrittura</small></div><i>→</i>
        <div><span>2</span><strong>Visibile sul sito</strong><small>prova sul frontend</small></div><i>→</i>
        <div><span>3</span><strong>Problema SEO risolto</strong><small>nuovo audit coerente</small></div><i>→</i>
        <div><span>4</span><strong>Task completata</strong><small>resta nello storico</small></div>
      </section>

      <div className="corrections-stats" aria-label="Filtra correzioni per stato">
        <button type="button" className={statusFilter === "all" ? "active" : ""} onClick={() => setStatusFilter("all")}><strong>{stats.total}</strong><span>Tutte</span></button>
        <button type="button" className={`verified ${statusFilter === "verified" ? "active" : ""}`} onClick={() => setStatusFilter("verified")}><strong>{stats.verified}</strong><span>Verificate</span></button>
        <button type="button" className={`pending ${statusFilter === "pending" ? "active" : ""}`} onClick={() => setStatusFilter("pending")}><strong>{stats.pending}</strong><span>Da verificare</span></button>
        <button type="button" className={`rolled ${statusFilter === "rolled" ? "active" : ""}`} onClick={() => setStatusFilter("rolled")}><strong>{stats.rolledBack}</strong><span>Ripristinate</span></button>
      </div>

      <section className="panel corrections-security">
        <div><ShieldCheck /><span><strong>Rollback WordPress</strong><small>La password serve solo per il ripristino e non viene salvata. Se il campo è stato modificato dopo, il rollback viene bloccato.</small></span></div>
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password applicativa WordPress" autoComplete="new-password" />
      </section>

      {message && <p className="integration-result corrections-message" role="status">{message}</p>}

      <div className="corrections-list">
        {filteredRows.map((record) => {
          const open = expanded.has(record.id);
          const verified = isVerified(record);
          const pending = isPending(record);
          return (
            <article className={`panel correction-card ${open ? "open" : ""}`} key={record.id}>
              <button type="button" className="correction-summary" onClick={() => toggleExpanded(record.id)} aria-expanded={open}>
                <span className={`correction-status ${statusClass(record.status)}`}>{verified ? <CheckCircle2 /> : pending ? <AlertTriangle /> : <RotateCcw />}{record.status}</span>
                <span className="correction-summary-main"><strong>{record.issueLabel}</strong><small>{record.fields?.join(", ") || "modifica WordPress"} · {new Date(record.appliedAt).toLocaleString("it-IT")}</small></span>
                <span className="correction-quick-state"><span className="ok">1 WordPress</span><span className={record.frontendConfirmed ? "ok" : "wait"}>2 Frontend</span><span className={verified ? "ok" : "wait"}>3 SEO</span><span className={verified ? "ok" : "wait"}>4 Task</span></span>
                <ChevronDown className="correction-chevron" />
              </button>
              <div className="correction-summary-actions">
                <a href={record.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink />Apri pagina</a>
                <button type="button" className="secondary mini" onClick={() => toggleExpanded(record.id)}><Eye />{open ? "Nascondi dettagli" : "Vedi Prima / Dopo"}</button>
                {!isRolledBack(record) && <button type="button" className="secondary mini" disabled={busy === `verify:${record.id}`} onClick={() => recheck(record.id)}><RefreshCw />{busy === `verify:${record.id}` ? "Verifica…" : "Riverifica ora"}</button>}
              </div>
              <p className={`correction-verification-note ${verified ? "verified" : "pending"}`}>{record.verificationNote || record.rollbackNote || "Modifica registrata."}</p>
              {record.lastVerificationError && <p className="correction-verification-note pending">Ultimo errore operativo: {record.lastVerificationError}</p>}
              {open && (
                <div className="correction-details">
                  <div className="correction-diff-grid">
                    <section className="before"><strong>Prima — versione precedente</strong>{Object.entries(record.before || {}).map(([field, value]) => <div key={`before-${field}`}><small>{field}</small><p>{preview(value)}</p>{String(value ?? "").length > 500 && <details><summary>Mostra contenuto completo</summary><pre>{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre></details>}</div>)}</section>
                    <section className="after"><strong>Dopo — versione inviata a WordPress</strong>{Object.entries(record.after || {}).map(([field, value]) => <div key={`after-${field}`}><small>{field}</small><p>{preview(value)}</p>{String(value ?? "").length > 500 && <details><summary>Mostra contenuto completo</summary><pre>{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre></details>}</div>)}</section>
                  </div>
                  <div className="correction-footer">
                    <div><strong>{verified ? "Correzione confermata" : "Correzione non ancora chiudibile"}</strong><span>{verified ? "Il frontend e il nuovo audit confermano il risultato. La Task è Completata e rimane nello storico." : "La scrittura WordPress da sola non basta: usa Riverifica ora."}</span></div>
                    <button type="button" className="secondary" disabled={busy === `rollback:${record.id}` || isRolledBack(record)} onClick={() => rollback(record.id)}><RotateCcw />{busy === `rollback:${record.id}` ? "Ripristino…" : "Ripristina versione precedente"}</button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
        {!filteredRows.length && <section className="panel corrections-empty"><History /><h2>Nessuna correzione in questo filtro</h2><p>Cambia filtro oppure prepara una nuova remediation.</p></section>}
      </div>
    </div>, mainTarget,
  ) : null;

  return <>{nav}{page}</>;
}
