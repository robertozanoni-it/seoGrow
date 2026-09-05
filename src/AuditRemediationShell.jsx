import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ExternalLink, ListChecks, Search, ShieldCheck, Target } from "lucide-react";
import { normalizeAnalysisHistory } from "./platform";
import { isIssueResolved } from "./issueIdentity";
import "./AuditUnifiedRemediation.css";

const CLIENTS_KEY = "seogrow-clients";
const SELECTED_CLIENT_KEY = "seogrow-selected-client-v1";
const WORDPRESS_PROFILES_KEY = "seogrow-wordpress-profiles-v1";
const PAGE_HISTORY_KEY = "seogrow-page-audit-history-v2";
const SITE_HISTORY_KEY = "seogrow-analyses-v2";

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};

const currentPage = () => {
  try { return decodeURIComponent(window.location.hash.slice(1)); } catch { return ""; }
};

const auditTimestamp = (entry) => entry?.item?.analyzedAt || entry?.item?.startedAt || "";

const candidates = (clientId) => {
  const pages = readJson(PAGE_HISTORY_KEY, {})[clientId] || [];
  const sites = normalizeAnalysisHistory(readJson(SITE_HISTORY_KEY, {})[clientId]);
  return [
    ...(Array.isArray(pages) ? pages.map((item) => ({ type: "page", item })) : []),
    ...sites.map((item) => ({ type: "site", item })),
  ].toSorted((a, b) => Date.parse(auditTimestamp(b) || 0) - Date.parse(auditTimestamp(a) || 0));
};

const selectAudit = (clientId, requested) => {
  const list = candidates(clientId);
  if (!requested) return list[0] || null;
  if (Number(requested.clientId) !== Number(clientId)) return list[0] || null;
  const match = list.find((entry) =>
    entry.type === requested.auditType &&
    String(auditTimestamp(entry)) === String(requested.analyzedAt || ""),
  );
  return match || list[0] || null;
};

const issueUrl = (issue, audit, client) =>
  issue?.targetUrl || issue?.url || issue?.sourceUrl || audit?.url || client?.url || "";

