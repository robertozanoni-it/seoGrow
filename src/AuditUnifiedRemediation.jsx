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
  return ["redirect", "canonical", "noindex", "robots", "sitemap", "elimina", "delete"].some((term) => text.includes(term));
};

const classifyIssue = (issue) => {
  const text = `${issue?.type || ""} ${issue?.label || ""} ${issue?.detail || ""}`.toLowerCase();
  if (/title|titolo/.test(text)) return "title";
  if (/contenuto|content|testo|parole|word|brev/.test(text)) return "content";
  if (/excerpt|estratto/.test(text)) return "excerpt";
  if (/h1/.test(text)) return "h1";
  return null;
};

const buildJob = ({ platform, client, auditType, audit, issues }) => {
  const rows = issues.map((issue, i) => `${i + 1}. ${issue.label || "Problema SEO"}\n   URL: ${issueUrl(issue, audit, client)}\n   Severità: ${issue.severity || "media"}\n   Dettaglio: ${issue.detail || "Nessun dettaglio aggiuntivo."}`).join("\n\n");
  const destination = platformLabel(platform).toUpperCase();
  const rules = platform === "wordpress"
    ? "Usa l'adapter WordPress reale. Prima verifica che il problema sia ancora presente. Applica solo title, contenuto, excerpt o altre proprietà esplicitamente supportate. Non sovrascrivere _elementor_data e non toccare redirect/canonical/noindex/robots/URL senza un adapter dedicato."
    : platform === "gptsites"
      ? "Lavora nel Site collegato. Verifica ogni problema prima di modificarlo e applica la modifica minima necessaria."
      : "Prepara istruzioni CMS-agnostiche e non dichiarare applicata alcuna modifica.";
  return `JOB AGENTICO ${destination} — ${issues.length === 1 ? "VERIFICA E CORREGGI" : "BULK REMEDIATION"}\n\nPROGETTO\n${client.name}\n${client.url}\n\nORIGINE\nAudit ${auditType === "page" ? "pagina" : "sito completo"}.\n\nPROBLEMI\n${rows}\n\nCONTROLLO PRELIMINARE\nVerifica che ogni problema sia ancora presente e che la correzione non introduca regressioni.\n\nESECUZIONE\n${rules}\nNon fermare l'intero batch per un singolo caso ambiguo o non supportato: registralo e continua.\n\nREPORT FINALE\nRestituisci analizzati, corretti, già risolti, eccezioni, non correggibili, pagine modificate e dettagli delle modifiche. Poi esegui un controllo finale SeoGrow.`;
};
const resolveTarget = () => {
  try { if (decodeURIComponent(window.location.hash.slice(1)) !== "Audit SEO") return null; } catch { return null; }
  return document.querySelector(".audit-enhancer-root .gptsites-bulk-slot");
};

function extractJson(text) {
  const source = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(source); } catch { /* continua */ }
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(source.slice(start, end + 1)); } catch { return null; }
  }
  return null;
}

