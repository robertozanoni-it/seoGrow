import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, ExternalLink, Sparkles } from "lucide-react";
import { apiFetch } from "./api";
import { normalizeAnalysisHistory } from "./platform";
import "./GptSitesJobBridge.css";

const fetch = apiFetch;
const CLIENTS_KEY = "seogrow-clients";
const SELECTED_CLIENT_KEY = "seogrow-selected-client-v1";
const CMS_ROUTER_KEY = "seogrow-cms-router-v1";
const PAGE_HISTORY_KEY = "seogrow-page-audit-history-v2";
const SITE_HISTORY_KEY = "seogrow-analyses-v2";

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
  return [
    ...(Array.isArray(pages) ? pages.map((item) => ({ type: "page", item })) : []),
    ...sites.map((item) => ({ type: "site", item })),
  ].toSorted(
    (a, b) =>
      Date.parse(b.item?.analyzedAt || b.item?.startedAt || 0) -
      Date.parse(a.item?.analyzedAt || a.item?.startedAt || 0),
  )[0] || null;
};

const buildJob = ({ client, issue, auditType, issueUrl }) => `JOB AGENTICO GPTSITES — VERIFICA E CORREGGI\n\nPROGETTO\n${client.name}\n${client.url}\n\nPAGINA DA VERIFICARE\n${issueUrl}\n\nPROBLEMA RILEVATO DA SEOGROW\n${issue?.label || "Problema SEO"}\n${issue?.detail || "Nessun dettaglio aggiuntivo disponibile."}\nSeverità: ${issue?.severity || "media"}\nOrigine: audit ${auditType === "page" ? "pagina" : "sito completo"}.\n\nESEGUI TUTTO IL FLUSSO\n1. Apri il Site collegato e verifica direttamente se il problema indicato è ancora presente sulla pagina specificata.\n2. Se il problema non è più presente, non modificare nulla e restituisci esito VERIFICATO / GIÀ RISOLTO.\n3. Se il problema è presente, analizza solo gli elementi necessari per correggerlo.\n4. Applica la modifica direttamente nel Site in preview, preservando URL, struttura, integrazioni, tracciamenti e contenuti non coinvolti.\n5. Non inventare dati, recensioni, credenziali o prove sociali.\n6. Non pubblicare automaticamente modifiche strutturali o ad alto rischio. Redirect, canonical, noindex, sitemap, robots, cancellazioni e pubblicazione richiedono approvazione esplicita.\n7. Dopo la modifica controlla nuovamente la pagina nel Site.\n8. Restituisci un report sintetico con: problema verificato, modifica effettuata, elementi modificati, elementi lasciati invariati, eventuale approvazione richiesta e stato finale.\n9. Lascia la pagina pronta perché SeoGrow possa eseguire il nuovo audit di conferma.\n\nOBIETTIVO\nL'utente non deve eseguire controlli o modifiche manuali: GPTSites deve verificare, correggere quando necessario e documentare l'esito.`;

export default function GptSitesJobBridge() {
  const [target, setTarget] = useState(null);
  const [version, setVersion] = useState(0);
  const [job, setJob] = useState("");
  const [message, setMessage] = useState("");
  const [verifying, setVerifying] = useState(false);
  const panelRef = useRef(null);

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
    window.addEventListener("seogrow-locationchange", sync);
    window.addEventListener("seogrow-remediation-open", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("seogrow-locationchange", sync);
      window.removeEventListener("seogrow-remediation-open", sync);
    };
  }, []);

  const clients = readJson(CLIENTS_KEY, []);
  const selectedClientId = Number(readJson(SELECTED_CLIENT_KEY, clients[0]?.id));
  const client = clients.find((item) => item.id === selectedClientId) || clients[0];
  const platform = readJson(CMS_ROUTER_KEY, {})[selectedClientId]?.platform || "manual";
  const latest = client ? latestAudit(selectedClientId) : null;
  const issues = latest?.item?.issues || [];
  const issue = issues[0] || null;
  const issueUrl = useMemo(
    () => issue?.targetUrl || issue?.url || latest?.item?.url || client?.url || "",
    [issue, latest?.item?.url, client?.url, version],
  );

  useEffect(() => {
    if (platform !== "gptsites" || !client || !issue) return;
    setJob(buildJob({ client, issue, auditType: latest?.type, issueUrl }));
  }, [platform, client, issue, latest?.type, issueUrl, version]);

  if (!target || platform !== "gptsites" || !client || !latest?.item || !issue) return null;

  const copyJob = async () => {
    const text = job || buildJob({ client, issue, auditType: latest.type, issueUrl });
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Job GPTSites copiato. È pronto per essere eseguito nel Site collegato.");
    } catch {
      setMessage("Copia automatica non riuscita: copia manualmente il job visualizzato.");
    }
  };

  const verifySeoGrow = async () => {
    setVerifying(true);
    setMessage("SeoGrow sta verificando la pagina dopo l'intervento GPTSites…");
    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: issueUrl }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Verifica non riuscita");
      const stillPresent = (data.issues || []).some(
        (item) =>
          String(item.label || "").trim().toLowerCase() ===
          String(issue.label || "").trim().toLowerCase(),
      );
      setMessage(
        stillPresent
          ? "SeoGrow rileva ancora il problema: il job GPTSites va rieseguito o revisionato."
          : "Verifica SeoGrow completata: il problema non risulta più presente.",
      );
    } catch (error) {
      setMessage(`Verifica SeoGrow non riuscita: ${error.message}`);
    } finally {
      setVerifying(false);
    }
  };

  return createPortal(
    <section ref={panelRef} className="panel gptsites-job-panel">
      <div className="panel-head">
        <div>
          <h2>GPTSites — verifica e correggi</h2>
          <p>Un unico job: GPTSites verifica il problema, lo corregge se necessario e lascia la pagina pronta per il controllo finale SeoGrow.</p>
        </div>
        <span className="gptsites-job-badge"><Sparkles />Job agentico</span>
      </div>

      <div className="gptsites-job-target">
        <div>
          <strong>{issue.label || "Problema SEO"}</strong>
          <small>{issue.detail || "Nessun dettaglio aggiuntivo."}</small>
        </div>
        {issueUrl && <a href={issueUrl} target="_blank" rel="noreferrer"><ExternalLink />Apri pagina</a>}
      </div>

      <div className="gptsites-job-actions">
        <button type="button" className="primary" onClick={copyJob}>
          <Sparkles />Verifica e correggi con GPTSites
        </button>
        <button type="button" className="secondary" onClick={copyJob}>
          <Copy />Copia job
        </button>
        <button type="button" className="secondary" onClick={verifySeoGrow} disabled={verifying}>
          <Check />{verifying ? "Verifica…" : "Verifica risultato con SeoGrow"}
        </button>
      </div>

      <label className="gptsites-job-text">
        Job completo per GPTSites
        <textarea value={job} onChange={(event) => setJob(event.target.value)} />
      </label>

      <div className="gptsites-job-note">
        <strong>Automazione disponibile oggi</strong>
        <span>SeoGrow prepara il job completo e verifica il risultato. L'esecuzione materiale nel Site richiede ancora il canale di modifica di ChatGPT Sites; quando sarà disponibile un adapter esterno di scrittura, questo stesso job potrà essere inviato senza passaggio manuale.</span>
      </div>

      {message && <p className={message.includes("non risulta più") ? "success" : "integration-result"}>{message}</p>}
    </section>,
    target,
  );
}
