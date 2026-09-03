import { contentPlan, opportunityGroups } from "./platform.js";

export const AgentDecision = Object.freeze({ CONTINUE: "CONTINUE", REPLAN: "REPLAN", COMPLETE: "COMPLETE", BLOCKED: "BLOCKED" });
export const AgentStatus = Object.freeze({ PLANNING: "PLANNING", RUNNING: "RUNNING", COMPLETED: "COMPLETED", PARTIAL: "PARTIAL", BLOCKED: "BLOCKED", FAILED: "FAILED", CANCELLED: "CANCELLED" });
export const AgentMode = Object.freeze({ READ_ONLY: "READ_ONLY", ASSISTED: "ASSISTED", AUTONOMOUS: "AUTONOMOUS" });

const highRiskCategories = new Set(["url", "slug", "canonical", "redirect", "robots", "noindex", "sitemap", "permalink", "critical-schema", "wordpress-global", "page-delete"]);
const clone = (value) => structuredClone(value);
const identifier = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
export const toolFingerprint = (tool, input, projectId, dataVersion = "") => `${tool}|${projectId || ""}|${dataVersion}|${stable(input || {})}`.toLowerCase();

export class AgentBudget {
  constructor(limits = {}) {
    this.limits = { maxSteps: 12, maxRetries: 1, maxDurationMs: 30_000, maxDataForSeoCalls: 0, maxOpenAiCalls: 0, maxUrls: 250, maxCost: 0, ...limits };
    this.used = { steps: 0, retries: 0, dataForSeoCalls: 0, openAiCalls: 0, urls: 0, cost: 0 };
  }
  consume(kind, amount = 1) {
    const keys = { step: ["steps", "maxSteps"], retry: ["retries", "maxRetries"], dataforseo: ["dataForSeoCalls", "maxDataForSeoCalls"], openai: ["openAiCalls", "maxOpenAiCalls"], url: ["urls", "maxUrls"], cost: ["cost", "maxCost"] };
    const [used, limit] = keys[kind] || [];
    if (!used || this.used[used] + amount > this.limits[limit]) throw Object.assign(new Error(`BUDGET_EXCEEDED:${kind}`), { code: "BUDGET_EXCEEDED" });
    this.used[used] += amount;
  }
}

export class AgentPolicy {
  constructor(mode = AgentMode.ASSISTED) { this.mode = mode; }
  check(tool) {
    if (!tool.mutatesData) return { allowed: true, approvalRequired: false };
    const highRisk = tool.risk === "HIGH" || highRiskCategories.has(tool.category);
    if (this.mode === AgentMode.READ_ONLY) return { allowed: false, approvalRequired: false, reason: "La modalità sola lettura vieta modifiche." };
    if (highRisk || this.mode === AgentMode.ASSISTED) return { allowed: false, approvalRequired: true, reason: "Questa azione richiede approvazione esplicita." };
    return { allowed: true, approvalRequired: false };
  }
}

export class ToolRegistry {
  constructor({ clock = Date.now } = {}) { this.clock = clock; this.tools = new Map(); this.cache = new Map(); this.runCalls = new Map(); }
  register(tool) {
    for (const field of ["name", "description", "inputSchema", "outputSchema", "source", "cost", "freshnessMs", "risk", "permission", "mutatesData", "timeoutMs", "execute"]) if (tool[field] === undefined) throw new Error(`Tool non valido: manca ${field}`);
    if (this.tools.has(tool.name)) throw new Error(`Tool duplicato: ${tool.name}`);
    this.tools.set(tool.name, Object.freeze({ ...tool })); return this;
  }
  capabilities() { return [...this.tools.values()].map(({ execute: _execute, ...metadata }) => metadata); }
  async execute(name, input = {}, context) {
    const tool = this.tools.get(name); if (!tool) throw new Error(`Tool sconosciuto: ${name}`);
    const permission = context.policy.check(tool);
    if (!permission.allowed) throw Object.assign(new Error(permission.reason), { code: permission.approvalRequired ? "APPROVAL_REQUIRED" : "PERMISSION_DENIED" });
    const fingerprint = toolFingerprint(name, input, context.projectId, context.dataVersion);
    const calls = this.runCalls.get(context.runId) || new Map(); this.runCalls.set(context.runId, calls);
    if (calls.has(fingerprint)) return { ...clone(calls.get(fingerprint)), reused: true };
    const cached = this.cache.get(fingerprint);
    if (cached && tool.freshnessMs > 0 && this.clock() - cached.at <= tool.freshnessMs) { calls.set(fingerprint, cached.result); return { ...clone(cached.result), reused: true, cached: true }; }
    context.budget.consume("step");
    if (tool.source === "DATAFORSEO") context.budget.consume("dataforseo");
    if (tool.source === "OPENAI") context.budget.consume("openai");
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(`Timeout: ${name}`), { code: "TOOL_TIMEOUT" })), tool.timeoutMs); });
    const started = this.clock(); let data;
    try { data = await Promise.race([Promise.resolve(tool.execute(input, context)), timeout]); } finally { clearTimeout(timer); }
    const result = { data, source: tool.source, observedAt: new Date().toISOString(), durationMs: this.clock() - started, fingerprint };
    calls.set(fingerprint, result); this.cache.set(fingerprint, { at: this.clock(), result }); return clone(result);
  }
}

