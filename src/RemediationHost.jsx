import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, ListChecks, ShieldCheck, Sparkles, Target } from "lucide-react";
import { normalizeAnalysisHistory } from "./platform";
import { listCorrections, stableIssueKey } from "./remediationStore";
import { normalizeClientId, safeHttpHref } from "./reliabilityModel";
import "./RemediationHost.css";

const CLIENTS_KEY = "seogrow-clients";
const SELECTED_CLIENT_KEY = "seogrow-selected-client-v1";
const CMS_ROUTER_KEY = "seogrow-cms-router-v1";
const WORDPRESS_PROFILES_KEY = "seogrow-wordpress-profiles-v1";
const PAGE_HISTORY_KEY = "seogrow-page-audit-history-v2";
const SITE_HISTORY_KEY = "seogrow-analyses-v2";
const AGENT_PREFILL_KEY = "seogrow-agent-prefill-v1";

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};

const writeJson = (key, value) => {
  const serialized = JSON.stringify(value);
  localStorage.setItem(key, serialized);
  window.dispatchEvent(new StorageEvent("storage", { key, newValue: serialized }));
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

const issueUrl = (issue, audit, client) => issue?.targetUrl || issue?.url || audit?.url || client?.url || "";

const resolveTarget = () => {
  if (typeof document === "undefined") return null;
  try {
    if (decodeURIComponent(window.location.hash.slice(1)) !== "Audit SEO") return null;
  } catch { return null; }
  return document.querySelector(".audit-enhancer-root .gptsites-bulk-slot");
};

const platformLabel = (platform) => platform === "wordpress"
  ? "WordPress + Elementor"
  : platform === "gptsites"
    ? "GPTSites"
    : "Manuale / altro CMS";

export default function RemediationHost() {
  const [target, setTarget] = useState(() => resolveTarget());
  const [revision, setRevision] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [platformChoice, setPlatformChoice] = useState({ clientId: null, value: "" });
  const [wpDraft, setWpDraft] = useState({ clientId: null, username: "", url: "" });
  const [passwordDraft, setPasswordDraft] = useState({ clientId: null, value: "" });
  const [verifiedKeys, setVerifiedKeys] = useState(new Set());

  const clients = readJson(CLIENTS_KEY, []);
  const clientId = normalizeClientId(readJson(SELECTED_CLIENT_KEY, clients[0]?.id));
  const client = clients.find((item) => normalizeClientId(item?.id) === clientId) || null;
  const profile = clientId ? readJson(WORDPRESS_PROFILES_KEY, {})[clientId] || null : null;
  const savedPlatform = clientId ? readJson(CMS_ROUTER_KEY, {})[clientId]?.platform : "";
  const inferredPlatform = savedPlatform || (profile ? "wordpress" : "manual");
  const platform = platformChoice.clientId === clientId && platformChoice.value
    ? platformChoice.value
    : inferredPlatform;
  const latest = clientId ? candidates(clientId)[0] || null : null;
  const issues = Array.isArray(latest?.item?.issues) ? latest.item.issues : [];

  const issueKeyAt = (issue, index) => stableIssueKey({
    issue,
    issueType: issue?.type || "audit",
    issueLabel: issue?.label || "",
    sourceUrl: issueUrl(issue, latest?.item, client),
    issueIndex: index,
  });

  const issueEntries = issues.map((issue, index) => ({ issue, index, key: issueKeyAt(issue, index) }));
  const activeEntries = issueEntries.filter((entry) => !verifiedKeys.has(entry.key));
  const selectedCandidate = issueEntries.find((entry) => entry.index === selectedIndex) || null;
  const selectedEntry = selectedCandidate && !verifiedKeys.has(selectedCandidate.key)
    ? selectedCandidate
    : activeEntries[0] || issueEntries[0] || null;
  const selectedIssue = selectedEntry?.issue || null;
  const selectedUrl = safeHttpHref(issueUrl(selectedIssue, latest?.item, client));

  const wpUsername = wpDraft.clientId === clientId ? wpDraft.username : profile?.username || "";
  const wpUrl = wpDraft.clientId === clientId ? wpDraft.url : profile?.url || client?.url || "";
  const wpPassword = passwordDraft.clientId === clientId ? passwordDraft.value : "";

  useEffect(() => {
    let frame = 0;
    let attempts = 0;
    const scan = () => {
      const next = resolveTarget();
      setTarget((current) => current === next ? current : next);
      if (!next && attempts < 120) {
        attempts += 1;
        frame = window.requestAnimationFrame(scan);
      }
    };
    const refresh = () => {
      window.cancelAnimationFrame(frame);
      attempts = 0;
      setRevision((value) => value + 1);
      scan();
    };
    scan();
    window.addEventListener("hashchange", refresh);
    window.addEventListener("seogrow-locationchange", refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("seogrow-storage-ok", refresh);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", refresh);
      window.removeEventListener("seogrow-locationchange", refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("seogrow-storage-ok", refresh);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!clientId) return undefined;
    listCorrections({ clientId }).then((records) => {
      if (cancelled) return;
      setVerifiedKeys(new Set(
        records
          .filter((record) => record.status === "Verificato")
          .flatMap((record) => [record.issueKey, record.legacyIssueKey, stableIssueKey(record)].filter(Boolean)),
      ));
    }).catch(() => {
      if (!cancelled) setVerifiedKeys(new Set());
    });
    return () => { cancelled = true; };
  }, [clientId, revision]);

  useEffect(() => {
    const open = (event) => {
      const request = event?.detail || {};
      if (normalizeClientId(request.clientId) !== clientId) return;
      if (Number.isSafeInteger(Number(request.issueIndex))) setSelectedIndex(Number(request.issueIndex));
      window.setTimeout(() => document.querySelector(".audit-unified-remediation")?.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
    };
    window.addEventListener("seogrow-remediation-open", open);
    return () => window.removeEventListener("seogrow-remediation-open", open);
  }, [clientId]);

  if (!target || !client || !latest?.item || !issues.length) return null;

  const savePlatform = (next) => {
    setPlatformChoice({ clientId, value: next });
    writeJson(CMS_ROUTER_KEY, {
      ...readJson(CMS_ROUTER_KEY, {}),
      [clientId]: { platform: next, updatedAt: new Date().toISOString() },
    });
  };

  const updateWpDraft = (field, value) => {
    setWpDraft((current) => ({
      clientId,
      username: current.clientId === clientId ? current.username : profile?.username || "",
      url: current.clientId === clientId ? current.url : profile?.url || client?.url || "",
      [field]: value,
    }));
  };

  const askAgent = () => {
    if (!selectedIssue) return;
    const detail = {
      clientId,
      title: selectedIssue.label || selectedIssue.type || "Problema SEO",
      sourceUrl: issueUrl(selectedIssue, latest.item, client),
      problemState: selectedIssue.diagnosisState || "confirmed",
      evidence: [{ source: "Audit SeoGrow", detail: selectedIssue.detail || selectedIssue.label || "", at: auditTimestamp(latest) }],
      detail: selectedIssue.detail || "",
    };
    sessionStorage.setItem(AGENT_PREFILL_KEY, JSON.stringify(detail));
    window.history.pushState(null, "", `#${encodeURIComponent("SEO Agent")}`);
    window.dispatchEvent(new CustomEvent("seogrow-locationchange"));
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("seogrow-agent-prefill", { detail })), 0);
  };

  return createPortal(
    <section className="panel audit-unified-remediation remediation-host" data-remediation-platform={platform}>
      <div className="audit-remediation-head">
        <div>
          <span className="audit-remediation-kicker"><Sparkles /> Remediation guidata</span>
          <h2>Correzione controllata</h2>
          <p>Seleziona il problema e la piattaforma. Le modifiche WordPress live passano dal flusso V2 con anteprima, approvazione singola e riverifica.</p>
        </div>
        <span className="audit-unified-badge"><ListChecks />{activeEntries.length} attivi / {issues.length}</span>
      </div>

      <div className="audit-unified-platforms" role="group" aria-label="Piattaforma del progetto">
        {[["wordpress", "WordPress + Elementor"], ["gptsites", "GPTSites"], ["manual", "Manuale"]].map(([value, label]) => (
          <button key={value} type="button" className={platform === value ? "active" : ""} onClick={() => savePlatform(value)}>{label}</button>
        ))}
      </div>

      {platform === "wordpress" && <section className="audit-unified-credentials">
        <div className="audit-card-title"><ShieldCheck /><div><strong>Connessione WordPress</strong><span>La password applicativa resta solo in memoria per questa sessione e non viene salvata.</span></div></div>
        <div className="audit-unified-credential-grid">
          <label>URL del sito<input value={wpUrl} onChange={(event) => updateWpDraft("url", event.target.value)} placeholder="https://example.com" autoComplete="url" /></label>
          <label>Utente WordPress<input value={wpUsername} onChange={(event) => updateWpDraft("username", event.target.value)} placeholder="utente WordPress" autoComplete="username" /></label>
          <label>Password applicativa<input type="password" value={wpPassword} onChange={(event) => setPasswordDraft({ clientId, value: event.target.value })} placeholder="xxxx xxxx xxxx xxxx" autoComplete="new-password" /></label>
        </div>
      </section>}

      <div className="audit-remediation-context-row">
        <section className="audit-context-card issue-select-card">
          <div className="audit-card-title purple"><ListChecks /><strong>Problema da correggere</strong></div>
          <label className="audit-issue-select">
            <select value={selectedEntry?.index ?? 0} onChange={(event) => setSelectedIndex(Number(event.target.value))}>
              {issueEntries.map((entry) => (
                <option key={`${entry.key}-${entry.index}`} value={entry.index} disabled={verifiedKeys.has(entry.key)}>
                  {entry.index + 1}. {entry.issue?.label || "Problema SEO"}{verifiedKeys.has(entry.key) ? " · verificato" : ""}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="audit-context-card issue-detail-card">
          <div className="audit-card-title violet"><Target /><strong>Dettaglio problema</strong></div>
          <div className="audit-unified-issue">
            <div><strong>{selectedIssue?.label || selectedIssue?.type || "Problema SEO"}</strong><small>{selectedIssue?.detail || "Nessun dettaglio aggiuntivo."}</small></div>
            {selectedUrl && <a href={selectedUrl} target="_blank" rel="noreferrer"><ExternalLink />Apri pagina</a>}
          </div>
        </section>

        <section className="audit-context-card target-card">
          <div className="audit-card-title green"><Target /><strong>Target</strong></div>
          <div className="audit-unified-summary"><span>Piattaforma</span><strong>{platformLabel(platform)}</strong></div>
        </section>
      </div>

      {platform !== "wordpress" && <div className="audit-unified-note remediation-host-nonwp">
        <strong>Nessuna scrittura live automatica per questa piattaforma</strong>
        <span>Il problema selezionato può essere trasferito al SEO Agent con evidenza e URL, senza fingere che una modifica sia già stata applicata.</span>
        <button type="button" className="secondary" onClick={askAgent}><Sparkles />Apri nel SEO Agent</button>
      </div>}
    </section>,
    target,
  );
}
