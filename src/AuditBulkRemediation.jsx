import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Plug, Sparkles, Wrench } from "lucide-react";
import { apiFetch } from "./api";
import { normalizeAnalysisHistory } from "./platform";
import "./AuditBulkRemediation.css";

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

const writeJson = (key, value) => {
  const serialized = JSON.stringify(value);
  localStorage.setItem(key, serialized);
  window.dispatchEvent(new StorageEvent("storage", { key, newValue: serialized }));
};

const auditCandidates = (clientId) => {
  const pages = readJson(PAGE_HISTORY_KEY, {})[clientId] || [];
  const sites = normalizeAnalysisHistory(readJson(SITE_HISTORY_KEY, {})[clientId]);
  return [
    ...(Array.isArray(pages) ? pages.map((item) => ({ type: "page", item })) : []),
    ...sites.map((item) => ({ type: "site", item })),
  ].toSorted(
    (a, b) =>
      Date.parse(b.item?.analyzedAt || b.item?.startedAt || 0) -
      Date.parse(a.item?.analyzedAt || a.item?.startedAt || 0),
  );
};

const issueUrl = (issue, audit, client) =>
  issue?.targetUrl || issue?.url || audit?.url || client?.url || "";

const buildBulkJob = ({ platform, client, auditType, audit, issues }) => {
  const destination = platform === "wordpress" ? "WORDPRESS + ELEMENTOR" : platform === "gptsites" ? "GPTSITES" : "MANUALE";
  const rows = issues.map((issue, index) =>
    `${index + 1}. ${issue.label || "Problema SEO"}\n   URL: ${issueUrl(issue, audit, client)}\n   Severità: ${issue.severity || "media"}\n   Dettaglio: ${issue.detail || "Nessun dettaglio aggiuntivo."}`,
  ).join("\n\n");

  const platformRules = platform === "wordpress"
    ? `- Usa WordPress REST e gli adapter disponibili per modifiche determinabili.\n- Se la pagina usa Elementor, modifica solo i widget coinvolti e non riscrivere l'intero _elementor_data senza verifica strutturale.\n- Per metadati Rank Math/Yoast usa solo un adapter compatibile realmente disponibile.`
    : platform === "gptsites"
      ? `- Lavora nel Site collegato in preview.\n- Verifica ogni problema prima di applicare la modifica.`
      : `- Prepara modifiche CMS-agnostiche senza dichiararle applicate.`;

  return `JOB AGENTICO ${destination} — BULK REMEDIATION\n\nPROGETTO\n${client.name}\n${client.url}\n\nORIGINE\nAudit ${auditType === "page" ? "pagina" : "sito completo"} — ${issues.length} problemi.\n\nPROBLEMI\n${rows}\n\nREGOLE\n1. Raggruppa per pagina ed elimina duplicati.\n2. Verifica ogni problema prima di modificarlo.\n3. Correggi automaticamente ciò che è determinabile e reversibile.\n4. Per redirect, canonical, noindex, robots, sitemap, cambi URL, eliminazioni e modifiche strutturali esegui prima un controllo obbligatorio di dipendenze, indicizzazione, regressioni e reversibilità.\n5. Se la soluzione è inequivocabile, applicala; se resta ambigua, registra l'eccezione e continua.\n6. Preserva layout, tracking, integrazioni e contenuti non coinvolti.\n7. Dopo ogni gruppo esegui un controllo di regressione.\n8. Restituisci: analizzati, corretti, già risolti, eccezioni, non correggibili e pagine modificate.\n\nREGOLE PIATTAFORMA\n${platformRules}\n\nOBIETTIVO\nL'utente non deve controllare manualmente ogni problema.`;
};

const resolveTarget = () => {
  let page = "";
  try { page = decodeURIComponent(window.location.hash.slice(1)); } catch { page = ""; }
  if (page !== "Audit SEO") return null;
  return document.querySelector(".audit-enhancer-root .gptsites-bulk-slot");
};