export class SeoAgentPlanner {
  workflow(goal) {
    const text = String(goal || "").toLocaleLowerCase("it");
    if (/calo|diminuit|traffic drop/.test(text)) return "TRAFFIC_DROP";
    if (/top\s*10|prima pagina/.test(text)) return "TOP_10_PUSH";
    if (/decay|aggiornar|contenut/.test(text)) return "CONTENT_DECAY";
    if (/internal|link intern/.test(text)) return "INTERNAL_LINKING";
    return "TOP_OPPORTUNITIES";
  }
  plan(goal) {
    if (!String(goal || "").trim()) throw new Error("Inserisci un obiettivo SEO.");
    const workflow = this.workflow(goal);
    const templates = {
      TOP_OPPORTUNITIES: ["data.gsc", "data.analysis", "seo.opportunities"],
      TRAFFIC_DROP: ["data.gsc", "seo.trafficDrop"],
      TOP_10_PUSH: ["data.gsc", "seo.opportunities", "data.rankings"],
      CONTENT_DECAY: ["data.gsc", "data.analysis", "seo.contentDecay"],
      INTERNAL_LINKING: ["data.analysis", "seo.internalLinks"],
    };
    return { id: identifier("plan"), goal: String(goal).trim(), workflow, version: 1, editable: true, steps: templates[workflow].map((tool) => ({ id: identifier("step"), tool, input: {}, status: "PENDING" })) };
  }
  replan(plan, steps) { return { ...clone(plan), version: plan.version + 1, replannedAt: new Date().toISOString(), steps: steps.map((step) => ({ id: identifier("step"), input: {}, status: "PENDING", ...step })) }; }
}

const scorePriority = ({ impact = 50, effort = 50, confidence = 50, commercialValue = 50, risk = 20 } = {}) => {
  const score = Math.round(Math.max(0, Math.min(100, impact * 0.3 + (100 - effort) * 0.2 + confidence * 0.25 + commercialValue * 0.2 - risk * 0.05)));
  return { score, category: score >= 72 && effort <= 55 ? "Quick Win" : score >= 65 ? "Strategic" : score >= 42 ? "Maintenance" : "Low Priority" };
};
const evidenceRecommendation = (item) => {
  if (!item.evidence?.length || !item.sources?.length) return null;
  const priority = scorePriority(item.scoring); return { id: identifier("recommendation"), fingerprint: stable([item.page, item.query, item.recommendation]), ...item, priority: priority.category, priorityScore: priority.score };
};

