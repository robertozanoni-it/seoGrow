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

const governance = `GOVERNANCE AUTONOMA\n- Livello 1 — automatico: title, meta description, H1, ALT, internal linking, microcopy e correzioni on-page chiaramente determinabili. Verifica e applica direttamente in preview.\n- Livello 2 — automatico con controllo preliminare obbligatorio: redirect, canonical, noindex, robots, sitemap, cambi URL, cancellazioni e modifiche strutturali. Prima di intervenire verifica stato attuale, intento della pagina, dipendenze, link interni, redirect/canonical collegati, sitemap/robots, rischio di regressione e reversibilità. Se la soluzione è inequivocabile e sicura, applicala in preview senza chiedere approvazione.\n- Livello 3 — eccezione: fermati solo se il caso resta ambiguo, conflittuale, non verificabile o non reversibile con sufficiente sicurezza. In quel caso non modificare e descrivi esattamente cosa impedisce una decisione autonoma.\n- Non chiedere approvazione quando puoi verificare autonomamente la correttezza della modifica.\n- Non inventare dati, recensioni, credenziali, fonti o prove sociali.\n- Preserva integrazioni, tracciamenti, URL e contenuti non coinvolti, salvo quando uno di questi elementi è precisamente l'oggetto della correzione.`;

const buildJob = ({ client, issue, auditType, issueUrl }) => `JOB AGENTICO GPTSITES — VERIFICA E CORREGGI\n\nPROGETTO\n${client.name}\n${client.url}\n\nPAGINA DA VERIFICARE\n${issueUrl}\n\nPROBLEMA RILEVATO DA SEOGROW\n${issue?.label || "Problema SEO"}\n${issue?.detail || "Nessun dettaglio aggiuntivo disponibile."}\nSeverità: ${issue?.severity || "media"}\nOrigine: audit ${auditType === "page" ? "pagina" : "sito completo"}.\n\nESEGUI TUTTO IL FLUSSO\n1. Apri il Site collegato e verifica direttamente se il problema indicato è ancora presente sulla pagina specificata.\n2. Se il problema non è più presente, non modificare nulla e restituisci esito VERIFICATO / GIÀ RISOLTO.\n3. Se il problema è presente, classificalo secondo la governance seguente.\n\n${governance}\n\n4. Applica la correzione minima necessaria in preview.\n5. Dopo la modifica ricontrolla la pagina e le dipendenze coinvolte.\n6. Restituisci un report sintetico con: problema verificato, controllo preliminare eseguito, modifica effettuata, elementi modificati, elementi lasciati invariati, eventuale eccezione non risolta e stato finale.\n7. Lascia la pagina pronta perché SeoGrow possa eseguire il nuovo audit di conferma.\n\nOBIETTIVO\nL'utente non deve eseguire controlli o modifiche manuali: GPTSites deve verificare, decidere, correggere quando la soluzione è sufficientemente certa e documentare l'esito.`;

const issueLine = (issue, index, fallbackUrl) => {
  const url = issue?.targetUrl || issue?.url || fallbackUrl || "";
  return `${index + 1}. [${issue?.severity || "media"}] ${issue?.label || "Problema SEO"}\n   URL: ${url}\n   Dettaglio: ${issue?.detail || "Nessun dettaglio aggiuntivo."}`;
};

