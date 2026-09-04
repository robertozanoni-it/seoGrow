import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, ExternalLink, Sparkles, Wrench } from "lucide-react";
import { apiFetch } from "./api";
import { normalizeAnalysisHistory } from "./platform";
import "./AuditRemediationPanel.css";

const fetch = apiFetch;
const PAGE_HISTORY_KEY = "seogrow-page-audit-history-v2";
const SITE_HISTORY_KEY = "seogrow-analyses-v2";
const CLIENTS_KEY = "seogrow-clients";
const SELECTED_CLIENT_KEY = "seogrow-selected-client-v1";

const readJson = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};

const latestAudit = (clientId) => {
  const pages = readJson(PAGE_HISTORY_KEY, {})[clientId] || [];
  const sites = normalizeAnalysisHistory(readJson(SITE_HISTORY_KEY, {})[clientId]);
  const candidates = [
    ...(Array.isArray(pages) ? pages.map((item) => ({ type: "page", item })) : []),
    ...sites.map((item) => ({ type: "site", item })),
  ];
  return candidates.toSorted(
    (a, b) =>
      Date.parse(b.item?.analyzedAt || b.item?.startedAt || 0) -
      Date.parse(a.item?.analyzedAt || a.item?.startedAt || 0),
  )[0] || null;
};

const buildFallbackPrompt = ({ client, issue, auditType }) => {
  const issueUrl = issue.targetUrl || issue.url || client.url;
  return `MODIFICA MIRATA GPTSITES — ${client.name}\n\nPagina: ${issueUrl}\nProblema SEO rilevato: ${issue.label || "Problema SEO"}\nDettaglio: ${issue.detail || "Nessun dettaglio aggiuntivo disponibile."}\nSeverità: ${issue.severity || "media"}\nOrigine: audit ${auditType === "page" ? "pagina" : "sito completo"}.\n\nOBIETTIVO\nCorreggi esclusivamente il problema indicato sulla pagina specificata.\n\nVINCOLI\n- Non pubblicare automaticamente.\n- Non modificare URL, canonical, redirect, sitemap, noindex, tracciamenti o integrazioni se non sono l'oggetto esplicito della correzione.\n- Mantieni layout, stile, contenuti e funzionalità non coinvolti.\n- Non inventare dati, recensioni, credenziali o prove sociali.\n- Prima applica la modifica in preview, poi mostra esattamente cosa è cambiato.\n- Se la correzione richiede una scelta editoriale o strutturale non determinabile dai dati disponibili, fermati e chiedi approvazione.\n\nVERIFICA\nDopo la modifica, salva una nuova versione non pubblicata e indica come verificare che il problema SEO sia risolto.`;
};