function recommendationsFor(workflow, observations) {
  const output = Object.fromEntries(observations.filter((item) => item.status === "COMPLETED").map((item) => [item.tool, item.result.data]));
  const opportunities = output["seo.opportunities"] || [];
  let candidates = [];
  if (["TOP_OPPORTUNITIES", "TOP_10_PUSH"].includes(workflow)) candidates = opportunities.filter((row) => workflow !== "TOP_10_PUSH" || (row.position > 10 && row.position <= 20)).map((row) => ({ page: row.page || "", query: row.dimension || row.query || "", evidence: [{ metric: "impressions", value: row.impressions }, { metric: "clicks", value: row.clicks }, { metric: "position", value: row.position }, { metric: "ctr", value: row.ctr }], interpretation: "Query con visibilità reale e margine di miglioramento.", recommendation: row.position > 10 ? "Rafforza pertinenza, contenuto e linking interno verso la pagina." : "Migliora snippet e copertura dell’intento mantenendo la pertinenza attuale.", sources: ["Google Search Console"], confidence: 86, scoring: { impact: Math.min(100, 45 + Math.log10((row.impressions || 0) + 1) * 14), effort: 40, confidence: 86, commercialValue: 55, risk: 12 } }));
  if (workflow === "TRAFFIC_DROP") candidates = (output["seo.trafficDrop"] || []).map((row) => ({ page: row.page || "", query: row.query || row.dimension || "", evidence: [{ metric: "click_delta", value: row.clickDelta }, { metric: "position_delta", value: row.positionDelta }], interpretation: "La query ha perso clic o posizione rispetto al periodo precedente compatibile.", recommendation: "Verifica intento, pagina associata e cambiamenti tecnici prima di modificare il contenuto.", sources: ["Confronto storico Search Console"], confidence: 82, scoring: { impact: 80, effort: 45, confidence: 82, risk: 15 } }));
  if (workflow === "CONTENT_DECAY") candidates = (output["seo.contentDecay"] || []).map((row) => ({ page: row.url || row.page || "", query: row.title || row.query || "", evidence: [{ metric: "observed_change", value: row.reason || row.detail || "calo rilevato" }], interpretation: "Il dato storico o tecnico indica un contenuto da riesaminare.", recommendation: "Revisiona accuratezza, copertura e data di aggiornamento conservando URL e segnali validi.", sources: [row.source || "Search Console / audit"], confidence: 76, scoring: { impact: 72, effort: 50, confidence: 76, risk: 18 } }));
  if (workflow === "INTERNAL_LINKING") candidates = (output["seo.internalLinks"] || []).map((row) => ({ page: row.targetUrl || row.target || "", query: row.anchor || "", evidence: [{ metric: "source_page", value: row.sourceUrl || row.source }, { metric: "target_page", value: row.targetUrl || row.target }], interpretation: row.reason || "Il crawl ha individuato una relazione interna utile.", recommendation: `Prepara un link contestuale${row.anchor ? ` con anchor “${row.anchor}”` : ""}.`, sources: ["Audit link interni"], confidence: 80, scoring: { impact: 68, effort: 25, confidence: 80, risk: 10 } }));
  return candidates.map(evidenceRecommendation).filter(Boolean).sort((a, b) => b.priorityScore - a.priorityScore).filter((item, index, all) => all.findIndex((other) => other.fingerprint === item.fingerprint) === index).slice(0, 10);
}

