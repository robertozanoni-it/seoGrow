import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, Tags } from "lucide-react";
import { apiFetch } from "./api";
import { normalizeAnalysisHistory } from "./platform";
import { recheckCorrectionById } from "./remediationIntegrity";
import { saveCorrection, setLastBatch } from "./remediationStore";
import { normalizeClientId } from "./reliabilityModel";
import "./WordPressTaxonomyRemediationControl.css";

const CLIENTS_KEY = "seogrow-clients";
const SELECTED_CLIENT_KEY = "seogrow-selected-client-v1";
const PAGE_HISTORY_KEY = "seogrow-page-audit-history-v2";
const SITE_HISTORY_KEY = "seogrow-analyses-v2";

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
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

const selectAudit = (clientId, requested) => {
  const list = candidates(clientId);
  if (!requested) return list[0] || null;
  if (normalizeClientId(requested.clientId) !== normalizeClientId(clientId)) return null;
  const matches = list.filter((entry) =>
    entry.type === requested.auditType && String(auditTimestamp(entry)) === String(requested.analyzedAt),
  );
  return matches.length === 1 ? matches[0] : null;
};

const issueUrl = (issue, audit, client) => issue?.targetUrl || issue?.url || audit?.url || client?.url || "";
const issueText = (issue) => `${issue?.type || ""} ${issue?.label || ""} ${issue?.detail || ""}`.toLowerCase();
const classifyIssue = (issue) => {
  const text = issueText(issue);
  if (/meta description/.test(text)) return "meta_description";
  if (/canonical/.test(text)) return "canonical";
  if (/noindex|indexability|indicizz/.test(text)) return "noindex";
  if (/title|titolo/.test(text)) return "title";
  return "";
};
const suspectedTaxonomyUrl = (value) => {
  try {
    return /\/(?:category|categoria|tag)(?:\/|$)/i.test(new URL(String(value || "")).pathname);
  } catch { return false; }
};

const readCredentials = () => {
  const root = document.querySelector(".audit-unified-credentials");
  const inputs = [...(root?.querySelectorAll("input") || [])];
  return {
    siteUrl: inputs.find((input) => input.autocomplete === "url")?.value?.trim() || "",
    username: inputs.find((input) => input.autocomplete === "username")?.value?.trim() || "",
    applicationPassword: inputs.find((input) => input.type === "password")?.value || "",
  };
};

const previewValue = (value) => typeof value === "boolean" ? (value ? "noindex" : "index") : String(value ?? "—");

async function inspectTaxonomy(url, credentials) {
  const response = await apiFetch("/api/wordpress/inspect-taxonomy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      siteUrl: credentials.siteUrl,
      url,
      username: credentials.username,
      applicationPassword: credentials.applicationPassword,
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "Ispezione tassonomia non riuscita.");
    error.code = data.code || "TAXONOMY_INSPECT_FAILED";
    throw error;
  }
  return data;
}

async function generatedSeoValue(field, issue, inspection) {
  const kind = field === "title" ? "seo_title" : "meta_description";
  const response = await apiFetch("/api/wordpress/generate-seo-value-v2", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind,
      issue,
      page: {
        title: inspection.term?.name || "",
        content: inspection.term?.description || "",
        excerpt: "",
        url: inspection.term?.link || "",
      },
    }),
  });
  const data = await response.json();
  if (!response.ok || data.publishable !== true || !String(data.value || "").trim()) {
    const error = new Error(data.error || "La proposta SEO per la tassonomia richiede revisione editoriale.");
    error.code = data.code || "EDITORIAL_REVIEW_REQUIRED";
    throw error;
  }
  return { value: String(data.value).trim(), quality: data.quality || null };
}

