import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, ExternalLink, History, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";
import { apiFetch } from "./api";
import { lastBatch, listCorrections, updateCorrection } from "./remediationStore";
import { verifyCorrectionRecord } from "./remediationIntegrityV2";
import { forgetResolvedIssue } from "./issueIdentity";
import { reopenTaskForIssue } from "./taskResolution";
import "./CorrectionsWorkspace.css";

const SELECTED_CLIENT_KEY = "seogrow-selected-client-v1";
const WORDPRESS_PROFILES_KEY = "seogrow-wordpress-profiles-v1";
const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const currentHash = () => { try { return decodeURIComponent(window.location.hash.slice(1)); } catch { return ""; } };
const isVerified = (row) => row.status === "Verificato";
const isPending = (row) => ["Applicato", "Da verificare"].includes(row.status);
const isRolled = (row) => row.status === "Ripristinato";

const nested = (value) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const out = {};
  const meta = {};
  for (const [key, item] of Object.entries(source)) {
    if (key.startsWith("meta.")) meta[key.slice(5)] = item;
    else if (key !== "meta") out[key] = item;
  }
  if (source.meta && typeof source.meta === "object" && !Array.isArray(source.meta)) Object.assign(meta, source.meta);
  if (Object.keys(meta).length) out.meta = meta;
  return out;
};

const valueText = (value) => typeof value === "string" ? value : JSON.stringify(value, null, 2);

