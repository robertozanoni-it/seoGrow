import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, ExternalLink, Plug, Sparkles, Wrench } from "lucide-react";
import { apiFetch } from "./api";
import { normalizeAnalysisHistory } from "./platform";
import "./AuditUnifiedRemediation.css";

const fetch = apiFetch;
const CLIENTS_KEY = "seogrow-clients";
const SELECTED_CLIENT_KEY = "seogrow-selected-client-v1";
const CMS_ROUTER_KEY = "seogrow-cms-router-v1";
const WORDPRESS_PROFILES_KEY = "seogrow-wordpress-profiles-v1";
const PAGE_HISTORY_KEY = "seogrow-page-audit-history-v2";
const SITE_HISTORY_KEY = "seogrow-analyses-v2";

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};

const writeJson = (key, value) => {
  const serialized = JSON.stringify(value);
  localStorage.setItem(key, serialized);
  window.dispatchEvent(new StorageEvent("storage", { key, newValue: serialized }));
};

const candidates = (clientId) => {
  const pages = readJson(PAGE_HISTORY_KEY, {})[clientId] || [];
  const sites = normalizeAnalysisHistory(readJson(SITE_HISTORY_KEY, {})[clientId]);
  return [
    ...(Array.isArray(pages) ? pages.map((item) => ({ type: "page", item })) : []),
    ...sites.map((item) => ({ type: "site", item })),
  ].toSorted((a, b) => Date.parse(b.item?.analyzedAt || b.item?.startedAt || 0) - Date.parse(a.item?.analyzedAt || a.item?.startedAt || 0));
};

const issueUrl = (issue, audit, client) => issue?.targetUrl || issue?.url || audit?.url || client?.url || "";

const platformLabel = (platform) => platform === "wordpress" ? "WordPress + Elementor" : platform === "gptsites" ? "GPTSites" : "Manuale / altro CMS";

const isHighImpact = (issue) => {
  const text = `${issue?.type || ""} ${issue?.label || ""} ${issue?.detail || ""}`.toLowerCase();
  return ["redirect", "canonical", "noindex", "robots", "sitemap", "elimina", "delete", "url"].some((term) => text.includes(term));
};

const buildJob = ({ platform, client, auditType, audit, issues }) => {
  const rows = issues.map((issue, i) => `${i + 1}. ${issue.label || "Problema SEO"}\n   URL: ${issueUrl(issue, audit, client)}\n   Severità: ${issue.severity || "media"}\n   Dettaglio: ${issue.detail || "Nessun dettaglio aggiuntivo."}`).join("\n\n");
  const destination = platformLabel(platform).toUpperCase();
  const rules = platform === "wordpress"
    ? "Usa WordPress/Elementor e gli adapter realmente disponibili. Modifica solo le risorse coinvolte; per Elementor modifica solo i widget necessari. Prima di redirect, canonical, noindex, robots, sitemap, URL, eliminazioni o modifiche strutturali controlla dipendenze, indicizzazione, regressioni e reversibilità. Se la soluzione è inequivocabile applicala; se è ambigua, segnala solo quel caso e continua con gli altri."
    : platform === "gptsites"
      ? "Lavora nel Site collegato. Verifica ogni problema prima di modificarlo. Usa preview/versione reversibile e applica la modifica minima necessaria."
      : "Prepara istruzioni CMS-agnostiche e non dichiarare applicata alcuna modifica.";
  return `JOB AGENTICO ${destination} — ${issues.length === 1 ? "VERIFICA E CORREGGI" : "BULK REMEDIATION"}\n\nPROGETTO\n${client.name}\n${client.url}\n\nORIGINE\nAudit ${auditType === "page" ? "pagina" : "sito completo"}.\n\nPROBLEMI\n${rows}\n\nCONTROLLO PRELIMINARE\nVerifica che ogni problema sia ancora presente, che la pagina abbia lo stesso intento e che la correzione proposta non introduca regressioni.\n\nESECUZIONE\n${rules}\nNon fermare l'intero batch per un singolo caso ambiguo. Continua con i casi verificabili e registra l'eccezione.\n\nREPORT FINALE\nRestituisci analizzati, corretti, già risolti, eccezioni, non correggibili, pagine modificate e dettagli delle modifiche. Poi esegui un controllo finale e lascia il progetto pronto per un nuovo audit SeoGrow.`;
};

const resolveTarget = () => {
  try { if (decodeURIComponent(window.location.hash.slice(1)) !== "Audit SEO") return null; } catch { return null; }
  return document.querySelector(".audit-enhancer-root .gptsites-bulk-slot");
};