export class SeoAgentOrchestrator {
  constructor({ registry, planner = new SeoAgentPlanner(), assessor = () => ({ decision: AgentDecision.CONTINUE }), onUpdate = () => {} }) { this.registry = registry; this.planner = planner; this.assessor = assessor; this.onUpdate = onUpdate; this.active = new Map(); }
  cancel(runId) { if (this.active.has(runId)) this.active.get(runId).cancelled = true; }
  async run(goal, input = {}) {
    const run = { id: identifier("agent-run"), projectId: input.projectId, goal: String(goal || "").trim(), mode: input.mode || AgentMode.ASSISTED, status: AgentStatus.PLANNING, decision: AgentDecision.CONTINUE, observations: [], recommendations: [], errors: [], startedAt: new Date().toISOString() };
    const budget = new AgentBudget(input.budget), policy = new AgentPolicy(run.mode), token = { cancelled: false }, started = Date.now(); this.active.set(run.id, token); this.onUpdate(clone(run));
    try {
      run.plan = this.planner.plan(run.goal); run.status = AgentStatus.RUNNING; this.onUpdate(clone(run)); let cursor = 0;
      while (cursor < run.plan.steps.length) {
        if (token.cancelled) { run.status = AgentStatus.CANCELLED; break; }
        if (Date.now() - started > budget.limits.maxDurationMs) { run.status = AgentStatus.PARTIAL; run.errors.push("Tempo massimo raggiunto."); break; }
        const step = run.plan.steps[cursor]; let attempts = 0; step.status = "RUNNING";
        while (true) {
          try { const result = await this.registry.execute(step.tool, step.input, { runId: run.id, projectId: run.projectId, dataVersion: input.dataVersion, budget, policy, input, observations: run.observations }); step.status = "COMPLETED"; run.observations.push({ id: identifier("observation"), tool: step.tool, status: "COMPLETED", result }); break; }
          catch (error) { if (error.code !== "BUDGET_EXCEEDED" && attempts < budget.limits.maxRetries) { budget.consume("retry"); attempts += 1; continue; } step.status = "FAILED"; run.errors.push(error.message); run.observations.push({ id: identifier("observation"), tool: step.tool, status: "FAILED", error: error.message }); if (error.code === "BUDGET_EXCEEDED") run.status = AgentStatus.PARTIAL; break; }
        }
        this.onUpdate(clone(run)); if (run.status === AgentStatus.PARTIAL) break;
        const assessment = this.assessor(clone(run), clone(step));
        if (assessment.decision === AgentDecision.REPLAN) { run.plan = this.planner.replan(run.plan, assessment.steps || []); run.decision = AgentDecision.REPLAN; cursor = 0; continue; }
        if (assessment.decision === AgentDecision.BLOCKED) { run.status = AgentStatus.BLOCKED; run.decision = AgentDecision.BLOCKED; break; }
        if (assessment.decision === AgentDecision.COMPLETE) break; cursor += 1;
      }
      if (run.status === AgentStatus.RUNNING) { run.recommendations = recommendationsFor(run.plan.workflow, run.observations); const hasEvidence = run.observations.some((item) => item.status === "COMPLETED" && item.result.data && (Array.isArray(item.result.data) ? item.result.data.length : true)); if (!hasEvidence) { run.status = AgentStatus.BLOCKED; run.decision = AgentDecision.BLOCKED; run.errors.push("Dati reali insufficienti per questo workflow."); } else if (!run.recommendations.length) { run.status = AgentStatus.PARTIAL; run.decision = AgentDecision.COMPLETE; run.errors.push("I dati disponibili non supportano raccomandazioni sufficientemente solide."); } else { run.status = AgentStatus.COMPLETED; run.decision = AgentDecision.COMPLETE; } }
    } catch (error) { run.status = AgentStatus.FAILED; run.decision = AgentDecision.BLOCKED; run.errors.push(error.message); }
    run.budget = clone(budget); run.completedAt = new Date().toISOString(); this.active.delete(run.id); this.onUpdate(clone(run)); return clone(run);
  }
}

const readTool = (name, description, execute) => ({ name, description, inputSchema: { type: "object" }, outputSchema: {}, source: "LOCAL_DATA", cost: "NONE", freshnessMs: 0, risk: "LOW", permission: "READ", mutatesData: false, timeoutMs: 2_000, execute });
export function createSeoGrowToolRegistry() {
  return new ToolRegistry()
    .register(readTool("data.gsc", "Legge il dataset Search Console già disponibile.", (_input, context) => context.input.dataset || null))
    .register(readTool("data.analysis", "Legge l’ultimo audit già disponibile.", (_input, context) => context.input.analysis || null))
    .register(readTool("data.rankings", "Legge lo storico posizionamenti DataForSEO già salvato.", (_input, context) => context.input.rankings || []))
    .register(readTool("seo.opportunities", "Riutilizza il motore opportunità della 1.4.2.", (_input, context) => opportunityGroups(context.input.dataset).quickWins))
    .register(readTool("seo.trafficDrop", "Riutilizza il confronto storico Search Console.", (_input, context) => (context.input.dataset?.changes || []).filter((row) => row.clickDelta < 0 || row.positionDelta > 2).slice(0, 50)))
    .register(readTool("seo.contentDecay", "Combina cali Search Console e contenuti tecnici da aggiornare.", (_input, context) => [...(context.input.dataset?.changes || []).filter((row) => row.clickDelta < 0), ...contentPlan(context.input.dataset, context.input.analysis).filter((row) => row.type === "Aggiornamento")].slice(0, 50)))
    .register(readTool("seo.internalLinks", "Riutilizza i suggerimenti di linking dell’audit.", (_input, context) => context.input.analysis?.internalLinkSuggestions || []));
}