export default function CorrectionsWorkspaceV3() {
  const [active, setActive] = useState(currentHash() === "Correzioni");
  const [navTarget, setNavTarget] = useState(null);
  const [mainTarget, setMainTarget] = useState(null);
  const [rows, setRows] = useState([]);
  const [revision, setRevision] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState("all");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState(() => new Set());

  const clientId = Number(readJson(SELECTED_CLIENT_KEY, 0));
  const profile = readJson(WORDPRESS_PROFILES_KEY, {})[clientId] || null;
  const batchId = lastBatch();

  useEffect(() => {
    const sync = () => {
      setNavTarget(document.querySelector(".sidebar nav"));
      setMainTarget(document.querySelector(".app main"));
      setActive(currentHash() === "Correzioni");
    };
    const timer = window.setTimeout(sync, 0);
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("hashchange", sync);
    window.addEventListener("seogrow-locationchange", sync);
    return () => { window.clearTimeout(timer); observer.disconnect(); window.removeEventListener("hashchange", sync); window.removeEventListener("seogrow-locationchange", sync); };
  }, []);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("storage", refresh);
    window.addEventListener("seogrow-remediation-history", refresh);
    return () => { window.removeEventListener("storage", refresh); window.removeEventListener("seogrow-remediation-history", refresh); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    listCorrections({ clientId: clientId || undefined, batchId: showAll ? undefined : batchId || undefined })
      .then((items) => { if (!cancelled) setRows(items); })
      .catch((error) => { if (!cancelled) setMessage(error.message); });
    return () => { cancelled = true; };
  }, [clientId, batchId, showAll, revision]);

  const visible = useMemo(() => rows.filter((row) => {
    if (filter === "verified") return isVerified(row);
    if (filter === "pending") return isPending(row);
    if (filter === "rolled") return isRolled(row);
    return true;
  }), [rows, filter]);

  const stats = useMemo(() => ({
    all: rows.length,
    verified: rows.filter(isVerified).length,
    pending: rows.filter(isPending).length,
    rolled: rows.filter(isRolled).length,
  }), [rows]);

  const recheckOne = async (record) => {
    setBusy(`verify:${record.id}`);
    const updated = await verifyCorrectionRecord(record);
    setMessage(updated?.verificationNote || "Riverifica completata.");
    setBusy("");
    setRevision((value) => value + 1);
  };

  const recheckAll = async () => {
    const pending = rows.filter(isPending);
    if (!pending.length) return setMessage("Nessuna correzione in attesa di verifica.");
    setBusy("verify-all");
    let verified = 0;
    for (let index = 0; index < pending.length; index += 1) {
      setMessage(`Riverifica ${index + 1}/${pending.length}: ${pending[index].issueLabel}…`);
      const updated = await verifyCorrectionRecord(pending[index]);
      if (updated?.status === "Verificato") verified += 1;
    }
    setMessage(`Riverifica completata: ${verified}/${pending.length} confermate.`);
    setBusy("");
    setRevision((value) => value + 1);
  };

  const rollback = async (record) => {
    if (!password) return setMessage("Inserisci la password applicativa WordPress.");
    if (!window.confirm(`Ripristinare “${record.issueLabel}”? Il ripristino sarà bloccato se il campo è cambiato dopo la correzione.`)) return;
    setBusy(`rollback:${record.id}`);
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
          changes: record.rollbackChanges || nested(record.before),
          expectedCurrent: record.rollbackExpectedCurrent || nested(record.after),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Rollback non riuscito.");
      const updated = await updateCorrection(record.id, { status: "Ripristinato", rollbackAt: new Date().toISOString(), rollbackNote: "Versione precedente ripristinata con controllo anti-sovrascrittura.", frontendConfirmed: false });
      if (updated) {
        forgetResolvedIssue(updated.clientId, updated.issue || { type: updated.issueType, label: updated.issueLabel }, updated.sourceUrl);
        reopenTaskForIssue(updated);
      }
      setMessage("Rollback completato; Task riaperta e storico conservato.");
      setRevision((value) => value + 1);
    } catch (error) {
      setMessage(`Rollback bloccato o non riuscito: ${error.message}`);
    } finally {
      setBusy("");
    }
  };

  const toggle = (id) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const nav = navTarget ? createPortal(
    <button type="button" className={active ? "active corrections-nav-button" : "corrections-nav-button"} onClick={() => { window.location.hash = encodeURIComponent("Correzioni"); }}><History /><span>Correzioni</span></button>, navTarget,
  ) : null;

  const page = active && mainTarget ? createPortal(
    <div className="corrections-workspace-root">
      <div className="page-title corrections-title">
        <div><h1>Correzioni</h1><p>WordPress scritto → frontend confermato → problema SEO assente → Task completata.</p></div>
        <div className="corrections-filter"><button className={!showAll ? "primary" : "secondary"} onClick={() => setShowAll(false)}>Ultimo batch</button><button className={showAll ? "primary" : "secondary"} onClick={() => setShowAll(true)}>Tutto lo storico</button><button className="secondary" disabled={busy === "verify-all"} onClick={recheckAll}><RefreshCw />Riverifica tutte</button></div>
      </div>
      <div className="corrections-stats">
        {[['all','Tutte',stats.all],['verified','Verificate',stats.verified],['pending','Da verificare',stats.pending],['rolled','Ripristinate',stats.rolled]].map(([id,label,count]) => <button key={id} className={filter === id ? "active" : ""} onClick={() => setFilter(id)}><strong>{count}</strong><span>{label}</span></button>)}
      </div>
      <section className="panel corrections-security"><div><ShieldCheck /><span><strong>Rollback protetto</strong><small>Non sovrascrive modifiche WordPress successive.</small></span></div><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password applicativa WordPress" autoComplete="new-password" /></section>
      {message && <p className="integration-result corrections-message" role="status">{message}</p>}
      <div className="corrections-list">
        {visible.map((record) => {
          const expanded = open.has(record.id);
          const verified = isVerified(record);
          return <article className={`panel correction-card ${expanded ? "open" : ""}`} key={record.id}>
            <button type="button" className="correction-summary" onClick={() => toggle(record.id)}><span className={`correction-status ${verified ? "verificato" : isRolled(record) ? "ripristinato" : "da-verificare"}`}>{verified ? <CheckCircle2 /> : <AlertTriangle />}{record.status}</span><span className="correction-summary-main"><strong>{record.issueLabel}</strong><small>{record.fields?.join(", ") || "modifica WordPress"}</small></span></button>
            <div className="correction-summary-actions"><a href={record.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink />Apri pagina</a>{!isRolled(record) && <button className="secondary mini" disabled={busy === `verify:${record.id}`} onClick={() => recheckOne(record)}><RefreshCw />Riverifica ora</button>}</div>
            <p className={`correction-verification-note ${verified ? "verified" : "pending"}`}>{record.verificationNote || record.rollbackNote || "Modifica registrata."}</p>
            {expanded && <div className="correction-details"><div className="correction-diff-grid"><section className="before"><strong>Prima</strong><pre>{valueText(record.before || {})}</pre></section><section className="after"><strong>Dopo</strong><pre>{valueText(record.after || {})}</pre></section></div><div className="correction-footer"><div><strong>{verified ? "Correzione confermata" : "Da riverificare"}</strong><span>{verified ? "La Task è Completata e resta nello storico." : "La scrittura WordPress non basta per chiudere la Task."}</span></div><button className="secondary" disabled={isRolled(record) || busy === `rollback:${record.id}`} onClick={() => rollback(record)}><RotateCcw />Ripristina versione precedente</button></div></div>}
          </article>;
        })}
        {!visible.length && <section className="panel corrections-empty"><History /><h2>Nessuna correzione in questo filtro</h2></section>}
      </div>
    </div>, mainTarget,
  ) : null;

  return <>{nav}{page}</>;
}
