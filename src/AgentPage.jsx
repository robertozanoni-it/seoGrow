import { useMemo, useState } from "react";
import { CheckCircle2, Circle, LoaderCircle, Play, ShieldCheck } from "lucide-react";
import { AgentMode, AgentStatus, SeoAgentOrchestrator, createSeoGrowToolRegistry } from "./agentRuntime";

const quickGoals = ["Trova le 10 migliori opportunità SEO", "Perché il traffico organico è diminuito?", "Quali pagine posso portare in Top 10?", "Quali contenuti devo aggiornare?", "Trova opportunità di internal linking"];
const statusLabel = { PLANNING: "Pianificazione", RUNNING: "Analisi in corso", WAITING_APPROVAL: "In attesa di approvazione", COMPLETED: "Completata", PARTIAL: "Risultato parziale", BLOCKED: "Dati insufficienti", FAILED: "Errore", CANCELLED: "Interrotta" };
const toolLabels = { "data.gsc": ["Dati Search Console", "Dataset salvato del progetto"], "data.analysis": ["Audit SEO", "Ultima analisi tecnica salvata"], "data.rankings": ["Ranking DataForSEO", "Storico posizionamenti salvato"], "seo.opportunities": ["Calcolo opportunità", "Motore opportunità SeoGrow"], "seo.trafficDrop": ["Analisi calo traffico", "Confronto periodi Search Console"], "seo.contentDecay": ["Analisi content decay", "Cali e piano contenuti"], "seo.internalLinks": ["Suggerimenti link interni", "Risultati del crawl salvato"] };

