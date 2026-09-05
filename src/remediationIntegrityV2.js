import { apiFetch } from "./api";
import { listCorrections, readCorrection, updateCorrection } from "./remediationStore";
import { completeTaskForIssue, reopenTaskForIssue } from "./taskResolution";
import { forgetResolvedIssue, issueFamily, normalizeIssueUrl, rememberResolvedIssue } from "./issueIdentity";

const familyIssuePresent = (issues, record) => {
  const family = issueFamily(record?.issue || { type: record?.issueType, label: record?.issueLabel });
  const target = normalizeIssueUrl(record?.sourceUrl || "");
  return (Array.isArray(issues) ? issues : []).some((candidate) => {
    if (issueFamily(candidate) !== family) return false;
    const candidateUrl = normalizeIssueUrl(candidate?.targetUrl || candidate?.url || candidate?.sourceUrl || "");
    return !target || !candidateUrl || candidateUrl === target;
  });
};

const frontendExpected = (record) => {
  const verification = record?.verification || {};
  return {
    ...(verification.expectedTitle ? { title: verification.expectedTitle } : {}),
    ...(verification.expectedDescription ? { description: verification.expectedDescription } : {}),
    ...(verification.expectedContent ? { content: verification.expectedContent } : {}),
    ...(verification.expectedH1Text ? { h1Text: verification.expectedH1Text } : {}),
  };
};

