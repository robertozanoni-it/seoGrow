import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, ExternalLink, Plug, Sparkles } from "lucide-react";
import { apiFetch } from "./api";
import { normalizeAnalysisHistory } from "./platform";
import "./WordPressJobBridge.css";

const fetch = apiFetch;
const CLIENTS_KEY = "seogrow-clients";
const SELECTED_CLIENT_KEY = "seogrow-selected-client-v1";
const CMS_ROUTER_KEY = "seogrow-cms-router-v1";
const WORDPRESS_PROFILES_KEY = "seogrow-wordpress-profiles-v1";
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

const issueUrl = (issue, audit, client) =>
  issue?.targetUrl || issue?.url || audit?.url || client?.url || "";

const buildBulkJob = ({ client, auditType, audit, issues }) => {
  const rows = issues.map((issue, index) =>
    `${index + 1}. ${issue.label || "Problema SEO"}\n   URL: ${issueUrl(issue, audit, client)}\n   Severità: ${issue.severity || "media"}\n   Dettaglio: ${issue.detail || "Nessun dettaglio aggiuntivo."}`,
  ).join("\n\n");

  return `JOB AGENTICO WORDPRESS + ELEMENTOR — BULK REMEDIATION\n\nPROGETTO\n${client.name}\n${client.url}\n\nORIGINE\nAudit ${auditType === "page" ? "pagina" : "sito completo"} — ${issues.length} problemi rilevati.\n\nPROBLEMI\n${rows}\n\nESECUZIONE\n1. Raggruppa i problemi per pagina ed elimina i duplicati equivalenti.\n2. Verifica ogni problema prima di modificare WordPress.\n3. Correggi automaticamente ciò che è determinabile e reversibile con la modifica minima necessaria.\n4. Per title, contenuti, H1, ALT e link usa WordPress REST o i campi disponibili senza ricostruire la pagina.\n5. Se la pagina usa Elementor, modifica solo i widget coinvolti; non sovrascrivere l'intero _elementor_data senza una verifica strutturale completa.\n6. Per redirect, canonical, noindex, robots, sitemap, URL ed eliminazioni esegui prima un controllo obbligatorio di dipendenze, indicizzazione, link, regressioni e reversibilità. Se la soluzione è inequivocabile, applicala; se resta ambigua, registra l'eccezione e continua.\n7. Non modificare layout, tracking, integrazioni o contenuti non coinvolti.\n8. Dopo ogni gruppo di modifiche esegui un controllo di regressione.\n9. Al termine restituisci: analizzati, corretti, già risolti, eccezioni, non correggibili, pagine modificate e modifiche effettuate.\n10. Lascia il sito pronto per un nuovo audit SeoGrow.\n\nNOTA TECNICA\nLa connessione WordPress standard di SeoGrow supporta oggi test credenziali e creazione bozze. Le modifiche dirette a pagine esistenti, metadati SEO plugin-specifici ed Elementor richiedono un adapter di remediation dedicato: non fingere di aver applicato una modifica se il canale di scrittura necessario non è disponibile.`;
};

const buildSingleJob = ({ client, auditType, audit, issue }) =>
  buildBulkJob({ client, auditType, audit, issues: [issue] }).replace(
    "BULK REMEDIATION",
    "VERIFICA E CORREGGI",
  );

const resolvePortalTarget = () => {
  let page = "";
  try {
    page = decodeURIComponent(window.location.hash.slice(1));
  } catch {
    page = "";
  }
  if (page !== "Audit SEO") return null;
  const root = document.querySelector(".audit-enhancer-root");
  if (!root) return null;
  return root.querySelector(".gptsites-bulk-slot") || null;
};

