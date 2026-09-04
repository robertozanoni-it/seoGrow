import { contentPlan, opportunityGroups } from "./platform.js";

export const AgentDecision = Object.freeze({ CONTINUE: "CONTINUE", REPLAN: "REPLAN", COMPLETE: "COMPLETE", BLOCKED: "BLOCKED" });
export const AgentStatus = Object.freeze({ PLANNING: "PLANNING", RUNNING: "RUNNING", WAITING_APPROVAL: "WAITING_APPROVAL", COMPLETED: "COMPLETED", PARTIAL: "PARTIAL", BLOCKED: "BLOCKED", FAILED: "FAILED", CANCELLED: "CANCELLED" });
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
export class AgentError extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } }
export function validateSchema(schema, value, path = "value") {
  if (!schema || Object.keys(schema).length === 0) return true;
  const type = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
  if (schema.type && type !== schema.type) throw new AgentError("SCHEMA_INVALID", `${path} deve essere ${schema.type}.`);
  if (schema.type === "object") {
    if (schema.minProperties && Object.keys(value).length < schema.minProperties) throw new AgentError("SCHEMA_INVALID", `${path} è vuoto.`);
    for (const key of schema.required || []) if (!(key in value)) throw new AgentError("SCHEMA_INVALID", `${path}.${key} è obbligatorio.`);
    for (const [key, child] of Object.entries(schema.properties || {})) if (key in value) validateSchema(child, value[key], `${path}.${key}`);
  }
  if (schema.type === "array") {
    if (schema.minItems && value.length < schema.minItems) throw new AgentError("SCHEMA_INVALID", `${path} non contiene elementi.`);
    if (schema.items) value.forEach((item, index) => validateSchema(schema.items, item, `${path}[${index}]`));
  }
  if (schema.enum && !schema.enum.includes(value)) throw new AgentError("SCHEMA_INVALID", `${path} contiene un valore non valido.`);
  return true;
}
export function hasUsableEvidence(tool, data, context = {}) {
  if (data == null || (Array.isArray(data) && data.length === 0) || (typeof data === "object" && !Array.isArray(data) && Object.keys(data).length === 0)) return false;
  if (data?.projectId != null && String(data.projectId) !== String(context.projectId)) return false;
  if (data?.expiresAt && Date.parse(data.expiresAt) < Date.now()) return false;
  try { validateSchema(tool?.outputSchema, data, "output"); return true; } catch { return false; }
}