export default function AuditUnifiedRemediation() {
  const [target, setTarget] = useState(null);
  const [tick, setTick] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [platform, setPlatform] = useState("manual");
  const [job, setJob] = useState("");
  const [message, setMessage] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [running, setRunning] = useState(false);
  const [wpPassword, setWpPassword] = useState("");
  const [wpUsername, setWpUsername] = useState("");
  const [wpUrl, setWpUrl] = useState("");
  const [report, setReport] = useState([]);

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
    if (profile) {
      setWpUsername((value) => value || profile.username || "");
      setWpUrl((value) => value || profile.url || client?.url || "");
    } else if (client?.url) setWpUrl((value) => value || client.url);
  }, [profile, client?.url]);
  useEffect(() => {
    const sync = () => {
      const next = resolveTarget();
      setTarget((previous) => previous === next ? previous : next);
      setTick((v) => v + 1);
    };
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
  const inspectWordPress = async (targetUrl = url) => {
    if (!wpUrl || !wpUsername || !wpPassword) throw new Error("Inserisci URL WordPress, utente e password applicativa.");
    const response = await fetch("/api/wordpress/inspect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: targetUrl || wpUrl, username: wpUsername, applicationPassword: wpPassword }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Connessione WordPress non riuscita");
    return data;
  };
  const generatePatch = async (issueToFix, inspected) => {
    const kind = classifyIssue(issueToFix);
    if (!kind) return null;
    const current = inspected.entity || {};
    const context = JSON.stringify({ issue: issueToFix, page: { title: current.title?.raw || current.title?.rendered || "", content: current.content?.raw || current.content?.rendered || "", excerpt: current.excerpt?.raw || current.excerpt?.rendered || "" } });
    const instruction = kind === "title"
      ? "Genera un nuovo title SEO naturale, specifico per la pagina e coerente con l'intento. Restituisci SOLO JSON: {\"changes\":{\"title\":\"...\"}}. Non usare clickbait."
      : kind === "excerpt"
        ? "Genera un excerpt utile e naturale di circa 20-40 parole. Restituisci SOLO JSON: {\"changes\":{\"excerpt\":\"...\"}}."
        : kind === "h1"
          ? "Correggi il problema H1 senza riscrivere inutilmente il contenuto. Se manca un H1, inseriscine uno coerente all'inizio del contenuto. Restituisci SOLO JSON: {\"changes\":{\"content\":\"...\"}}."
          : "Migliora il contenuto esistente per risolvere il problema di contenuto breve. Mantieni informazioni e link utili, amplia in modo naturale e non inventare fatti. Restituisci SOLO JSON: {\"changes\":{\"content\":\"...\"}}.";
    const response = await fetch("/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic: `Remediation WordPress ${kind}`, type: instruction, context }) });
    const data = await response.json();
    if (!response.ok || !data.content) throw new Error(data.error || "Generazione patch non riuscita");
    const parsed = extractJson(data.content);
    if (!parsed?.changes || typeof parsed.changes !== "object") throw new Error("L'AI non ha restituito una patch strutturata valida.");
    return parsed.changes;
  };
  const applyIssue = async (issueToFix) => {
    const targetUrl = issueUrl(issueToFix, latest.item, client);
    const kind = classifyIssue(issueToFix);
    if (!kind) return { status: "unsupported", issue: issueToFix, reason: "Questo tipo di problema non è ancora supportato dall'adapter WordPress reale." };
    const inspected = await inspectWordPress(targetUrl);
    const changes = await generatePatch(issueToFix, inspected);
    if (!changes || !Object.keys(changes).length) return { status: "unsupported", issue: issueToFix, reason: "Nessuna patch applicabile generata." };
    const response = await fetch("/api/wordpress/remediate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: targetUrl, username: wpUsername, applicationPassword: wpPassword, resource: inspected.resource, id: inspected.entity.id, changes }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "WordPress non ha applicato la modifica");
    return { status: "corrected", issue: issueToFix, changes: data.changed || Object.keys(changes), url: data.link || targetUrl };
  };
  const runRemediation = async (all) => {
    if (platform !== "wordpress") { setMessage("Per l'applicazione automatica seleziona WordPress + Elementor."); return; }
    if (!wpPassword) { setMessage("Inserisci la password applicativa WordPress. Non viene salvata da SeoGrow."); return; }
    const selected = all ? issues : [issue];
    setRunning(true); setReport([]); setMessage(all ? `Avvio remediation di ${selected.length} problemi…` : "Avvio remediation del problema selezionato…");
    const results = [];
    for (const currentIssue of selected) {
      try { results.push(await applyIssue(currentIssue)); }
      catch (error) { results.push({ status: "exception", issue: currentIssue, reason: error.message }); }
      setReport([...results]);
    }
    const corrected = results.filter((item) => item.status === "corrected").length;
    const unsupported = results.filter((item) => item.status === "unsupported").length;
    const exceptions = results.filter((item) => item.status === "exception").length;
    setMessage(`Remediation completata: ${corrected} corretti, ${unsupported} non supportati, ${exceptions} eccezioni. Nessun caso ha bloccato il batch.`);
    setRunning(false);
  };
  const prepare = async (all = false) => {
    const selectedIssues = all ? issues : [issue];
    if (!selectedIssues.length) return;
    const fallback = buildJob({ platform, client, auditType: latest.type, audit: latest.item, issues: selectedIssues });
    setJob(fallback);
    try {
      const response = await fetch("/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic: `Remediation SEO ${platformLabel(platform)}`, type: "job agentico di correzione SEO", context: fallback }) });
      const data = await response.json();
      if (response.ok && data.content) setJob(String(data.content).trim());
    } catch { /* fallback */ }
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
      <div className="panel-head"><div><h2>Correzione automatica</h2><p>Audit → controllo preliminare → correzione → verifica. Il batch continua anche se un caso non è supportato.</p></div><span className="audit-unified-badge"><Wrench />{issues.length} problemi</span></div>
      <div className="audit-unified-platforms" role="group" aria-label="Piattaforma del progetto">
        {[["gptsites", "GPTSites"], ["wordpress", "WordPress + Elementor"], ["manual", "Manuale"]].map(([value, label]) => <button key={value} type="button" className={platform === value ? "active" : ""} onClick={() => savePlatform(value)}>{label}</button>)}
      </div>
      {platform === "wordpress" && <div className="audit-unified-credentials"><div><strong>Connessione WordPress per questa esecuzione</strong><span>La password applicativa viene usata solo in memoria e non viene salvata.</span></div><div className="audit-unified-credential-grid"><label>URL<input value={wpUrl} onChange={(e) => setWpUrl(e.target.value)} placeholder="https://example.com" autoComplete="url" /></label><label>Utente<input value={wpUsername} onChange={(e) => setWpUsername(e.target.value)} placeholder="utente WordPress" autoComplete="username" /></label><label>Password applicativa<input type="password" value={wpPassword} onChange={(e) => setWpPassword(e.target.value)} placeholder="xxxx xxxx xxxx xxxx" autoComplete="new-password" /></label></div></div>}
      <div className="audit-unified-grid"><label>Problema da correggere<select value={selectedIndex} onChange={(e) => setSelectedIndex(Number(e.target.value))}>{issues.map((item, i) => <option key={`${item.label}-${i}`} value={i}>{i + 1}. {item.label || "Problema SEO"}</option>)}</select></label><div className="audit-unified-summary"><strong>{platformLabel(platform)}</strong><span>{profile && platform === "wordpress" ? `Profilo WordPress: ${profile.username || "connesso"}` : platform === "wordpress" ? "Credenziali richieste per l'esecuzione" : ""}</span></div></div>
      <div className="audit-unified-issue"><div><strong>{issue?.label}</strong><small>{issue?.detail || "Nessun dettaglio aggiuntivo."}</small>{risk && <small className="risk">Controllo preliminare obbligatorio. L'adapter non applica automaticamente questo tipo di modifica.</small>}</div>{url && <a href={url} target="_blank" rel="noreferrer"><ExternalLink />Apri pagina</a>}</div>
      <div className="audit-unified-actions"><button type="button" className="primary" onClick={() => runRemediation(true)} disabled={running || platform !== "wordpress"}><Wrench />{running ? "Correzione in corso…" : `Correggi tutti (${issues.length})`}</button><button type="button" className="secondary" onClick={() => runRemediation(false)} disabled={running || platform !== "wordpress"}><Sparkles />Correggi questo problema</button><button type="button" className="secondary" onClick={verify} disabled={verifying || running}><Check />{verifying ? "Verifica…" : "Verifica con SeoGrow"}</button><button type="button" className="secondary" onClick={() => prepare(false)} disabled={running}><Copy />Prepara job</button>{platform === "wordpress" && !profile && <button type="button" className="secondary" onClick={() => { localStorage.setItem("seogrow-selected-page-v1", JSON.stringify("Integrazioni")); window.location.hash = encodeURIComponent("Integrazioni"); }}><Plug />Configura WordPress</button>}</div>
      {report.length > 0 && <div className="audit-unified-report"><strong>Report remediation</strong>{report.map((item, index) => <div key={`${item.issue?.label}-${index}`}><span>{item.status === "corrected" ? "✓" : "!"} {item.issue?.label || "Problema"}</span><small>{item.status === "corrected" ? `Corretto: ${(item.changes || []).join(", ")}` : item.reason}</small></div>)}</div>}
      {job && <label className="audit-unified-job">Job operativo<textarea value={job} onChange={(e) => setJob(e.target.value)} /><button type="button" className="secondary" onClick={() => navigator.clipboard.writeText(job).then(() => setMessage("Job copiato.")).catch(() => setMessage("Copia non riuscita."))}><Copy />Copia job</button></label>}
      <div className="audit-unified-note"><strong>Limiti controllati</strong><span>WordPress: modifica reale di title, contenuto, excerpt e H1 tramite REST. Elementor _elementor_data, meta description dei plugin SEO, redirect, canonical, noindex, robots, sitemap e cambi URL restano esplicitamente fuori dall'adapter finché non esiste un'integrazione dedicata.</span></div>
      {message && <p className="integration-result">{message}</p>}
    </section>, target,
  );
}