export default function WordPressTaxonomyRemediationControl() {
  const [target, setTarget] = useState(null);
  const [revision, setRevision] = useState(0);
  const [requestedAudit, setRequestedAudit] = useState(null);
  const [inspection, setInspection] = useState(null);
  const [detecting, setDetecting] = useState(false);
  const [detectionError, setDetectionError] = useState("");
  const [preview, setPreview] = useState(null);
  const [quality, setQuality] = useState(null);
  const [message, setMessage] = useState("");
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [appliedRecordId, setAppliedRecordId] = useState("");
  const [canonicalTarget, setCanonicalTarget] = useState("");
  const [canonicalConfirmed, setCanonicalConfirmed] = useState(false);
  const [indexingIntent, setIndexingIntent] = useState("");
  const [indexingConfirmed, setIndexingConfirmed] = useState(false);

  useEffect(() => {
    let frame = 0;
    let attempts = 0;
    const find = () => {
      const next = document.querySelector(".audit-unified-remediation");
      if (next) { setTarget(next); return; }
      attempts += 1;
      if (attempts < 120) frame = window.requestAnimationFrame(find);
    };
    find();
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    const open = (event) => {
      const detail = event?.detail || {};
      setRequestedAudit({
        clientId: normalizeClientId(detail.clientId),
        issueIndex: Number(detail.issueIndex || 0),
        auditType: detail.auditType || "page",
        analyzedAt: detail.analyzedAt || "",
      });
      refresh();
    };
    window.addEventListener("seogrow-remediation-open", open);
    window.addEventListener("seogrow-remediation-history", refresh);
    window.addEventListener("storage", refresh);
    if (target) {
      target.addEventListener("input", refresh);
      target.addEventListener("change", refresh);
    }
    return () => {
      window.removeEventListener("seogrow-remediation-open", open);
      window.removeEventListener("seogrow-remediation-history", refresh);
      window.removeEventListener("storage", refresh);
      if (target) {
        target.removeEventListener("input", refresh);
        target.removeEventListener("change", refresh);
      }
    };
  }, [target]);

  const clients = readJson(CLIENTS_KEY, []);
  const clientId = normalizeClientId(readJson(SELECTED_CLIENT_KEY, clients[0]?.id));
  const client = clients.find((item) => normalizeClientId(item?.id) === clientId) || null;
  const audit = clientId ? selectAudit(clientId, requestedAudit) : null;
  const issues = Array.isArray(audit?.item?.issues) ? audit.item.issues : [];
  const domIndex = Number(document.querySelector(".audit-issue-select select")?.value || 0);
  const selectedIndex = requestedAudit && normalizeClientId(requestedAudit.clientId) === clientId
    ? Number(requestedAudit.issueIndex || 0)
    : domIndex;
  const issue = issues[selectedIndex] || null;
  const sourceUrl = issueUrl(issue, audit?.item, client);
  const field = classifyIssue(issue);
  const suspected = suspectedTaxonomyUrl(sourceUrl);

  const signature = useMemo(() => `${clientId}|${auditTimestamp(audit)}|${selectedIndex}|${sourceUrl}|${revision}`, [clientId, audit, selectedIndex, sourceUrl, revision]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const credentials = readCredentials();
      if (!sourceUrl || !credentials.siteUrl || !credentials.username || !credentials.applicationPassword) {
        if (!cancelled) {
          setInspection(null);
          setDetectionError("");
          setDetecting(false);
        }
        return;
      }
      setDetecting(true);
      try {
        const data = await inspectTaxonomy(sourceUrl, credentials);
        if (cancelled) return;
        setInspection(data);
        setDetectionError("");
        setCanonicalTarget(data.term?.link || sourceUrl);
        setCanonicalConfirmed(false);
        setIndexingIntent("");
        setIndexingConfirmed(false);
        setPreview(null);
        setAppliedRecordId("");
      } catch (error) {
        if (cancelled) return;
        setInspection(null);
        setDetectionError(suspected ? error.message : "");
      } finally {
        if (!cancelled) setDetecting(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [signature, sourceUrl, suspected]);

  useEffect(() => {
    if (!target) return undefined;
    if (inspection?.resource === "taxonomy") target.dataset.taxonomyActive = "true";
    else delete target.dataset.taxonomyActive;
    return () => { delete target.dataset.taxonomyActive; };
  }, [target, inspection]);

  useEffect(() => {
    setPreview(null);
    setQuality(null);
    setMessage("");
    setAppliedRecordId("");
  }, [sourceUrl, selectedIndex, field]);

  if (!target || (!inspection && !suspected)) return null;

  const prepare = async () => {
    if (!inspection || !field || running) return;
    const credentials = readCredentials();
    if (!credentials.siteUrl || !credentials.username || !credentials.applicationPassword) {
      setMessage("Inserisci URL, utente e password applicativa WordPress prima di preparare la correzione della tassonomia.");
      return;
    }
    if (inspection.writable !== true) {
      setMessage(inspection.nextStep || "Ownership SEO della tassonomia non univoca: scrittura bloccata.");
      return;
    }
    setRunning(true);
    setMessage("Preparazione anteprima tassonomia…");
    try {
      let value;
      let intent = {};
      let generatedQuality = null;
      if (field === "title" || field === "meta_description") {
        const generated = await generatedSeoValue(field, issue, inspection);
        value = generated.value;
        generatedQuality = generated.quality;
      } else if (field === "canonical") {
        if (!canonicalConfirmed || !canonicalTarget.trim()) throw new Error("Conferma esplicitamente la destinazione canonical prima di preparare l'anteprima.");
        value = canonicalTarget.trim();
        intent = { canonicalTargetConfirmed: true, canonicalTarget: value };
      } else if (field === "noindex") {
        if (!indexingConfirmed || !["index", "noindex"].includes(indexingIntent)) throw new Error("Scegli e conferma esplicitamente l'intento di indicizzazione.");
        value = indexingIntent === "noindex";
        intent = { indexingIntent };
      } else {
        throw new Error("Per categorie e tag SeoGrow supporta automaticamente solo title, meta description, canonical e noindex.");
      }

      const response = await apiFetch("/api/wordpress/taxonomy-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          siteUrl: credentials.siteUrl,
          url: sourceUrl,
          username: credentials.username,
          applicationPassword: credentials.applicationPassword,
          field,
          value,
          intent,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Anteprima tassonomia non riuscita.");
      setPreview(data);
      setQuality(generatedQuality);
      setMessage("Anteprima pronta. Nessuna modifica è stata ancora applicata a WordPress.");
    } catch (error) {
      setPreview(null);
      setMessage(error.message);
    } finally {
      setRunning(false);
    }
  };

  const apply = async () => {
    if (!preview?.approvalToken || applying) return;
    const credentials = readCredentials();
    if (!credentials.username || !credentials.applicationPassword) {
      setMessage("Reinserisci la password applicativa WordPress prima dell'approvazione.");
      return;
    }
    const termLabel = `${inspection.term?.taxonomy === "category" ? "Categoria" : "Tag"} “${inspection.term?.name || ""}”`;
    if (!window.confirm(`Applicare ORA questa singola modifica alla tassonomia WordPress live?\n\n${termLabel}\nCampo: ${field}\nPrima: ${previewValue(preview.previewBefore)}\nDopo: ${previewValue(preview.previewAfter)}\n\nLa modifica sarà registrata come Da verificare.`)) return;

    setApplying(true);
    setMessage("Applicazione tassonomia live…");
    try {
      const response = await apiFetch("/api/wordpress/taxonomy-apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          approvalToken: preview.approvalToken,
          username: credentials.username,
          applicationPassword: credentials.applicationPassword,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Applicazione tassonomia non riuscita.");
      const batchId = `taxonomy-remediation-${Date.now()}`;
      setLastBatch(batchId);
      const record = {
        id: `correction-${crypto.randomUUID()}`,
        batchId,
        clientId,
        clientName: client?.name || "",
        platform: "wordpress",
        liveApproval: true,
        adapter: data.adapter || preview.adapter,
        issue,
        issueLabel: issue?.label || "Problema SEO tassonomia",
        issueType: issue?.type || "taxonomy",
        severity: issue?.severity || "media",
        sourceUrl: data.sourceUrl || sourceUrl,
        siteUrl: credentials.siteUrl,
        resource: "taxonomy",
        entityId: Number(data.termId || inspection.term?.id),
        taxonomy: data.taxonomy || inspection.term?.taxonomy || "",
        taxonomyField: field,
        username: credentials.username,
        fields: [field],
        before: { [field]: preview.previewBefore },
        after: { [field]: preview.previewAfter },
        editorialQuality: quality,
        status: "Da verificare",
        appliedAt: new Date().toISOString(),
        frontendConfirmed: false,
        auditType: audit?.type || "page",
        auditAnalyzedAt: auditTimestamp(audit),
        verificationNote: `Modifica tassonomia applicata tramite ${data.adapter || preview.adapter}. Valore salvato e risultato pubblico restano da riverificare.`,
      };
      await saveCorrection(record);
      window.dispatchEvent(new CustomEvent("seogrow-remediation-applied", { detail: { id: record.id, batchId } }));
      setAppliedRecordId(record.id);
      setPreview(null);
      setMessage("Modifica tassonomia applicata e registrata. Stato: Da verificare.");
    } catch (error) {
      setMessage(`Applicazione non completata: ${error.message}`);
    } finally {
      setApplying(false);
    }
  };

  const verify = async () => {
    if (!appliedRecordId || verifying) return;
    const credentials = readCredentials();
    setVerifying(true);
    setMessage("Riverifica tassonomia in corso…");
    try {
      const result = await recheckCorrectionById(appliedRecordId, {
        siteUrl: credentials.siteUrl,
        username: credentials.username,
        applicationPassword: credentials.applicationPassword,
      });
      if (result?.error) throw result.error;
      if (result?.record?.status === "Verificato") setMessage("Riverifica completata: valore salvato e risultato pubblico sono coerenti. Correzione verificata.");
      else setMessage(result?.record?.verificationNote || "Riverifica completata: la correzione resta Da verificare.");
    } catch (error) {
      setMessage(`Riverifica non conclusa: ${error.message}`);
    } finally {
      setVerifying(false);
    }
  };

  return createPortal(
    <section className="panel taxonomy-remediation" aria-label="Remediation categorie e tag WordPress">
      <div className="taxonomy-remediation-head">
        <span><Tags /> Tassonomia WordPress</span>
        <h3>Categoria/tag riconosciuta dal permalink reale</h3>
        <p>SeoGrow usa il Connector per identificare esattamente il termine. Non assume che la URL debba contenere /category/ o /tag/.</p>
      </div>

      {!inspection && <div className="taxonomy-detect-state" role="status">
        <AlertTriangle />
        <div><strong>{detecting ? "Riconoscimento tassonomia…" : "Tassonomia non ancora confermata"}</strong><span>{detectionError || "Inserisci le credenziali WordPress e SeoGrow verificherà l'identità esatta prima di abilitare qualsiasi modifica."}</span></div>
      </div>}

      {inspection && <>
        <div className="taxonomy-identity-grid">
          <div><small>Tipo</small><strong>{inspection.term?.taxonomy === "category" ? "Categoria" : "Tag"}</strong></div>
          <div><small>Term ID</small><strong>#{inspection.term?.id}</strong></div>
          <div><small>Nome</small><strong>{inspection.term?.name || "—"}</strong></div>
          <div><small>Ownership SEO</small><strong>{inspection.ownership || "—"}</strong></div>
        </div>

        {inspection.writable !== true && <div className="taxonomy-blocked" role="alert"><AlertTriangle /><span><strong>Scrittura bloccata</strong>{inspection.nextStep}</span></div>}

        {!field && <div className="taxonomy-blocked" role="alert"><AlertTriangle /><span><strong>Problema non automatizzabile su tassonomia</strong>Per categorie e tag il flusso sicuro copre title, meta description, canonical e noindex. Gli altri problemi restano manuali/da analizzare.</span></div>}

        {field === "canonical" && <div className="taxonomy-intent-box">
          <label>Canonical da impostare<input value={canonicalTarget} onChange={(event) => { setCanonicalTarget(event.target.value); setCanonicalConfirmed(false); }} /></label>
          <label className="taxonomy-confirm"><input type="checkbox" checked={canonicalConfirmed} onChange={(event) => setCanonicalConfirmed(event.target.checked)} />Confermo esplicitamente che questa è la destinazione canonical corretta.</label>
        </div>}

        {field === "noindex" && <div className="taxonomy-intent-box">
          <label>Intento di indicizzazione<select value={indexingIntent} onChange={(event) => { setIndexingIntent(event.target.value); setIndexingConfirmed(false); }}><option value="">Seleziona…</option><option value="index">INDEX — la tassonomia deve essere indicizzabile</option><option value="noindex">NOINDEX — la tassonomia non deve essere indicizzata</option></select></label>
          <label className="taxonomy-confirm"><input type="checkbox" checked={indexingConfirmed} onChange={(event) => setIndexingConfirmed(event.target.checked)} />Confermo esplicitamente questo intento di indicizzazione.</label>
        </div>}

        {field && inspection.writable === true && !appliedRecordId && <button type="button" className="primary taxonomy-prepare" disabled={running || applying} onClick={prepare}><ShieldCheck />{running ? "Preparazione…" : "Prepara anteprima tassonomia"}</button>}

        {preview && <article className="taxonomy-preview">
          <div className="taxonomy-preview-title"><CheckCircle2 /><div><strong>Anteprima pronta</strong><span>{preview.adapter} · {preview.field} · token monouso · scadenza {preview.expiresInSeconds}s</span></div></div>
          <div className="taxonomy-before-after"><section><small>Prima</small><pre>{previewValue(preview.previewBefore)}</pre></section><section><small>Dopo</small><pre>{previewValue(preview.previewAfter)}</pre></section></div>
          <button type="button" className="danger" disabled={applying} onClick={apply}><ShieldCheck />{applying ? "Applicazione…" : "Approva e applica questa modifica"}</button>
        </article>}

        {appliedRecordId && <button type="button" className="secondary taxonomy-verify" disabled={verifying} onClick={verify}><RefreshCw />{verifying ? "Riverifica…" : "Riverifica ora"}</button>}
      </>}

      {message && <p className="integration-result taxonomy-message" role="status">{message}</p>}
    </section>,
    target,
  );
}