function RemediationPanelView({ client, auditType, audit }) {
  const issues = Array.isArray(audit?.issues) ? audit.issues : [];
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [verification, setVerification] = useState("");
  const issue = issues[selectedIndex] || null;

  useEffect(() => {
    setPrompt("");
    setMessage("");
    setVerification("");
  }, [selectedIndex, audit?.analyzedAt]);

  const issueUrl = useMemo(
    () => issue?.targetUrl || issue?.url || audit?.url || client.url,
    [issue, audit?.url, client.url],
  );

  const prepare = async () => {
    if (!issue) return;
    setLoading(true);
    setMessage("");
    const fallback = buildFallbackPrompt({ client, issue, auditType });
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topic: `Correzione SEO: ${issue.label || "problema audit"}`,
          type: "istruzioni operative per GPTSites",
          context: JSON.stringify({
            progetto: client.name,
            sito: client.url,
            pagina: issueUrl,
            audit: auditType,
            problema: issue.label,
            dettaglio: issue.detail,
            severita: issue.severity,
            istruzione:
              "Genera un prompt operativo per ChatGPT Sites. Correggi solo il problema indicato. Non pubblicare. Preserva tutto ciò che non è coinvolto. Richiedi preview e verifica finale. Non inventare dati.",
          }),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Generazione non riuscita");
      setPrompt(String(data.content || "").trim() || fallback);
      setMessage(data.demo ? "Prompt preparato in modalità locale." : "Prompt di correzione preparato con AI.");
    } catch {
      setPrompt(fallback);
      setMessage("Prompt operativo preparato localmente.");
    } finally {
      setLoading(false);
    }
  };

  const copyPrompt = async () => {
    if (!prompt) await prepare();
    const text = prompt || buildFallbackPrompt({ client, issue, auditType });
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Prompt copiato: incollalo nel Site collegato in ChatGPT Sites.");
    } catch {
      setMessage("Copia automatica non riuscita: seleziona il testo e copialo manualmente.");
    }
  };

  const verify = async () => {
    if (!issueUrl) return;
    setVerification("Verifica in corso…");
    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: issueUrl }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Verifica non riuscita");
      const stillPresent = (data.issues || []).some(
        (current) =>
          String(current.label || "").trim().toLowerCase() ===
          String(issue.label || "").trim().toLowerCase(),
      );
      setVerification(
        stillPresent
          ? "Il problema risulta ancora presente nell'audit rapido."
          : "Il problema non risulta più nell'audit rapido. Verifica completata.",
      );
    } catch (error) {
      setVerification(`Verifica non riuscita: ${error.message}`);
    }
  };

  if (!issues.length) return null;

  return (
    <section className="panel remediation-panel">
      <div className="panel-head">
        <div>
          <h2>Correzioni SEO</h2>
          <p>Prepara la correzione, passala a GPTSites e ricontrolla il risultato.</p>
        </div>
        <span className="remediation-badge"><Wrench />{issues.length} problemi</span>
      </div>

      <label className="remediation-select">
        Problema da correggere
        <select value={selectedIndex} onChange={(event) => setSelectedIndex(Number(event.target.value))}>
          {issues.map((item, index) => (
            <option key={`${item.label}-${index}`} value={index}>
              {index + 1}. {item.label || "Problema SEO"}
            </option>
          ))}
        </select>
      </label>

      <div className="remediation-issue">
        <div>
          <strong>{issue?.label}</strong>
          <small>{issue?.detail || "Nessun dettaglio aggiuntivo."}</small>
        </div>
        <a href={issueUrl} target="_blank" rel="noreferrer"><ExternalLink />Apri pagina</a>
      </div>

      <div className="remediation-actions">
        <button className="primary" onClick={prepare} disabled={loading}>
          <Sparkles />{loading ? "Preparazione…" : "Correggi con AI"}
        </button>
        <button className="secondary" onClick={copyPrompt} disabled={!issue}>
          <Copy />Copia per GPTSites
        </button>
        <button
          className="secondary"
          disabled
          title="Non disponibile: ChatGPT Sites non espone attualmente un'API esterna documentata per la scrittura diretta da SeoGrow."
        >
          Applica automaticamente
        </button>
        <button className="secondary" onClick={verify} disabled={!issue}>
          <Check />Verifica correzione
        </button>
      </div>

      <div className="remediation-note">
        <strong>GPTSites collegato</strong>
        <span>
          Il flusso automatico completo sarà attivabile appena sarà disponibile un adapter di scrittura. Oggi SeoGrow prepara la correzione e la verifica; l'applicazione avviene dentro ChatGPT Sites con preview prima della pubblicazione.
        </span>
      </div>

      {prompt && (
        <label className="remediation-prompt">
          Prompt pronto per GPTSites
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
        </label>
      )}
      {message && <p className="integration-result">{message}</p>}
      {verification && (
        <p className={verification.includes("non risulta più") ? "success remediation-status" : "integration-result"}>
          {verification.includes("non risulta più") && <Check />}{verification}
        </p>
      )}
    </section>
  );
}

export default function AuditRemediationPanel() {
  const [target, setTarget] = useState(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const sync = () => {
      let page = "";
      try { page = decodeURIComponent(window.location.hash.slice(1)); } catch { page = ""; }
      const root = document.querySelector(".audit-enhancer-root");
      setTarget(page === "Audit SEO" ? root : null);
      setVersion((value) => value + 1);
    };
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("storage", sync);
    const timer = window.setInterval(sync, 1200);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("storage", sync);
      window.clearInterval(timer);
    };
  }, []);

  if (!target) return null;
  const clients = readJson(CLIENTS_KEY, []);
  const selectedClientId = Number(readJson(SELECTED_CLIENT_KEY, clients[0]?.id));
  const client = clients.find((item) => item.id === selectedClientId) || clients[0];
  const latest = client ? latestAudit(selectedClientId) : null;
  if (!client || !latest?.item) return null;

  return createPortal(
    <RemediationPanelView
      key={`${selectedClientId}-${latest.item.analyzedAt || latest.item.startedAt}-${version}`}
      client={client}
      auditType={latest.type}
      audit={latest.item}
    />,
    target,
  );
}
