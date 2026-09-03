import { useMemo, useState } from "react";
import { CheckCircle2, Circle, LoaderCircle, Play, ShieldCheck } from "lucide-react";
import { AgentMode, AgentStatus, SeoAgentOrchestrator, createSeoGrowToolRegistry } from "./agentRuntime";

const quickGoals = ["Trova le 10 migliori opportunità SEO", "Perché il traffico organico è diminuito?", "Quali pagine posso portare in Top 10?", "Quali contenuti devo aggiornare?", "Trova opportunità di internal linking"];
const statusLabel = { PLANNING: "Pianificazione", RUNNING: "Analisi in corso", COMPLETED: "Completata", PARTIAL: "Risultato parziale", BLOCKED: "Dati insufficienti", FAILED: "Errore", CANCELLED: "Interrotta" };

export default function AgentPage({ client, dataset, analysis, rankings, savedRuns = [], onSaveRun, onCreateTask }) {
  const [goal, setGoal] = useState("");
  const [currentRun, setCurrentRun] = useState(null);
  const [running, setRunning] = useState(false);
  const orchestrator = useMemo(() => new SeoAgentOrchestrator({ registry: createSeoGrowToolRegistry(), onUpdate: setCurrentRun }), []);
  const run = currentRun || savedRuns[0];
  const start = async () => {
    if (!goal.trim() || running) return;
    setRunning(true);
    const result = await orchestrator.run(goal, { projectId: client.id, dataset, analysis, rankings, dataVersion: [dataset?.importedAt, analysis?.analyzedAt, rankings?.[0]?.checkedAt].filter(Boolean).join("|"), mode: AgentMode.ASSISTED });
    onSaveRun(result); setRunning(false);
  };
  return <>
    <div className="page-title"><div><h1>SEO Agent — {client.name}</h1><p>Definisci un obiettivo: l’agente pianifica e usa soltanto i dati locali necessari.</p></div><span className="status-badge"><ShieldCheck aria-hidden="true" /> Modalità assistita</span></div>
    <section className="panel agent-console">
      <label htmlFor="seo-agent-goal">Cosa vuoi ottenere?</label>
      <textarea id="seo-agent-goal" rows="3" value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="Es. Trova le 10 migliori opportunità SEO" />
      <div className="agent-quick-actions">{quickGoals.map((item) => <button className="secondary" key={item} onClick={() => setGoal(item)}>{item}</button>)}</div>
      <button className="primary" onClick={start} disabled={running || !goal.trim()}>{running ? <LoaderCircle className="spin" aria-hidden="true" /> : <Play aria-hidden="true" />}{running ? "Analisi…" : "Avvia analisi"}</button>
    </section>
    {run && <section className="panel agent-run" aria-live="polite">
      <div className="panel-head"><div><h2>{statusLabel[run.status] || run.status}</h2><p>{run.goal}</p></div><span className={`priority ${run.status === AgentStatus.COMPLETED ? "bassa" : "media"}`}>{run.status}</span></div>
      <ol className="agent-steps">{(run.plan?.steps || []).map((step) => <li key={step.id}>{step.status === "COMPLETED" ? <CheckCircle2 aria-hidden="true" /> : <Circle aria-hidden="true" />}<span>{step.tool}</span></li>)}</ol>
      {run.errors?.length > 0 && <div className="empty-state"><p>{run.errors.join(" ")}</p></div>}
    </section>}
    {run?.recommendations?.length > 0 && <section className="agent-recommendations"><h2>Azioni prioritarie</h2>{run.recommendations.map((item) => <article className="panel agent-recommendation" key={item.id}>
      <div className="panel-head"><div><h3>{item.query || item.page || "Opportunità SEO"}</h3><p>{item.page}</p></div><span className="priority media">{item.priority}</span></div>
      <p><strong>Evidenza:</strong> {item.evidence.map((entry) => `${entry.metric}: ${entry.value ?? "non disponibile"}`).join(" · ")}</p>
      <p><strong>Interpretazione:</strong> {item.interpretation}</p><p><strong>Azione:</strong> {item.recommendation}</p>
      <div className="agent-recommendation-footer"><small>Confidenza {item.confidence}% · Fonti: {item.sources.join(", ")}</small><button className="secondary" onClick={() => onCreateTask({ title: item.recommendation, priority: item.priority === "Quick Win" || item.priority === "Strategic" ? "Alta" : "Media", kind: "seo-agent", targetUrl: item.page, detail: `${item.interpretation}\n\nEvidenza: ${item.evidence.map((entry) => `${entry.metric}: ${entry.value ?? "non disponibile"}`).join(" · ")}\nFonti: ${item.sources.join(", ")}` })}>Crea task</button></div>
    </article>)}</section>}
  </>;
}