const buildBulkJob = ({ client, issues, auditType, auditUrl }) => `JOB AGENTICO GPTSITES — BULK REMEDIATION COMPLETA\n\nPROGETTO\n${client.name}\n${client.url}\n\nORIGINE\nAudit ${auditType === "page" ? "pagina" : "sito completo"}\nURL audit: ${auditUrl || client.url}\nProblemi rilevati: ${issues.length}\n\nPROBLEMI DA GESTIRE\n${issues.map((item, index) => issueLine(item, index, auditUrl || client.url)).join("\n\n")}\n\nOBIETTIVO\nGestisci autonomamente tutti i problemi rilevati. Raggruppali per pagina, elimina duplicati, verifica ogni problema prima di modificarlo e applica soltanto correzioni ancora necessarie.\n\n${governance}\n\nWORKFLOW BULK OBBLIGATORIO\n1. Raggruppa i problemi per URL e per dipendenza tecnica.\n2. Verifica che ogni problema sia ancora presente; marca come GIÀ RISOLTO ciò che non richiede più intervento.\n3. Individua conflitti tra correzioni prima di applicarle.\n4. Per gli interventi di Livello 2 esegui sempre controllo preliminare completo e verifica di reversibilità.\n5. Applica in preview tutte le correzioni Livello 1 e tutte le Livello 2 che risultano inequivocabili e sicure.\n6. Non fermare l'intero batch per una singola eccezione: continua con gli altri problemi e isola solo i casi ambigui.\n7. Dopo ogni gruppo di modifiche ricontrolla pagina, link, canonical/redirect, indicizzabilità e dipendenze pertinenti.\n8. Esegui un controllo finale complessivo del Site per intercettare regressioni introdotte dal batch.\n9. Restituisci un report finale con conteggi: ANALIZZATI, CORRETTI, GIÀ RISOLTI, ECCEZIONI, NON CORREGGIBILI; poi dettaglio pagina per pagina con prima/dopo e motivazione delle eccezioni.\n10. Lascia il Site pronto per il successivo audit completo di SeoGrow.\n\nREGOLA CENTRALE\nNon chiedere approvazione se la correttezza può essere determinata autonomamente con controllo preliminare sufficiente. Fermati solo sul singolo intervento che resta realmente ambiguo o non verificabile.`;

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
  const issues = Array.isArray(latest?.item?.issues) ? latest.item.issues : [];
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

  const copyText = async (text, successMessage) => {
    try {
      await navigator.clipboard.writeText(text);
      setJob(text);
      setMessage(successMessage);
    } catch {
      setJob(text);
      setMessage("Copia automatica non riuscita: copia manualmente il job visualizzato.");
    }
  };

  const copyJob = async () => {
    const text = buildJob({ client, issue, auditType: latest.type, issueUrl });
    await copyText(text, "Job GPTSites copiato. È pronto per essere eseguito nel Site collegato.");
  };

  const copyBulkJob = async () => {
    const text = buildBulkJob({
      client,
      issues,
      auditType: latest.type,
      auditUrl: latest.item.url || client.url,
    });
    await copyText(text, `Job bulk GPTSites copiato: ${issues.length} problemi inclusi, con controllo preliminare autonomo.`);
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
          <p>GPTSites verifica, decide e corregge autonomamente. Gli interventi tecnici sensibili vengono eseguiti dopo controllo preliminare, non bloccati a priori.</p>
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
          <Sparkles />Verifica e correggi questo problema
        </button>
        <button type="button" className="primary" onClick={copyBulkJob}>
          <Sparkles />Correggi tutti i problemi con GPTSites ({issues.length})
        </button>
        <button type="button" className="secondary" onClick={() => copyText(job, "Job copiato.")}>
          <Copy />Copia job visualizzato
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
        <strong>Governance autonoma</strong>
        <span>Redirect, canonical, noindex, robots, sitemap, cambi URL e interventi strutturali non vengono più bloccati automaticamente: GPTSites deve prima verificarne correttezza, dipendenze, regressioni e reversibilità. Solo i casi realmente ambigui restano come eccezioni.</span>
      </div>

      <div className="gptsites-job-note">
        <strong>Automazione disponibile oggi</strong>
        <span>SeoGrow prepara il job completo e verifica il risultato. L'esecuzione materiale nel Site richiede ancora il canale di modifica di ChatGPT Sites; quando sarà disponibile un adapter esterno di scrittura, lo stesso job potrà essere inviato senza passaggio manuale.</span>
      </div>

      {message && <p className={message.includes("non risulta più") ? "success" : "integration-result"}>{message}</p>}
    </section>,
    target,
  );
}
