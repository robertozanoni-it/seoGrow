import { useEffect, useMemo, useState } from "react";
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

const writeJson = (key, value) => {
  const serialized = JSON.stringify(value);
  localStorage.setItem(key, serialized);
  window.dispatchEvent(new StorageEvent("storage", { key, newValue: serialized }));
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

const issueUrl = (issue, audit, client) =>
  issue?.targetUrl || issue?.url || audit?.url || client?.url || "";

const buildSingleJob = ({ client, issue, auditType, audit }) => `JOB AGENTICO GPTSITES — VERIFICA E CORREGGI\n\nPROGETTO\n${client.name}\n${client.url}\n\nPAGINA\n${issueUrl(issue, audit, client)}\n\nPROBLEMA\n${issue?.label || "Problema SEO"}\n${issue?.detail || "Nessun dettaglio aggiuntivo."}\nSeverità: ${issue?.severity || "media"}\nOrigine: audit ${auditType === "page" ? "pagina" : "sito completo"}.\n\nESECUZIONE\n1. Verifica prima se il problema è ancora presente.\n2. Se è già risolto, non modificare nulla.\n3. Se è presente, correggilo con la modifica minima necessaria.\n4. Per redirect, canonical, noindex, robots, sitemap, cambi URL o modifiche strutturali esegui prima un controllo obbligatorio di dipendenze, coerenza, regressioni e reversibilità.\n5. Se il controllo rende la correzione inequivocabile, applicala senza richiedere intervento manuale.\n6. Se il caso resta ambiguo o non verificabile, non applicare quella singola modifica e segnala l'eccezione.\n7. Preserva tutto ciò che non è coinvolto e non inventare dati.\n8. Dopo la modifica ricontrolla la pagina e restituisci un report sintetico.\n9. Lascia la pagina pronta per la verifica finale SeoGrow.`;

const buildBulkJob = ({ client, auditType, audit, issues }) => {
  const grouped = issues.map((issue, index) =>
    `${index + 1}. ${issue.label || "Problema SEO"}\n   URL: ${issueUrl(issue, audit, client)}\n   Severità: ${issue.severity || "media"}\n   Dettaglio: ${issue.detail || "Nessun dettaglio aggiuntivo."}`,
  ).join("\n\n");

  return `JOB AGENTICO GPTSITES — BULK REMEDIATION\n\nPROGETTO\n${client.name}\n${client.url}\n\nORIGINE\nAudit ${auditType === "page" ? "pagina" : "sito completo"} — ${issues.length} problemi rilevati.\n\nPROBLEMI\n${grouped}\n\nESEGUI L'INTERO BATCH\n1. Raggruppa i problemi per pagina e rimuovi duplicati equivalenti.\n2. Prima di ogni modifica verifica che il problema sia ancora realmente presente.\n3. Correggi automaticamente i problemi confermati con la modifica minima necessaria.\n4. Per redirect, canonical, noindex, robots, sitemap, cambi URL, eliminazioni e modifiche strutturali pesanti esegui CONTROLLO PRELIMINARE OBBLIGATORIO: stato attuale, dipendenze, link e pagine coinvolte, rischio regressioni, coerenza con indicizzazione e reversibilità.\n5. Se dopo il controllo la soluzione è inequivocabile e verificabile, applicala autonomamente. Non chiedere approvazione solo perché la modifica è tecnica o strutturale.\n6. Se un singolo caso resta ambiguo, conflittuale o non verificabile, non bloccare il batch: registra l'eccezione e continua con gli altri problemi.\n7. Preserva layout, contenuti, URL, integrazioni e tracciamenti non coinvolti. Non inventare dati, recensioni, credenziali o prove sociali.\n8. Dopo ogni gruppo di modifiche esegui un controllo di regressione.\n9. Al termine ricontrolla le pagine modificate.\n10. Restituisci un report con: analizzati, corretti, già risolti, eccezioni, non correggibili, pagine modificate e modifiche effettuate.\n11. Lascia il Site pronto per il nuovo audit completo SeoGrow.\n\nOBIETTIVO\nL'utente non deve controllare manualmente ogni problema: GPTSites deve verificare, decidere, correggere e documentare; l'intervento umano è richiesto solo per casi realmente non determinabili.`;
};

const resolvePortalTarget = () => {
  let page = "";
  try {
    page = decodeURIComponent(window.location.hash.slice(1));
  } catch {
    page = "";
  }
  if (page !== "Audit SEO") return null;
  return document.querySelector(".audit-enhancer-root .gptsites-bulk-slot");
};

export default function GptSitesJobBridge() {
  const [target, setTarget] = useState(null);
  const [version, setVersion] = useState(0);
  const [job, setJob] = useState("");
  const [message, setMessage] = useState("");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    const sync = () => {
      setTarget(resolvePortalTarget());
      setVersion((value) => value + 1);
    };
    sync();
    const observer = new MutationObserver(() => {
      const nextTarget = resolvePortalTarget();
      setTarget((current) => (nextTarget === current ? current : nextTarget));
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("hashchange", sync);
    window.addEventListener("storage", sync);
    window.addEventListener("seogrow-locationchange", sync);
    window.addEventListener("seogrow-remediation-open", sync);
    return () => {
      observer.disconnect();
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
  const firstIssue = issues[0] || null;
  const firstUrl = useMemo(
    () => issueUrl(firstIssue, latest?.item, client),
    [firstIssue, latest?.item, client, version],
  );

  if (!target || !client || !latest?.item || !issues.length) return null;

  const setAsGptSites = () => {
    const current = readJson(CMS_ROUTER_KEY, {});
    writeJson(CMS_ROUTER_KEY, {
      ...current,
      [selectedClientId]: {
        platform: "gptsites",
        updatedAt: new Date().toISOString(),
      },
    });
    setMessage("Progetto impostato su GPTSites. Ora puoi avviare la remediation bulk.");
    setVersion((value) => value + 1);
  };

  const copyText = async (text, success) => {
    setJob(text);
    try {
      await navigator.clipboard.writeText(text);
      setMessage(success);
    } catch {
      setMessage("Job preparato. Copialo manualmente dal riquadro sottostante.");
    }
  };

  const prepareSingle = () =>
    copyText(
      buildSingleJob({ client, issue: firstIssue, auditType: latest.type, audit: latest.item }),
      "Job singolo GPTSites preparato e copiato.",
    );

  const prepareBulk = () =>
    copyText(
      buildBulkJob({ client, auditType: latest.type, audit: latest.item, issues }),
      `Job bulk GPTSites preparato per ${issues.length} problemi.`,
    );

  const verifySeoGrow = async () => {
    setVerifying(true);
    setMessage("SeoGrow sta verificando la pagina dopo l'intervento GPTSites…");
    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: firstUrl }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Verifica non riuscita");
      const stillPresent = (data.issues || []).some(
        (item) => String(item.label || "").trim().toLowerCase() === String(firstIssue.label || "").trim().toLowerCase(),
      );
      setMessage(stillPresent
        ? "SeoGrow rileva ancora il problema selezionato."
        : "Verifica SeoGrow completata: il problema selezionato non risulta più presente.");
    } catch (error) {
      setMessage(`Verifica SeoGrow non riuscita: ${error.message}`);
    } finally {
      setVerifying(false);
    }
  };

  return createPortal(
    <section className="panel gptsites-job-panel">
      <div className="panel-head">
        <div>
          <h2>GPTSites — remediation agentica</h2>
          <p>Correggi un singolo problema oppure tutti i problemi dell’audit in un unico job controllato.</p>
        </div>
        <span className="gptsites-job-badge"><Sparkles />{issues.length} problemi</span>
      </div>

      {platform !== "gptsites" ? (
        <div className="gptsites-job-note">
          <strong>Questo progetto non è ancora impostato su GPTSites</strong>
          <span>Se il sito è gestito con GPTSites, attivalo qui: il bulk remediation diventerà disponibile immediatamente.</span>
          <button type="button" className="primary" onClick={setAsGptSites}>
            <Sparkles />Usa GPTSites per questo progetto
          </button>
        </div>
      ) : (
        <>
          <div className="gptsites-job-actions">
            <button type="button" className="primary" onClick={prepareBulk}>
              <Sparkles />Correggi tutti i problemi con GPTSites ({issues.length})
            </button>
            <button type="button" className="secondary" onClick={prepareSingle}>
              <Sparkles />Verifica e correggi questo problema
            </button>
            <button type="button" className="secondary" onClick={verifySeoGrow} disabled={verifying}>
              <Check />{verifying ? "Verifica…" : "Verifica risultato con SeoGrow"}
            </button>
          </div>

          <div className="gptsites-job-target">
            <div>
              <strong>{firstIssue.label || "Problema SEO"}</strong>
              <small>{firstIssue.detail || "Nessun dettaglio aggiuntivo."}</small>
            </div>
            {firstUrl && <a href={firstUrl} target="_blank" rel="noreferrer"><ExternalLink />Apri pagina</a>}
          </div>
        </>
      )}

      {job && (
        <label className="gptsites-job-text">
          Job pronto per GPTSites
          <textarea value={job} onChange={(event) => setJob(event.target.value)} />
          <button type="button" className="secondary" onClick={() => copyText(job, "Job copiato.")}>
            <Copy />Copia job
          </button>
        </label>
      )}

      {message && <p className={message.includes("non risulta più") ? "success" : "integration-result"}>{message}</p>}
    </section>,
    target,
  );
}