async function inspectFrontend(record) {
  const response = await apiFetch("/api/wordpress/verify-frontend-v2", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: record.sourceUrl, expected: frontendExpected(record) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Verifica frontend non riuscita.");
  return data;
}

async function freshAudit(record, family) {
  const endpoint = ["title-duplicate", "meta-description-duplicate"].includes(family)
    ? "/api/site-analysis"
    : "/api/audit";
  const body = endpoint === "/api/site-analysis"
    ? { url: record.sourceUrl, maxPages: 80 }
    : { url: record.sourceUrl };
  const response = await apiFetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Nuovo controllo SEO non riuscito.");
  return data;
}

const positiveFrontendEvidence = (record, family, frontend) => {
  const verification = record?.verification || {};
  if (family === "short-content") {
    const threshold = Number(frontend.words) >= Number(frontend.minimumWords || 180);
    const contentProof = verification.expectedContent ? frontend.contentProbeAllMatched === true : false;
    return threshold && contentProof;
  }
  if (family === "h1") {
    const countOk = Number(frontend.h1) === 1;
    const textOk = verification.expectedH1Text ? frontend.h1TextMatchesExpected === true : false;
    const contentOk = verification.expectedContent ? frontend.contentProbeAllMatched === true : true;
    return countOk && textOk && contentOk;
  }
  if (["title", "title-duplicate"].includes(family)) return verification.expectedTitle ? frontend.titleMatchesExpected === true : false;
  if (["meta-description", "meta-description-duplicate"].includes(family)) return verification.expectedDescription ? frontend.descriptionMatchesExpected === true : false;
  if (family === "canonical") return verification.expectedCanonical ? normalizeIssueUrl(frontend.canonical) === normalizeIssueUrl(verification.expectedCanonical) : false;
  if (family === "noindex") return verification.expectedIndexable === true ? frontend.indexable === true : false;
  if (verification.expectedContent) return frontend.contentProbeAllMatched === true;
  return false;
};

const verifiedNote = (family, frontend) => {
  if (family === "short-content") return `Confermato: contenuto modificato visibile e ${frontend.words} parole nel frontend (soglia ${frontend.minimumWords}).`;
  if (family === "h1") return `Confermato: esattamente 1 H1 visibile${frontend.h1Texts?.[0] ? ` (“${frontend.h1Texts[0]}”)` : ""}.`;
  if (family === "canonical") return `Confermato: canonical pubblica ${frontend.canonical}.`;
  if (family === "noindex") return "Confermato: la pagina pubblica è indicizzabile.";
  return "Confermato: il valore modificato è visibile nel frontend e il problema SEO non è più rilevato.";
};

export async function verifyCorrectionRecord(record) {
  if (!record?.id || !record?.sourceUrl || record.status === "Ripristinato") return record;
  const family = issueFamily(record.issue || { type: record.issueType, label: record.issueLabel });
  try {
    const frontend = await inspectFrontend(record);
    const audit = await freshAudit(record, family);
    const present = familyIssuePresent(audit.issues, record);
    const frontendOk = positiveFrontendEvidence(record, family, frontend);
    const verifiedAt = new Date().toISOString();

    if (!present && frontendOk) {
      const updated = await updateCorrection(record.id, {
        status: "Verificato",
        verifiedAt,
        frontendConfirmed: true,
        frontendFailure: false,
        lastVerificationError: "",
        verificationNote: verifiedNote(family, frontend),
        frontendSnapshot: {
          title: frontend.title,
          description: frontend.description,
          h1: frontend.h1,
          h1Texts: frontend.h1Texts,
          words: frontend.words,
          canonical: frontend.canonical,
          indexable: frontend.indexable,
        },
      });
      rememberResolvedIssue(record.clientId, record.issue || { type: record.issueType, label: record.issueLabel }, record.sourceUrl, {
        correctionId: record.id,
        source: "verification-v2",
      });
      completeTaskForIssue(record.clientId, record.issue || { type: record.issueType, label: record.issueLabel }, record.sourceUrl, updated?.verificationNote);
      return updated;
    }

    forgetResolvedIssue(record.clientId, record.issue || { type: record.issueType, label: record.issueLabel }, record.sourceUrl);
    const reason = present
      ? "Il nuovo controllo rileva ancora lo stesso problema SEO."
      : "Il problema non è più rilevato, ma manca la prova che il valore modificato sia realmente quello visibile nel frontend.";
    const updated = await updateCorrection(record.id, {
      status: "Da verificare",
      verifiedAt,
      frontendConfirmed: frontendOk,
      frontendFailure: true,
      lastVerificationError: "",
      verificationNote: reason,
      frontendSnapshot: {
        title: frontend.title,
        description: frontend.description,
        h1: frontend.h1,
        h1Texts: frontend.h1Texts,
        words: frontend.words,
        canonical: frontend.canonical,
        indexable: frontend.indexable,
      },
    });
    if (record.status === "Verificato") reopenTaskForIssue(updated || record, reason);
    return updated;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Verifica non conclusa.";
    if (record.status === "Verificato") {
      return updateCorrection(record.id, {
        lastVerificationError: message,
        lastVerificationAttemptAt: new Date().toISOString(),
        verificationNote: `${record.verificationNote || "Correzione già verificata."} Ultimo ricontrollo non concluso: ${message}`,
      });
    }
    return updateCorrection(record.id, {
      status: "Da verificare",
      frontendFailure: false,
      lastVerificationError: message,
      lastVerificationAttemptAt: new Date().toISOString(),
      verificationNote: `Verifica automatica non conclusa: ${message}`,
    });
  }
}

let queue = Promise.resolve();
const enqueue = (work) => {
  queue = queue.then(work, work).catch((error) => console.warn("Riverifica remediation V2 non completata:", error));
  return queue;
};

async function verifyByFilter({ id, batchId, all = false } = {}) {
  if (id) {
    const record = await readCorrection(id);
    if (record) await verifyCorrectionRecord(record);
    return;
  }
  const rows = await listCorrections(batchId ? { batchId } : {});
  const selected = all ? rows : rows.filter((record) => record.status === "Da verificare" || record.status === "Applicato");
  for (const record of selected) await verifyCorrectionRecord(record);
}

if (typeof window !== "undefined") {
  window.addEventListener("seogrow-remediation-applied", (event) => {
    const id = event?.detail?.id;
    window.setTimeout(() => enqueue(() => verifyByFilter({ id })), 900);
  });
  window.addEventListener("seogrow-remediation-recheck", (event) => {
    enqueue(() => verifyByFilter({ id: event?.detail?.id, batchId: event?.detail?.batchId, all: Boolean(event?.detail?.all) }));
  });
}