export class AgentBudget {
  constructor(limits = {}) {
    this.limits = { maxSteps: 12, maxIterations: 20, maxReplans: 3, maxAssessments: 20, maxRetries: 1, maxDurationMs: 30_000, maxDataForSeoCalls: 0, maxOpenAiCalls: 0, maxUrls: 250, maxCost: 0, ...limits };
    this.used = { steps: 0, iterations: 0, replans: 0, assessments: 0, retries: 0, dataForSeoCalls: 0, openAiCalls: 0, urls: 0, cost: 0, reservedCost: 0 };
  }
  consume(kind, amount = 1) {
    const keys = { step: ["steps", "maxSteps"], iteration: ["iterations", "maxIterations"], replan: ["replans", "maxReplans"], assessment: ["assessments", "maxAssessments"], retry: ["retries", "maxRetries"], dataforseo: ["dataForSeoCalls", "maxDataForSeoCalls"], openai: ["openAiCalls", "maxOpenAiCalls"], url: ["urls", "maxUrls"], cost: ["cost", "maxCost"] };
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
  constructor({ clock = Date.now, maxCacheEntries = 100 } = {}) { this.clock = clock; this.maxCacheEntries = maxCacheEntries; this.tools = new Map(); this.cache = new Map(); this.runCalls = new Map(); this.inFlight = new Map(); }
  register(tool) {
    for (const field of ["name", "description", "inputSchema", "outputSchema", "source", "cost", "freshnessMs", "risk", "permission", "mutatesData", "timeoutMs", "idempotent", "supportsAbort", "execute"]) if (tool[field] === undefined) throw new Error(`Tool non valido: manca ${field}`);
    if (this.tools.has(tool.name)) throw new Error(`Tool duplicato: ${tool.name}`);
    this.tools.set(tool.name, Object.freeze({ ...tool })); return this;
  }
  capabilities() { return [...this.tools.values()].map(({ execute: _execute, ...metadata }) => metadata); }
  cleanupRun(runId) { this.runCalls.delete(runId); for (const key of this.inFlight.keys()) if (key.startsWith(`${runId}:`)) this.inFlight.delete(key); }
  async execute(name, input = {}, context) {
    const tool = this.tools.get(name); if (!tool) throw new AgentError("TOOL_UNKNOWN", `Tool sconosciuto: ${name}`);
    validateSchema(tool.inputSchema, input, "input");
    const permission = context.policy.check(tool);
    if (!permission.allowed && !context.approvalGranted) throw new AgentError(permission.approvalRequired ? "APPROVAL_REQUIRED" : "PERMISSION_DENIED", permission.reason, { tool: name });
    const fingerprint = toolFingerprint(name, input, context.projectId, context.dataVersion);
    const calls = this.runCalls.get(context.runId) || new Map(); this.runCalls.set(context.runId, calls);
    if (calls.has(fingerprint)) return { ...clone(calls.get(fingerprint)), reused: true };
    const cached = this.cache.get(fingerprint);
    if (cached && tool.freshnessMs > 0 && this.clock() - cached.at <= tool.freshnessMs) { calls.set(fingerprint, cached.result); return { ...clone(cached.result), reused: true, cached: true }; }
    if (tool.source === "DATAFORSEO") context.budget.consume("dataforseo");
    if (tool.source === "OPENAI") context.budget.consume("openai");
    const flightKey = `${context.runId}:${fingerprint}`; if (this.inFlight.has(flightKey)) return this.inFlight.get(flightKey);
    const execution = (async () => {
      const controller = new AbortController(); const abort = () => controller.abort(context.signal?.reason || new AgentError("CANCELLED", "Run interrotto.")); context.signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => controller.abort(new AgentError("TOOL_TIMEOUT", `Timeout: ${name}`)), tool.timeoutMs); const started = this.clock();
      try { const aborted = new Promise((_, reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true })); const data = await Promise.race([Promise.resolve(tool.execute(input, { ...context, signal: controller.signal })), aborted]); validateSchema(tool.outputSchema, data, "output"); const result = { data, source: tool.source, freshness: cached ? "reused" : "live", observedAt: new Date().toISOString(), durationMs: this.clock() - started, estimatedCost: tool.estimatedCost || 0, fingerprint }; calls.set(fingerprint, result); this.cache.set(fingerprint, { at: this.clock(), result }); while (this.cache.size > this.maxCacheEntries) this.cache.delete(this.cache.keys().next().value); return clone(result); }
      catch (error) { if (controller.signal.aborted) throw controller.signal.reason instanceof Error ? controller.signal.reason : new AgentError("CANCELLED", "Run interrotto."); throw error; }
      finally { clearTimeout(timer); context.signal?.removeEventListener("abort", abort); }
    })().finally(() => this.inFlight.delete(flightKey)); this.inFlight.set(flightKey, execution); return execution;
  }
}