export default function AuditBulkRemediation() {
  const [target, setTarget] = useState(null);
  const [version, setVersion] = useState(0);
  const [job, setJob] = useState("");
  const [message, setMessage] = useState("");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    const sync = () => {
      setTarget(resolveTarget());
      setVersion((value) => value + 1);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("hashchange", sync);
    window.addEventListener("storage", sync);
    window.addEventListener("seogrow-locationchange", sync);
    return () => {
      observer.disconnect();
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("seogrow-locationchange", sync);
    };
  }, []);

  const clients = readJson(CLIENTS_KEY, []);
  const selectedClientId = Number(readJson(SELECTED_CLIENT_KEY, clients[0]?.id));
  const client = clients.find((item) => item.id === selectedClientId) || clients[0];
  const profiles = readJson(WORDPRESS_PROFILES_KEY, {});
  const wpProfile = profiles[selectedClientId] || null;
  const router = readJson(CMS_ROUTER_KEY, {});
  const savedPlatform = router[selectedClientId]?.platform;
  const inferredPlatform = savedPlatform || (wpProfile ? "wordpress" : "manual");
  const [platform, setPlatform] = useState(inferredPlatform);

  useEffect(() => {
    setPlatform(savedPlatform || (wpProfile ? "wordpress" : "manual"));
  }, [selectedClientId, savedPlatform, Boolean(wpProfile), version]);

  const latest = client ? auditCandidates(selectedClientId)[0] : null;
  const issues = Array.isArray(latest?.item?.issues) ? latest.item.issues : [];
  const firstIssue = issues[0] || null;
  const firstUrl = useMemo(
    () => issueUrl(firstIssue, latest?.item, client),
    [firstIssue, latest?.item, client, version],
  );

  if (!target || !client || !latest?.item || !issues.length) return null;

  const savePlatform = (next) => {
    setPlatform(next);
    writeJson(CMS_ROUTER_KEY, {
      ...readJson(CMS_ROUTER_KEY, {}),
      [selectedClientId]: { platform: next, updatedAt: new Date().toISOString() },
    });
    setJob("");
    setMessage("");
  };

  const prepareBulk = async () => {
    if (platform === "wordpress" && !wpProfile) {
      setMessage("WordPress non è ancora configurato: apri Integrazioni e verifica la connessione.");
      return;
    }
    const text = buildBulkJob({ platform, client, auditType: latest.type, audit: latest.item, issues });
    setJob(text);
    try {
      await navigator.clipboard.writeText(text);
      setMessage(
        platform === "wordpress"
          ? `Job WordPress preparato per ${issues.length} problemi.`
          : platform === "gptsites"
            ? `Job GPTSites preparato per ${issues.length} problemi.`
            : `Correzione manuale preparata per ${issues.length} problemi.`,
      );
    } catch {
      setMessage("Job preparato. Copialo dal riquadro sottostante.");
    }
  };

  const openIntegrations = () => {
    localStorage.setItem("seogrow-selected-page-v1", JSON.stringify("Integrazioni"));
    window.location.hash = encodeURIComponent("Integrazioni");
  };

  const verify = async () => {
    if (!firstUrl) return;
    setVerifying(true);
    setMessage("Verifica SeoGrow in corso…");
    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: firstUrl }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Verifica non riuscita");
      const stillPresent = (data.issues || []).some(
        (item) => String(item.label || "").trim().toLowerCase() === String(firstIssue?.label || "").trim().toLowerCase(),
      );
      setMessage(stillPresent ? "SeoGrow rileva ancora il primo problema." : "Verifica SeoGrow completata: il primo problema non risulta più presente.");
    } catch (error) {
      setMessage(`Verifica non riuscita: ${error.message}`);
    } finally {
      setVerifying(false);
    }
  };

  const primaryLabel = platform === "wordpress"
    ? `Correggi tutti su WordPress (${issues.length})`
    : platform === "gptsites"
      ? `Correggi tutti con GPTSites (${issues.length})`
      : `Prepara tutte le correzioni (${issues.length})`;

  return createPortal(
    <section className="panel audit-bulk-remediation">
      <div className="panel-head">
        <div>
          <h2>Correzione automatica</h2>
          <p>Scegli la piattaforma del progetto e gestisci tutti i problemi prima di entrare nel dettaglio.</p>
        </div>
        <span className="audit-bulk-badge"><Wrench />{issues.length} problemi</span>
      </div>

      <div className="audit-platform-switch" role="group" aria-label="Piattaforma di remediation">
        <button type="button" className={platform === "gptsites" ? "active" : ""} onClick={() => savePlatform("gptsites")}>GPTSites</button>
        <button type="button" className={platform === "wordpress" ? "active" : ""} onClick={() => savePlatform("wordpress")}>WordPress + Elementor</button>
        <button type="button" className={platform === "manual" ? "active" : ""} onClick={() => savePlatform("manual")}>Manuale</button>
      </div>

      <div className="audit-bulk-actions">
        <button type="button" className="primary" onClick={prepareBulk}><Sparkles />{primaryLabel}</button>
        <button type="button" className="secondary" onClick={verify} disabled={verifying}><Check />{verifying ? "Verifica…" : "Verifica risultato con SeoGrow"}</button>
        {platform === "wordpress" && !wpProfile && (
          <button type="button" className="secondary" onClick={openIntegrations}><Plug />Configura WordPress</button>
        )}
      </div>

      {platform === "wordpress" && (
        <div className={wpProfile ? "audit-platform-status ok" : "audit-platform-status warning"}>
          <Plug />
          <span>{wpProfile ? `Profilo WordPress rilevato${wpProfile.name ? `: ${wpProfile.name}` : ""}.` : "Profilo WordPress non ancora configurato per questo progetto."}</span>
        </div>
      )}

      {job && (
        <label className="audit-bulk-job">
          Job pronto
          <textarea value={job} onChange={(event) => setJob(event.target.value)} />
          <button type="button" className="secondary" onClick={() => navigator.clipboard.writeText(job).then(() => setMessage("Job copiato.")).catch(() => setMessage("Copia non riuscita."))}><Copy />Copia job</button>
        </label>
      )}

      {message && <p className={message.includes("non risulta più") ? "success" : "integration-result"}>{message}</p>}
    </section>,
    target,
  );
}
