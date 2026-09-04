import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, ExternalLink, Plug, Sparkles, Wrench } from "lucide-react";
import { apiFetch } from "./api";
import { normalizeAnalysisHistory } from "./platform";
import "./AuditRemediationPanel.css";

const fetch = apiFetch;
const PAGE_HISTORY_KEY = "seogrow-page-audit-history-v2";
const SITE_HISTORY_KEY = "seogrow-analyses-v2";
const CLIENTS_KEY = "seogrow-clients";
const SELECTED_CLIENT_KEY = "seogrow-selected-client-v1";
const WORDPRESS_PROFILES_KEY = "seogrow-wordpress-profiles-v1";
const CMS_ROUTER_KEY = "seogrow-cms-router-v1";

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

const platformMeta = {
  gptsites: {
    label: "GPTSites",
    action: "Correggi con GPTSites",
    promptType: "istruzioni operative per GPTSites",
    note: "SeoGrow prepara l'intervento e la verifica. L'applicazione avviene nel Site con preview prima della pubblicazione.",
  },
  wordpress: {
    label: "WordPress + Elementor",
    action: "Correggi su WordPress",
    promptType: "istruzioni operative per WordPress ed Elementor",
    note: "SeoGrow usa il profilo WordPress del progetto. Le modifiche Elementor strutturali richiedono preview/approvazione; metadati, testi, ALT e link possono essere preparati come patch mirate.",
  },
  manual: {
    label: "Manuale / altro CMS",
    action: "Prepara correzione",
    promptType: "istruzioni operative SEO",
    note: "Nessun canale di scrittura è configurato: SeoGrow prepara una correzione verificabile da applicare nel CMS disponibile.",
  },
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

const latestAudit = (clientId) => auditCandidates(clientId)[0] || null;

const requestedAudit = (clientId, request) => {
  if (!request || Number(request.clientId) !== Number(clientId)) return null;
  const candidates = auditCandidates(clientId);
  const wantedTime = String(request.analyzedAt || "");
  const wantedType = request.auditType;
  return (
    candidates.find(
      ({ type, item }) =>
        (!wantedType || type === wantedType) &&
        (!wantedTime || String(item?.analyzedAt || item?.startedAt || "") === wantedTime),
    ) || candidates.find(({ type }) => !wantedType || type === wantedType) || null
  );
};

const inferPlatform = (clientId) => {
  const saved = readJson(CMS_ROUTER_KEY, {});
  if (saved[clientId]?.platform && platformMeta[saved[clientId].platform])
    return saved[clientId].platform;
  const wpProfiles = readJson(WORDPRESS_PROFILES_KEY, {});
  if (wpProfiles[clientId]) return "wordpress";
  return "manual";
};

const isHighRiskIssue = (issue) => {
  const text = `${issue?.type || ""} ${issue?.label || ""} ${issue?.detail || ""}`.toLowerCase();
  return ["redirect", "canonical", "noindex", "sitemap", "robots", "elimina", "delete", "publish", "pubblica"].some((term) => text.includes(term));
};

const buildFallbackPrompt = ({ client, issue, auditType, platform }) => {
  const issueUrl = issue.targetUrl || issue.url || client.url;
  const meta = platformMeta[platform] || platformMeta.manual;
  const destinationRules =
    platform === "wordpress"
      ? "- Il sito usa WordPress + Elementor. Per H1, testi o sezioni Elementor modifica solo i widget necessari, senza ricostruire la pagina. Per title/meta usa il canale SEO disponibile. Per ALT/link usa le risorse WordPress pertinenti.\n- Non sovrascrivere _elementor_data in blocco se non è strettamente necessario."
      : platform === "gptsites"
        ? "- Lavora nel Site collegato in preview. Mantieni tutte le sezioni, integrazioni e URL esistenti non coinvolti."
        : "- Prepara una modifica CMS-agnostica, indicando esattamente campo, valore corrente se noto e valore proposto.";
  return `MODIFICA SEO MIRATA — ${meta.label} — ${client.name}\n\nPagina: ${issueUrl}\nProblema SEO rilevato: ${issue.label || "Problema SEO"}\nDettaglio: ${issue.detail || "Nessun dettaglio aggiuntivo disponibile."}\nSeverità: ${issue.severity || "media"}\nOrigine: audit ${auditType === "page" ? "pagina" : "sito completo"}.\n\nOBIETTIVO\nCorreggi esclusivamente il problema indicato sulla pagina specificata.\n\nREGOLE DESTINAZIONE\n${destinationRules}\n\nVINCOLI\n- Non modificare ciò che non è coinvolto.\n- Non inventare dati, recensioni, credenziali o prove sociali.\n- Non pubblicare automaticamente modifiche strutturali o ad alto rischio.\n- Redirect, canonical, noindex, sitemap, robots e cancellazioni richiedono approvazione esplicita.\n- Mostra sempre cosa intendi cambiare prima dell'applicazione quando la modifica può avere impatto strutturale.\n\nVERIFICA\nDopo la modifica, indica esattamente cosa è cambiato e lascia la pagina pronta per un nuovo audit SeoGrow.`;
};

function RemediationPanelView({ client, clientId, auditType, audit, initialIssueIndex = 0, requestNonce = 0 }) {
  const issues = Array.isArray(audit?.issues) ? audit.issues : [];
  const safeInitialIndex = Math.min(Math.max(Number(initialIssueIndex) || 0, 0), Math.max(issues.length - 1, 0));
  const [selectedIndex, setSelectedIndex] = useState(safeInitialIndex);
  const [platform, setPlatform] = useState(() => inferPlatform(clientId));
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [verification, setVerification] = useState("");
  const panelRef = useRef(null);
  const issue = issues[selectedIndex] || null;
  const meta = platformMeta[platform] || platformMeta.manual;
  const wpProfile = readJson(WORDPRESS_PROFILES_KEY, {})[clientId] || null;
  const highRisk = isHighRiskIssue(issue);

  useEffect(() => {
    const nextIndex = Math.min(Math.max(Number(initialIssueIndex) || 0, 0), Math.max(issues.length - 1, 0));
    setSelectedIndex(nextIndex);
    window.setTimeout(() => {
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      panelRef.current?.classList.add("remediation-focus");
      window.setTimeout(() => panelRef.current?.classList.remove("remediation-focus"), 1600);
    }, 40);
  }, [initialIssueIndex, requestNonce, issues.length]);

  useEffect(() => {
    setPrompt("");
    setMessage("");
    setVerification("");
  }, [selectedIndex, audit?.analyzedAt, platform]);

  const issueUrl = useMemo(
    () => issue?.targetUrl || issue?.url || audit?.url || client.url,
    [issue, audit?.url, client.url],
  );

  const savePlatform = (nextPlatform) => {
    setPlatform(nextPlatform);
    const current = readJson(CMS_ROUTER_KEY, {});
    writeJson(CMS_ROUTER_KEY, {
      ...current,
      [clientId]: {
        platform: nextPlatform,
        updatedAt: new Date().toISOString(),
      },
    });
  };

  const prepare = async () => {
    if (!issue) return;
    setLoading(true);
    setMessage("");
    const fallback = buildFallbackPrompt({ client, issue, auditType, platform });
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topic: `Correzione SEO: ${issue.label || "problema audit"}`,
          type: meta.promptType,
          context: JSON.stringify({
            progetto: client.name,
            sito: client.url,
            piattaforma: meta.label,
            pagina: issueUrl,
            audit: auditType,
            problema: issue.label,
            dettaglio: issue.detail,
            severita: issue.severity,
            wordpressProfile: platform === "wordpress" && wpProfile
              ? { url: wpProfile.url, username: wpProfile.username, name: wpProfile.name }
              : null,
            rischioAlto: highRisk,
            istruzione:
              "Genera una patch operativa mirata alla piattaforma indicata. Correggi solo il problema. Preserva tutto il resto. Non pubblicare modifiche strutturali. Per WordPress + Elementor evita riscritture massive. Per modifiche ad alto rischio richiedi approvazione esplicita. Prevedi verifica finale con nuovo audit.",
          }),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Generazione non riuscita");
      setPrompt(String(data.content || "").trim() || fallback);
      setMessage(data.demo ? "Correzione preparata in modalità locale." : `Correzione preparata per ${meta.label}.`);
    } catch {
      setPrompt(fallback);
      setMessage(`Correzione operativa preparata localmente per ${meta.label}.`);
    } finally {
      setLoading(false);
    }
  };

  const copyPrompt = async () => {
    const text = prompt || buildFallbackPrompt({ client, issue, auditType, platform });
    try {
      await navigator.clipboard.writeText(text);
      setMessage(`Istruzioni copiate per ${meta.label}.`);
    } catch {
      setMessage("Copia automatica non riuscita: seleziona il testo e copialo manualmente.");
    }
  };

  const routeAction = async () => {
    if (!issue) return;
    if (!prompt) await prepare();
    if (platform === "wordpress") {
      if (!wpProfile) {
        setMessage("WordPress non è ancora configurato per questo progetto. Apro Integrazioni.");
        localStorage.setItem("seogrow-selected-page-v1", JSON.stringify("Integrazioni"));
        window.location.hash = encodeURIComponent("Integrazioni");
        return;
      }
      setMessage(
        highRisk
          ? "Correzione WordPress preparata. Questo intervento richiede approvazione prima dell'applicazione."
          : "Correzione WordPress/Elementor preparata. Verifica la connessione in Integrazioni prima dell'applicazione.",
      );
      return;
    }
    await copyPrompt();
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
    <section ref={panelRef} className="panel remediation-panel">
      <div className="panel-head">
        <div>
          <h2>Correzioni SEO</h2>
          <p>SeoGrow instrada ogni intervento verso la piattaforma corretta del progetto.</p>
        </div>
        <span className="remediation-badge"><Wrench />{issues.length} problemi</span>
      </div>

      <div className="cms-router-card">
        <div>
          <strong>Piattaforma del progetto</strong>
          <small>La scelta viene ricordata per {client.name}.</small>
        </div>
        <select value={platform} onChange={(event) => savePlatform(event.target.value)}>
          <option value="gptsites">GPTSites</option>
          <option value="wordpress">WordPress + Elementor</option>
          <option value="manual">Manuale / altro CMS</option>
        </select>
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
          {highRisk && <small className="risk-note">Intervento ad alto rischio: richiede approvazione prima dell'applicazione.</small>}
        </div>
        <a href={issueUrl} target="_blank" rel="noreferrer"><ExternalLink />Apri pagina</a>
      </div>

      <div className="remediation-actions">
        <button type="button" className="primary" onClick={routeAction} disabled={loading}>
          <Sparkles />{loading ? "Preparazione…" : meta.action}
        </button>
        <button type="button" className="secondary" onClick={prepare} disabled={loading || !issue}>
          <Wrench />Prepara patch AI
        </button>
        <button type="button" className="secondary" onClick={copyPrompt} disabled={!issue}>
          <Copy />Copia istruzioni
        </button>
        <button type="button" className="secondary" onClick={verify} disabled={!issue}>
          <Check />Verifica correzione
        </button>
      </div>

      <div className="remediation-note">
        <strong>{meta.label}</strong>
        <span>{meta.note}</span>
        {platform === "wordpress" && (
          <span className={wpProfile ? "cms-connected" : "cms-missing"}>
            <Plug />{wpProfile ? `Profilo WordPress rilevato${wpProfile.name ? `: ${wpProfile.name}` : ""}.` : "Profilo WordPress non ancora configurato."}
          </span>
        )}
      </div>

      {prompt && (
        <label className="remediation-prompt">
          Patch / istruzioni pronte
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
  const [request, setRequest] = useState(null);

  useEffect(() => {
    const sync = () => {
      let page = "";
      try { page = decodeURIComponent(window.location.hash.slice(1)); } catch { page = ""; }
      const root = document.querySelector(".audit-enhancer-root");
      setTarget(page === "Audit SEO" ? root : null);
      setVersion((value) => value + 1);
    };
    const openRequested = (event) => {
      const detail = event.detail || {};
      setRequest({ ...detail, nonce: Date.now() });
      sync();
    };
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("storage", sync);
    window.addEventListener("seogrow-locationchange", sync);
    window.addEventListener("seogrow-remediation-open", openRequested);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("seogrow-locationchange", sync);
      window.removeEventListener("seogrow-remediation-open", openRequested);
    };
  }, []);

  if (!target) return null;
  const clients = readJson(CLIENTS_KEY, []);
  const selectedClientId = Number(readJson(SELECTED_CLIENT_KEY, clients[0]?.id));
  const client = clients.find((item) => item.id === selectedClientId) || clients[0];
  const selectedAudit = client
    ? requestedAudit(selectedClientId, request) || latestAudit(selectedClientId)
    : null;
  if (!client || !selectedAudit?.item) return null;

  return createPortal(
    <RemediationPanelView
      key={`${selectedClientId}-${selectedAudit.item.analyzedAt || selectedAudit.item.startedAt}-${version}-${request?.nonce || 0}`}
      client={client}
      clientId={selectedClientId}
      auditType={selectedAudit.type}
      audit={selectedAudit.item}
      initialIssueIndex={request?.issueIndex || 0}
      requestNonce={request?.nonce || 0}
    />,
    target,
  );
}