export class SeoAgentPlanner {
  workflow(goal) {
    const text = String(goal || "").toLocaleLowerCase("it");
    if (/calo|diminuit|traffic drop/.test(text)) return "TRAFFIC_DROP";
    if (/top\s*10|prima pagina/.test(text)) return "TOP_10_PUSH";
    if (/decay|aggiornar|contenut/.test(text)) return "CONTENT_DECAY";
    if (/internal|link intern/.test(text)) return "INTERNAL_LINKING";
    if (/opportunit|quick win/.test(text)) return "TOP_OPPORTUNITIES";
    throw new AgentError("UNSUPPORTED_GOAL", "Obiettivo non riconosciuto: scegli un workflow o specifica meglio il risultato SEO desiderato.");
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
    const requested = Number(String(goal).match(/(?:dammi|trova|mostra)?\s*(?:le|i)?\s*(\d+)\s+(?:migliori\s+)?(?:opportunit|risultat|pagin)/i)?.[1] || 10);
    return { id: identifier("plan"), goal: String(goal).trim(), workflow, parameters: { maxResults: Math.min(50, Math.max(1, requested)) }, version: 1, editable: true, steps: templates[workflow].map((tool) => ({ id: identifier("step"), tool, input: {}, status: "PENDING" })) };
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

function recommendationsFor(workflow, observations, maxResults = 10) {
  const output = Object.fromEntries(observations.filter((item) => item.status === "COMPLETED").map((item) => [item.tool, item.result.data]));
  const rankingRows = (output["data.rankings"] || []).flatMap((entry) => entry?.rows || entry?.results || (entry?.keyword ? [entry] : []));
  const rankingByKeyword = new Map(rankingRows.map((row) => [String(row.keyword || row.query || "").toLocaleLowerCase("it"), row]));
  const opportunities = (output["seo.opportunities"] || []).map((row) => { const ranking = rankingByKeyword.get(String(row.dimension || row.query || "").toLocaleLowerCase("it")); return ranking ? { ...row, position: ranking.position ?? row.position, rankingSource: "DataForSEO" } : row; });
  let candidates = [];
  if (["TOP_OPPORTUNITIES", "TOP_10_PUSH"].includes(workflow)) candidates = opportunities.filter((row) => workflow !== "TOP_10_PUSH" || (row.position > 10 && row.position <= 20)).map((row) => ({ page: row.page || "", query: row.dimension || row.query || "", evidence: [{ metric: "impressions", value: row.impressions }, { metric: "clicks", value: row.clicks }, { metric: "position", value: row.position }, { metric: "ctr", value: row.ctr }], interpretation: "Query con visibilità reale e margine di miglioramento.", recommendation: row.position > 10 ? "Rafforza pertinenza, contenuto e linking interno verso la pagina." : "Migliora snippet e copertura dell’intento mantenendo la pertinenza attuale.", sources: ["Google Search Console", ...(row.rankingSource ? [row.rankingSource] : [])], confidence: row.rankingSource ? 90 : 86, scoring: { impact: Math.min(100, 45 + Math.log10((row.impressions || 0) + 1) * 14), effort: 40, confidence: row.rankingSource ? 90 : 86, commercialValue: 55, risk: 12 } }));
  if (workflow === "TRAFFIC_DROP") candidates = (output["seo.trafficDrop"] || []).map((row) => ({ page: row.page || "", query: row.query || row.dimension || "", evidence: [{ metric: "click_delta", value: row.clickDelta }, { metric: "position_delta", value: row.positionDelta }], interpretation: "La query ha perso clic o posizione rispetto al periodo precedente compatibile.", recommendation: "Verifica intento, pagina associata e cambiamenti tecnici prima di modificare il contenuto.", sources: ["Confronto storico Search Console"], confidence: 82, scoring: { impact: 80, effort: 45, confidence: 82, risk: 15 } }));
  if (workflow === "CONTENT_DECAY") candidates = (output["seo.contentDecay"] || []).map((row) => ({ page: row.url || row.page || "", query: row.title || row.query || "", evidence: [{ metric: "observed_change", value: row.reason || row.detail || "calo rilevato" }], interpretation: "Il dato storico o tecnico indica un contenuto da riesaminare.", recommendation: "Revisiona accuratezza, copertura e data di aggiornamento conservando URL e segnali validi.", sources: [row.source || "Search Console / audit"], confidence: 76, scoring: { impact: 72, effort: 50, confidence: 76, risk: 18 } }));
  if (workflow === "INTERNAL_LINKING") candidates = (output["seo.internalLinks"] || []).map((row) => ({ page: row.targetUrl || row.target || "", query: row.anchor || "", evidence: [{ metric: "source_page", value: row.sourceUrl || row.source }, { metric: "target_page", value: row.targetUrl || row.target }], interpretation: row.reason || "Il crawl ha individuato una relazione interna utile.", recommendation: `Prepara un link contestuale${row.anchor ? ` con anchor “${row.anchor}”` : ""}.`, sources: ["Audit link interni"], confidence: 80, scoring: { impact: 68, effort: 25, confidence: 80, risk: 10 } }));
  return candidates.map((item) => evidenceRecommendation({ ...item, observationIds: observations.filter((entry) => entry.status === "COMPLETED").map((entry) => entry.id) })).filter(Boolean).sort((a, b) => b.priorityScore - a.priorityScore).filter((item, index, all) => all.findIndex((other) => other.fingerprint === item.fingerprint) === index).slice(0, maxResults);
}

export class SeoAgentOrchestrator {
  constructor({ registry, planner = new SeoAgentPlanner(), assessor = () => ({ decision: AgentDecision.CONTINUE }), onUpdate = () => {}, sleep = (ms, signal) => new Promise((resolve, reject) => { const timer = setTimeout(resolve, ms); signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new AgentError("CANCELLED", "Run interrotto.")); }, { once: true }); }) }) { this.registry = registry; this.planner = planner; this.assessor = assessor; this.onUpdate = onUpdate; this.sleep = sleep; this.active = new Map(); this.usedApprovalTokens = new Set(); }
  cancel(runId) { const active = this.active.get(runId); if (active) active.controller.abort(new AgentError("CANCELLED", "Run interrotto dall’utente.")); }
  transient(error) { return ["TOOL_TIMEOUT", "RATE_LIMIT", "HTTP_429", "HTTP_502", "HTTP_503", "HTTP_504", "NETWORK_ERROR"].includes(error.code); }
  async run(goal, input = {}) {
    const run = { id: identifier("agent-run"), projectId: input.projectId, goal: String(goal || "").trim(), mode: input.mode || AgentMode.ASSISTED, status: AgentStatus.PLANNING, decision: AgentDecision.CONTINUE, observations: [], recommendations: [], approvalHistory: [], errors: [], startedAt: new Date().toISOString() };
    const budget = new AgentBudget(input.budget), policy = new AgentPolicy(run.mode), controller = new AbortController(), started = Date.now(), planFingerprints = new Set(); this.active.set(run.id, { controller }); this.onUpdate(clone(run));
    try {
      run.plan = this.planner.plan(run.goal); run.status = AgentStatus.RUNNING; this.onUpdate(clone(run)); let cursor = 0;
      while (cursor < run.plan.steps.length) {
        budget.consume("iteration"); budget.consume("step");
        if (controller.signal.aborted) throw controller.signal.reason;
        if (Date.now() - started > budget.limits.maxDurationMs) { run.status = AgentStatus.PARTIAL; run.errors.push("Tempo massimo raggiunto."); break; }
        const step = run.plan.steps[cursor]; const tool = this.registry.tools.get(step.tool); let attempts = 0; step.status = "RUNNING";
        while (true) {
          try { const result = await this.registry.execute(step.tool, step.input, { runId: run.id, projectId: run.projectId, dataVersion: input.dataVersion, budget, policy, input, observations: run.observations, signal: controller.signal }); const usable = hasUsableEvidence(tool, result.data, { projectId: run.projectId }); step.status = result.cached ? "CACHED" : usable ? "COMPLETED" : "EMPTY"; run.observations.push({ id: identifier("observation"), tool: step.tool, status: step.status, usable, result }); break; }
          catch (error) {
            if (error.code === "APPROVAL_REQUIRED") { step.status = "WAITING_APPROVAL"; run.status = AgentStatus.WAITING_APPROVAL; run.pendingApproval = { id: identifier("approval"), token: identifier("token"), tool: step.tool, stepIndex: cursor, risk: tool?.risk, estimatedCost: tool?.estimatedCost || 0, preview: tool?.preview ? await tool.preview(step.input, { input }) : { input: step.input }, requestedAt: new Date().toISOString() }; break; }
            if (tool?.idempotent && this.transient(error) && attempts < budget.limits.maxRetries) { budget.consume("retry"); attempts += 1; const retryAfter = Number(error.retryAfterMs || 0); await this.sleep(retryAfter || Math.min(2_000, 100 * 2 ** attempts + Math.floor(Math.random() * 50)), controller.signal); continue; }
            step.status = error.code === "CANCELLED" ? "CANCELLED" : "FAILED"; run.errors.push(error.message); run.observations.push({ id: identifier("observation"), tool: step.tool, status: step.status, error: error.message }); if (error.code === "BUDGET_EXCEEDED") run.status = AgentStatus.PARTIAL; if (error.code === "CANCELLED") run.status = AgentStatus.CANCELLED; break;
          }
        }
        this.onUpdate(clone(run)); if ([AgentStatus.PARTIAL, AgentStatus.CANCELLED, AgentStatus.WAITING_APPROVAL].includes(run.status)) break;
        budget.consume("assessment"); const assessment = this.assessor(clone(run), clone(step));
        if (assessment.decision === AgentDecision.REPLAN) { budget.consume("replan"); const nextPlan = this.planner.replan(run.plan, assessment.steps || []); const planFingerprint = stable(nextPlan.steps.map(({ tool: name, input: data }) => [name, data])); if (planFingerprints.has(planFingerprint)) { run.status = AgentStatus.BLOCKED; run.decision = AgentDecision.BLOCKED; run.errors.push("Ciclo di ripianificazione rilevato e interrotto."); break; } planFingerprints.add(planFingerprint); run.plan = nextPlan; run.decision = AgentDecision.REPLAN; cursor = 0; continue; }
        if (assessment.decision === AgentDecision.BLOCKED) { run.status = AgentStatus.BLOCKED; run.decision = AgentDecision.BLOCKED; break; }
        if (assessment.decision === AgentDecision.COMPLETE) break; cursor += 1;
      }
      if (run.status === AgentStatus.RUNNING) { run.recommendations = recommendationsFor(run.plan.workflow, run.observations, run.plan.parameters?.maxResults || 10); const hasEvidence = run.observations.some((item) => item.usable); if (!hasEvidence) { run.status = AgentStatus.BLOCKED; run.decision = AgentDecision.BLOCKED; run.errors.push("Dati reali insufficienti per questo workflow."); } else if (!run.recommendations.length) { run.status = AgentStatus.PARTIAL; run.decision = AgentDecision.COMPLETE; run.errors.push("I dati disponibili non supportano raccomandazioni sufficientemente solide."); } else { run.status = AgentStatus.COMPLETED; run.decision = AgentDecision.COMPLETE; } }
    } catch (error) { run.status = error.code === "CANCELLED" ? AgentStatus.CANCELLED : error.code === "BUDGET_EXCEEDED" ? AgentStatus.PARTIAL : AgentStatus.FAILED; run.decision = AgentDecision.BLOCKED; run.errors.push(error.message); }
    run.budget = clone(budget); if (run.status !== AgentStatus.WAITING_APPROVAL) { run.completedAt = new Date().toISOString(); this.active.delete(run.id); this.registry.cleanupRun(run.id); } this.onUpdate(clone(run)); return clone(run);
  }
  async resolveApproval(savedRun, input, { approved, token, operator = "utente" }) {
    const run = clone(savedRun), request = run.pendingApproval;
    if (run.status !== AgentStatus.WAITING_APPROVAL || !request) throw new AgentError("APPROVAL_INVALID", "Il run non attende un’approvazione.");
    if (!token || token !== request.token || this.usedApprovalTokens.has(token)) throw new AgentError("APPROVAL_INVALID", "Token di approvazione non valido o già utilizzato.");
    this.usedApprovalTokens.add(token); run.approvalHistory = Array.isArray(run.approvalHistory) ? run.approvalHistory : [];
    run.approvalHistory.push({ approvalId: request.id, projectId: run.projectId, tool: request.tool, operator, decision: approved ? "APPROVED" : "REJECTED", decidedAt: new Date().toISOString() }); delete run.pendingApproval;
    if (!approved) { run.status = AgentStatus.BLOCKED; run.decision = AgentDecision.BLOCKED; run.completedAt = new Date().toISOString(); run.errors.push("Azione rifiutata dall’utente."); this.registry.cleanupRun(run.id); this.active.delete(run.id); this.onUpdate(clone(run)); return run; }
    const step = run.plan.steps[request.stepIndex], budget = new AgentBudget(run.budget?.limits), policy = new AgentPolicy(run.mode), controller = new AbortController(); this.active.set(run.id, { controller }); run.status = AgentStatus.RUNNING; step.status = "RUNNING"; this.onUpdate(clone(run));
    try { budget.used = { ...budget.used, ...(run.budget?.used || {}) }; budget.consume("iteration"); budget.consume("step"); const result = await this.registry.execute(step.tool, step.input, { runId: run.id, projectId: run.projectId, dataVersion: input.dataVersion, budget, policy, input, observations: run.observations, signal: controller.signal, approvalGranted: true }); step.status = "COMPLETED"; run.observations.push({ id: identifier("observation"), tool: step.tool, status: "COMPLETED", usable: hasUsableEvidence(this.registry.tools.get(step.tool), result.data, { projectId: run.projectId }), result }); run.status = AgentStatus.COMPLETED; run.decision = AgentDecision.COMPLETE; }
    catch (error) { run.status = error.code === "CANCELLED" ? AgentStatus.CANCELLED : AgentStatus.FAILED; run.errors.push(error.message); }
    run.budget = clone(budget); run.completedAt = new Date().toISOString(); this.registry.cleanupRun(run.id); this.active.delete(run.id); this.onUpdate(clone(run)); return clone(run);
  }
}