export default function AuditRemediationShell() {
  const [target, setTarget] = useState(null);
  const [revision, setRevision] = useState(0);
  const [requested, setRequested] = useState(null);
  const [selectedOriginalIndex, setSelectedOriginalIndex] = useState(0);
  const [password, setPassword] = useState("");

  useEffect(() => {
    const sync = () => {
      const active = currentPage() === "Audit SEO";
      setTarget(active ? document.querySelector(".audit-enhancer-root .gptsites-bulk-slot") : null);
      setRevision((value) => value + 1);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("hashchange", sync);
    window.addEventListener("seogrow-locationchange", sync);
    const storage = () => setRevision((value) => value + 1);
    window.addEventListener("storage", storage);
    const open = (event) => {
      const detail = event?.detail || {};
      setRequested({
        clientId: Number(detail.clientId),
        issueIndex: Number(detail.issueIndex || 0),
        auditType: detail.auditType || "page",
        analyzedAt: detail.analyzedAt || "",
      });
      setSelectedOriginalIndex(Number(detail.issueIndex || 0));
      window.setTimeout(() => document.querySelector(".audit-unified-remediation")?.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
    };
    window.addEventListener("seogrow-remediation-open", open);
    return () => {
      observer.disconnect();
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("seogrow-locationchange", sync);
      window.removeEventListener("storage", storage);
      window.removeEventListener("seogrow-remediation-open", open);
    };
  }, []);

  const model = useMemo(() => {
    void revision;
    const clients = readJson(CLIENTS_KEY, []);
    const clientId = Number(readJson(SELECTED_CLIENT_KEY, clients[0]?.id));
    const client = clients.find((item) => Number(item.id) === clientId) || clients[0] || null;
    const audit = client ? selectAudit(clientId, requested) : null;
    const allIssues = Array.isArray(audit?.item?.issues) ? audit.item.issues : [];
    const activeIssues = allIssues
      .map((issue, index) => ({ issue, index, url: issueUrl(issue, audit?.item, client) }))
      .filter((entry) => !isIssueResolved(clientId, entry.issue, entry.url));
    const profile = readJson(WORDPRESS_PROFILES_KEY, {})[clientId] || null;
    return { clients, clientId, client, audit, allIssues, activeIssues, profile };
  }, [requested, revision]);

  useEffect(() => {
    if (!model.activeIssues.length) return;
    if (!model.activeIssues.some((entry) => entry.index === selectedOriginalIndex)) {
      setSelectedOriginalIndex(model.activeIssues[0].index);
    }
  }, [model.activeIssues, selectedOriginalIndex]);

  if (!target || !model.client || !model.audit) return null;

  const selectedEntry = model.activeIssues.find((entry) => entry.index === selectedOriginalIndex) || model.activeIssues[0] || null;
  const issue = selectedEntry?.issue || null;
  const url = selectedEntry?.url || "";
  const username = model.profile?.username || "";
  const wpUrl = model.profile?.url || model.client.url || "";

  return createPortal(
    <section className="panel audit-unified-remediation" data-audit-type={model.audit.type} data-audit-analyzed-at={auditTimestamp(model.audit)}>
      <div className="audit-remediation-head">
        <div>
          <span className="audit-remediation-kicker"><ShieldCheck /> Remediation controllata</span>
          <h2>Correzione automatica</h2>
          <p>Un solo flusso: selezione problema → anteprima → approvazione → applicazione → riverifica.</p>
        </div>
        <span className="audit-unified-badge"><ListChecks />{model.activeIssues.length} da correggere / {model.allIssues.length} rilevati</span>
      </div>

      <section className="audit-unified-credentials">
        <div className="audit-card-title"><ShieldCheck /><div><strong>Connessione WordPress</strong><span>La password applicativa resta solo nella memoria della pagina e non viene salvata.</span></div></div>
        <div className="audit-unified-credential-grid">
          <label>URL del sito<input value={wpUrl} readOnly autoComplete="url" /></label>
          <label>Utente WordPress<input value={username} readOnly autoComplete="username" /></label>
          <label>Password applicativa<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="xxxx xxxx xxxx xxxx" autoComplete="new-password" /></label>
        </div>
      </section>

      {model.activeIssues.length ? (
        <div className="audit-remediation-context-row">
          <section className="audit-context-card issue-select-card">
            <div className="audit-card-title purple"><ListChecks /><strong>Problema da correggere</strong></div>
            <label className="audit-issue-select">
              <select value={selectedEntry?.index ?? ""} onChange={(event) => setSelectedOriginalIndex(Number(event.target.value))}>
                {model.activeIssues.map((entry, position) => (
                  <option key={`${entry.index}-${entry.issue?.label || "issue"}`} value={entry.index}>
                    {position + 1}. {entry.issue?.label || "Problema SEO"}
                  </option>
                ))}
              </select>
            </label>
          </section>
          <section className="audit-context-card issue-detail-card">
            <div className="audit-card-title violet"><Search /><strong>Dettaglio problema</strong></div>
            <div className="audit-unified-issue">
              <div><strong>{issue?.label || "Problema SEO"}</strong><small>{issue?.detail || "Nessun dettaglio aggiuntivo."}</small></div>
              {url && <a href={url} target="_blank" rel="noreferrer"><ExternalLink />Apri pagina</a>}
            </div>
          </section>
          <section className="audit-context-card target-card">
            <div className="audit-card-title green"><Target /><strong>Target WordPress + Elementor</strong></div>
            <div className="audit-unified-summary"><span>Profilo in uso</span><strong>{username || "Configura WordPress nelle Integrazioni"}</strong></div>
          </section>
        </div>
      ) : (
        <section className="panel success"><Check />Tutti i problemi di questo audit risultano verificati oppure non sono più attivi.</section>
      )}

      <div className="audit-workflow" aria-label="Flusso di remediation">
        <section className="audit-step audit-step-blue"><div className="audit-step-head"><span>1</span><Search /><strong>Audit</strong></div><p>Problema attivo e URL target.</p></section>
        <section className="audit-step audit-step-amber"><div className="audit-step-head"><span>2</span><ShieldCheck /><strong>Ownership</strong></div><p>Il campo da modificare deve alimentare davvero il frontend.</p></section>
        <section className="audit-step audit-step-green"><div className="audit-step-head"><span>3</span><Target /><strong>Applicazione</strong></div><p>Scrittura minima solo dopo approvazione esplicita.</p></section>
        <section className="audit-step audit-step-violet"><div className="audit-step-head"><span>4</span><Check /><strong>Riverifica</strong></div><p>Solo la verifica chiude la Task.</p></section>
      </div>
    </section>,
    target,
  );
}