export default function AuditUnifiedRemediation() {
  const [target, setTarget] = useState(null);
  const [tick, setTick] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [platform, setPlatform] = useState("manual");
  const [job, setJob] = useState("");
  const [message, setMessage] = useState("");
  const [verifying, setVerifying] = useState(false);

  const clients = readJson(CLIENTS_KEY, []);
  const clientId = Number(readJson(SELECTED_CLIENT_KEY, clients[0]?.id));
  const client = clients.find((item) => item.id === clientId) || clients[0];
  const profile = readJson(WORDPRESS_PROFILES_KEY, {})[clientId] || null;
  const saved = readJson(CMS_ROUTER_KEY, {})[clientId]?.platform;
  const inferred = saved || (profile ? "wordpress" : "manual");
  const latest = client ? candidates(clientId)[0] : null;
  const issues = Array.isArray(latest?.item?.issues) ? latest.item.issues : [];
  const issue = issues[selectedIndex] || issues[0] || null;
  const url = useMemo(() => issueUrl(issue, latest?.item, client), [issue, latest?.item, client, tick]);

  useEffect(() => { setPlatform(inferred); }, [inferred, clientId, tick]);

  useEffect(() => {
    const sync = () => { setTarget(resolveTarget()); setTick((v) => v + 1); };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    const open = (event) => {
      const request = event.detail || {};
      if (Number(request.clientId) !== clientId) return;
      if (request.issueIndex != null) setSelectedIndex(Number(request.issueIndex));
      setTimeout(() => document.querySelector(".audit-unified-remediation")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    };
    window.addEventListener("seogrow-remediation-open", open);
    window.addEventListener("hashchange", sync);
    window.addEventListener("seogrow-locationchange", sync);
    window.addEventListener("storage", sync);
    return () => {
      observer.disconnect();
      window.removeEventListener("seogrow-remediation-open", open);
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("seogrow-locationchange", sync);
      window.removeEventListener("storage", sync);
    };
  }, [clientId]);

  if (!target || !client || !latest?.item || !issues.length) return null;

  const savePlatform = (next) => {
    setPlatform(next); setJob(""); setMessage("");
    writeJson(CMS_ROUTER_KEY, { ...readJson(CMS_ROUTER_KEY, {}), [clientId]: { platform: next, updatedAt: new Date().toISOString() } });
  };

  const prepare = async (all = false) => {
    const selectedIssues = all ? issues : [issue];
    if (!selectedIssues.length) return;
    setMessage("");
    const fallback = buildJob({ platform, client, auditType: latest.type, audit: latest.item, issues: selectedIssues });
    setJob(fallback);
    try {
      const response = await fetch("/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic: `Remediation SEO ${platformLabel(platform)}`, type: "job agentico di correzione SEO", context: fallback }) });
      const data = await response.json();
      if (response.ok && data.content) setJob(String(data.content).trim());
    } catch { /* fallback già disponibile */ }
    try { await navigator.clipboard.writeText(fallback); setMessage(`Job ${platformLabel(platform)} preparato e copiato.`); } catch { setMessage(`Job ${platformLabel(platform)} preparato.`); }
  };

  const verify = async () => {
    if (!url) return;
    setVerifying(true); setMessage("Verifica SeoGrow in corso…");
    try {
      const response = await fetch("/api/audit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Verifica non riuscita");
      const present = (data.issues || []).some((item) => String(item.label || "").trim().toLowerCase() === String(issue?.label || "").trim().toLowerCase());
      setMessage(present ? "Il problema selezionato è ancora presente." : "Il problema selezionato non risulta più presente.");
    } catch (error) { setMessage(`Verifica non riuscita: ${error.message}`); }
    finally { setVerifying(false); }
  };

  const risk = isHighImpact(issue);
  return createPortal(
    <section className="panel audit-unified-remediation">
      <div className="panel-head">
        <div><h2>Correzione automatica</h2><p>Prima scegli la piattaforma. Poi puoi correggere un problema oppure l’intero audit.</p></div>
        <span className="audit-unified-badge"><Wrench />{issues.length} problemi</span>
      </div>
      <div className="audit-unified-platforms" role="group" aria-label="Piattaforma del progetto">
        {[["gptsites", "GPTSites"], ["wordpress", "WordPress + Elementor"], ["manual", "Manuale"]].map(([value, label]) => <button key={value} type="button" className={platform === value ? "active" : ""} onClick={() => savePlatform(value)}>{label}</button>)}
      </div>
      <div className="audit-unified-grid">
        <label>Problema da correggere<select value={selectedIndex} onChange={(e) => setSelectedIndex(Number(e.target.value))}>{issues.map((item, i) => <option key={`${item.label}-${i}`} value={i}>{i + 1}. {item.label || "Problema SEO"}</option>)}</select></label>
        <div className="audit-unified-summary"><strong>{platformLabel(platform)}</strong><span>{profile && platform === "wordpress" ? `Profilo WordPress: ${profile.username || "connesso"}` : platform === "wordpress" ? "Profilo WordPress da configurare" : ""}</span></div>
      </div>
      <div className="audit-unified-issue"><div><strong>{issue?.label}</strong><small>{issue?.detail || "Nessun dettaglio aggiuntivo."}</small>{risk && <small className="risk">Controllo preliminare obbligatorio prima della modifica.</small>}</div>{url && <a href={url} target="_blank" rel="noreferrer"><ExternalLink />Apri pagina</a>}</div>
      <div className="audit-unified-actions">
        <button type="button" className="primary" onClick={() => prepare(true)}><Sparkles />Correggi tutti ({issues.length})</button>
        <button type="button" className="secondary" onClick={() => prepare(false)}><Sparkles />Correggi questo problema</button>
        <button type="button" className="secondary" onClick={verify} disabled={verifying}><Check />{verifying ? "Verifica…" : "Verifica con SeoGrow"}</button>
        {platform === "wordpress" && !profile && <button type="button" className="secondary" onClick={() => { localStorage.setItem("seogrow-selected-page-v1", JSON.stringify("Integrazioni")); window.location.hash = encodeURIComponent("Integrazioni"); }}><Plug />Configura WordPress</button>}
      </div>
      {job && <label className="audit-unified-job">Job operativo<textarea value={job} onChange={(e) => setJob(e.target.value)} /><button type="button" className="secondary" onClick={() => navigator.clipboard.writeText(job).then(() => setMessage("Job copiato.")).catch(() => setMessage("Copia non riuscita."))}><Copy />Copia job</button></label>}
      <div className="audit-unified-note"><strong>{platformLabel(platform)}</strong><span>Il job impone controllo preliminare, modifica minima, verifica di regressione e report finale. SeoGrow non dichiara una modifica applicata finché il canale di scrittura reale della piattaforma non ha confermato l’esecuzione.</span></div>
      {message && <p className="integration-result">{message}</p>}
    </section>, target,
  );
}