const readTool = (name, description, execute) => ({ name, description, inputSchema: { type: "object" }, outputSchema: {}, source: "LOCAL_DATA", cost: "NONE", freshnessMs: 0, risk: "LOW", permission: "READ", mutatesData: false, timeoutMs: 2_000, idempotent: true, supportsAbort: true, execute });
const observed = (context, tool) => context.observations.findLast((item) => item.tool === tool && item.status !== "FAILED")?.result?.data;
export function createSeoGrowToolRegistry() {
  return new ToolRegistry()
    .register(readTool("data.gsc", "Legge il dataset Search Console già disponibile.", (_input, context) => context.input.dataset || null))
    .register(readTool("data.analysis", "Legge l’ultimo audit già disponibile.", (_input, context) => context.input.analysis || null))
    .register(readTool("data.rankings", "Legge lo storico posizionamenti DataForSEO già salvato.", (_input, context) => context.input.rankings || []))
    .register(readTool("seo.opportunities", "Riutilizza il motore opportunità della 1.4.2.", (_input, context) => opportunityGroups(observed(context, "data.gsc")).quickWins))
    .register(readTool("seo.trafficDrop", "Riutilizza il confronto storico Search Console.", (_input, context) => (observed(context, "data.gsc")?.changes || []).filter((row) => row.clickDelta < 0 || row.positionDelta > 2).slice(0, 50)))
    .register(readTool("seo.contentDecay", "Combina cali Search Console e contenuti tecnici da aggiornare.", (_input, context) => [...(observed(context, "data.gsc")?.changes || []).filter((row) => row.clickDelta < 0), ...contentPlan(observed(context, "data.gsc"), observed(context, "data.analysis")).filter((row) => row.type === "Aggiornamento")].slice(0, 50)))
    .register(readTool("seo.internalLinks", "Riutilizza i suggerimenti di linking dell’audit.", (_input, context) => observed(context, "data.analysis")?.internalLinkSuggestions || []));
}