export default function WordPressJobBridge() {
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
    const timer = window.setInterval(sync, 300);
    window.addEventListener("hashchange", sync);
    window.addEventListener("storage", sync);
    window.addEventListener("seogrow-locationchange", sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("seogrow-locationchange", sync);
    };
  }, []);

  const clients = readJson(CLIENTS_KEY, []);
  const selectedClientId = Number(readJson(SELECTED_CLIENT_KEY, clients[0]?.id));
  const client = clients.find((item) => item.id === selectedClientId) || clients[0];
  const platform = readJson(CMS_ROUTER_KEY, {})[selectedClientId]?.platform || "manual";
  const profile = readJson(WORDPRESS_PROFILES_KEY, {})[selectedClientId] || null;
  const latest = client ? latestAudit(selectedClientId) : null;
  const issues = Array.isArray(latest?.item?.issues) ? latest.item.issues : [];
  const firstIssue = issues[0] || null;
  const firstUrl = useMemo(
    () => issueUrl(firstIssue, latest?.item, client),
    [firstIssue, latest?.item, client, version],
  );

  if (!target || platform !== "wordpress" || !client || !latest?.item || !issues.length)
    return null;

  const copyText = async (text, success) => {
    setJob(text);
    try {
      await navigator.clipboard.writeText(text);
      setMessage(success);
    } catch {
      setMessage("Job preparato. Copialo manualmente dal riquadro sottostante.");
    }
  };

  const prepareBulk = () =>
    copyText(
      buildBulkJob({ client, auditType: latest.type, audit: latest.item, issues }),
      `Job WordPress preparato per ${issues.length} problemi.`,
    );

  const prepareSingle = () =>
    copyText(
      buildSingleJob({ client, auditType: latest.type, audit: latest.item, issue: firstIssue }),
      "Job WordPress per il problema selezionato preparato.",
    );

  const openIntegrations = () => {
    localStorage.setItem("seogrow-selected-page-v1", JSON.stringify("Integrazioni"));
    window.location.hash = encodeURIComponent("Integrazioni");
  };

  const verifySeoGrow = async () => {
    setVerifying(true);
    setMessage("SeoGrow sta verificando la pagina…");
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
    <section className="panel wordpress-job-panel">
      <div className="panel-head">
        <div>
          <h2>WordPress + Elementor — remediation agentica</h2>
          <p>Verifica e prepara la correzione di un singolo problema o dell’intero audit.</p>
        </div>
        <span className="wordpress-job-badge"><Plug />{issues.length} problemi</span>
      </div>

      {!profile ? (
        <div className="wordpress-job-note">
          <strong>WordPress non è ancora configurato per questo progetto</strong>
          <span>Collega URL, utente e password applicativa in Integrazioni prima della remediation.</span>
          <button type="button" className="primary" onClick={openIntegrations}>
            <Plug />Apri Integrazioni WordPress
          </button>
        </div>
      ) : (
        <>
          <div className="wordpress-job-actions">
            <button type="button" className="primary" onClick={prepareBulk}>
              <Sparkles />Correggi tutti i problemi su WordPress ({issues.length})
            </button>
            <button type="button" className="secondary" onClick={prepareSingle}>
              <Sparkles />Verifica e correggi questo problema
            </button>
            <button type="button" className="secondary" onClick={verifySeoGrow} disabled={verifying}>
              <Check />{verifying ? "Verifica…" : "Verifica risultato con SeoGrow"}
            </button>
          </div>
          <div className="wordpress-job-target">
            <div>
              <strong>{firstIssue.label || "Problema SEO"}</strong>
              <small>{firstIssue.detail || "Nessun dettaglio aggiuntivo."}</small>
            </div>
            {firstUrl && <a href={firstUrl} target="_blank" rel="noreferrer"><ExternalLink />Apri pagina</a>}
          </div>
        </>
      )}

      {job && (
        <label className="wordpress-job-text">
          Job WordPress pronto
          <textarea value={job} onChange={(event) => setJob(event.target.value)} />
          <button type="button" className="secondary" onClick={() => copyText(job, "Job copiato.")}>
            <Copy />Copia job
          </button>
        </label>
      )}

      <div className="wordpress-job-note">
        <strong>Stato automazione</strong>
        <span>
          SeoGrow ha già il canale WordPress per autenticazione e bozze. Per applicare automaticamente in produzione fix su pagine esistenti, Elementor e metadati SEO plugin-specifici serve ancora un adapter di remediation dedicato; il pannello non dichiara una modifica come eseguita finché quel canale non esiste.
        </span>
      </div>

      {message && <p className={message.includes("non risulta più") ? "success" : "integration-result"}>{message}</p>}
    </section>,
    target,
  );
}