export default function AgentPage({ client, dataset, analysis, rankings, savedRuns = [], onSaveRun, onDeleteRun, onCreateTask }) {
  const [goal, setGoal] = useState("");
  const [currentRun, setCurrentRun] = useState(null);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState(AgentMode.ASSISTED);
  const [selectedRunId, setSelectedRunId] = useState("");
  const orchestrator = useMemo(() => new SeoAgentOrchestrator({ registry: createSeoGrowToolRegistry(), onUpdate: setCurrentRun }), []);
  const run = currentRun || savedRuns.find((item) => item?.id === selectedRunId) || savedRuns[0];
  const input = { projectId: client.id, dataset, analysis, rankings, dataVersion: [dataset?.importedAt, analysis?.analyzedAt, rankings?.[0]?.checkedAt].filter(Boolean).join("|"), mode };
  const start = async () => {
    if (!goal.trim() || running) return;
    setRunning(true);
    const result = await orchestrator.run(goal, input);
    onSaveRun(result); setRunning(false);
  };
  const decide = async (approved) => { if (!run?.pendingApproval) return; setRunning(true); const result = await orchestrator.resolveApproval(run, input, { approved, token: run.pendingApproval.token }); onSaveRun(result); setCurrentRun(result); setRunning(false); };
  return <>
    <div className="page-title"><div><h1>SEO Agent — {client.name}</h1><p>Definisci un obiettivo: l’agente pianifica e usa soltanto i dati necessari.</p></div><span className="status-badge"><ShieldCheck aria-hidden="true" /> {mode.replace("_", " ")}</span></div>
    <section className="panel agent-console">
      <div className="agent-form-field"><label htmlFor="seo-agent-mode">Modalità</label><select id="seo-agent-mode" value={mode} onChange={(event) => setMode(event.target.value)}><option value={AgentMode.READ_ONLY}>Sola lettura</option><option value={AgentMode.ASSISTED}>Assistita</option><option value={AgentMode.AUTONOMOUS}>Autonoma consentita</option></select></div>
      <div className="agent-form-field"><label htmlFor="seo-agent-goal">Cosa vuoi ottenere?</label><textarea id="seo-agent-goal" rows="3" value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="Es. Trova le 10 migliori opportunità SEO" /></div>
      <div className="agent-quick-actions">{quickGoals.map((item) => <button className="secondary" key={item} onClick={() => setGoal(item)}>{item}</button>)}</div>
      <div className="agent-controls"><button className="primary" onClick={start} disabled={running || !goal.trim()}>{running ? <LoaderCircle className="spin" aria-hidden="true" /> : <Play aria-hidden="true" />}{running ? "Analisi…" : "Avvia analisi"}</button>{running && run?.id && <button className="secondary" onClick={() => orchestrator.cancel(run.id)}>Interrompi</button>}</div>
    </section>
    {savedRuns.length > 0 && <section className="panel agent-history"><div className="panel-head"><div><h2>Cronologia run</h2><p>Conservata per il progetto selezionato.</p></div></div><div className="agent-form-field"><label htmlFor="agent-history">Esecuzione</label><select id="agent-history" value={selectedRunId} onChange={(event) => { setCurrentRun(null); setSelectedRunId(event.target.value); }}><option value="">Più recente</option>{savedRuns.filter(Boolean).map((item) => <option value={item.id} key={item.id}>{item.startedAt ? new Date(item.startedAt).toLocaleString("it-IT") : "Data sconosciuta"} · {item.status || "sconosciuto"}</option>)}</select></div>{run?.id && <button className="secondary" onClick={() => { if (window.confirm("Eliminare questo run SEO Agent?")) { onDeleteRun(run.id); setCurrentRun(null); setSelectedRunId(""); } }}>Elimina run</button>}</section>}
    {run && <section className="panel agent-run" aria-live="polite">
      <div className="panel-head"><div><h2>{statusLabel[run.status] || run.status}</h2><p>{run.goal}</p></div><span className={`priority ${run.status === AgentStatus.COMPLETED ? "bassa" : "media"}`}>{run.status}</span></div>
      <ol className="agent-steps">{(run.plan?.steps || []).map((step) => { const observation = (run.observations || []).findLast((item) => item.tool === step.tool); const [label, description] = toolLabels[step.tool] || [step.tool, "Tool agentico"]; return <li key={step.id} className={`agent-step-${String(step.status || "pending").toLowerCase()}`}>{["COMPLETED", "CACHED"].includes(step.status) ? <CheckCircle2 aria-hidden="true" /> : <Circle aria-hidden="true" />}<div><strong>{label}</strong><small>{description}</small><span>Stato: {step.status || "PENDING"} · Fonte: {observation?.result?.source || "—"} · Freshness: {observation?.result?.freshness || "—"} · Durata: {observation?.result?.durationMs ?? "—"} ms · Costo: {observation?.result?.actualCost ?? observation?.result?.estimatedCost ?? 0}</span>{observation?.error && <em>{observation.error}</em>}</div></li>; })}</ol>
      {run.errors?.length > 0 && <div className="empty-state"><p>{run.errors.join(" ")}</p></div>}
      {run.status === AgentStatus.WAITING_APPROVAL && run.pendingApproval && <div className="agent-approval"><h3>Approvazione richiesta</h3><dl><dt>Tool</dt><dd>{run.pendingApproval.tool}</dd><dt>Rischio</dt><dd>{run.pendingApproval.risk || "non disponibile"}</dd><dt>Costo stimato</dt><dd>{run.pendingApproval.estimatedCost || 0}</dd><dt>Anteprima</dt><dd><pre>{JSON.stringify(run.pendingApproval.preview || {}, null, 2)}</pre></dd></dl><div className="agent-controls"><button className="primary" onClick={() => decide(true)}>Approva</button><button className="secondary" onClick={() => decide(false)}>Rifiuta</button></div></div>}
    </section>}
    {run?.recommendations?.length > 0 && <section className="agent-recommendations"><h2>Azioni prioritarie</h2>{run.recommendations.map((item) => <article className="panel agent-recommendation" key={item.id}>
      <div className="panel-head"><div><h3>{item.query || item.page || "Opportunità SEO"}</h3><p>{item.page}</p></div><span className="priority media">{item.priority}</span></div>
      <p><strong>Evidenza:</strong> {(Array.isArray(item.evidence) ? item.evidence : []).map((entry) => `${entry?.metric || "dato"}: ${entry?.value ?? "non disponibile"}`).join(" · ") || "non disponibile"}</p>
      <p><strong>Interpretazione:</strong> {item.interpretation}</p><p><strong>Azione:</strong> {item.recommendation}</p>
      <div className="agent-recommendation-footer"><small>Confidenza {item.confidence ?? "—"}% · Fonti: {Array.isArray(item.sources) && item.sources.length ? item.sources.join(", ") : "non disponibili"}</small><button className="secondary" onClick={() => onCreateTask({ title: item.recommendation || "Rivedi raccomandazione SEO", priority: item.priority === "Quick Win" || item.priority === "Strategic" ? "Alta" : "Media", kind: "seo-agent", targetUrl: item.page, detail: `${item.interpretation || ""}\n\nEvidenza: ${(Array.isArray(item.evidence) ? item.evidence : []).map((entry) => `${entry?.metric || "dato"}: ${entry?.value ?? "non disponibile"}`).join(" · ")}\nFonti: ${(Array.isArray(item.sources) ? item.sources : []).join(", ")}` })}>Crea task</button></div>
    </article>)}</section>}
  </>;
}
