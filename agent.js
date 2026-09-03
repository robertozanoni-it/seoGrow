(function (root, factory) {
  var api = factory(root || globalThis);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SeoGrowAgent = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  var DECISIONS = Object.freeze({CONTINUE: 'CONTINUE', REPLAN: 'REPLAN', COMPLETE: 'COMPLETE', BLOCKED: 'BLOCKED'});
  var RUN_STATES = Object.freeze({PLANNING: 'PLANNING', RUNNING: 'RUNNING', COMPLETED: 'COMPLETED', PARTIAL: 'PARTIAL', BLOCKED: 'BLOCKED', FAILED: 'FAILED', CANCELLED: 'CANCELLED'});
  var MODES = Object.freeze({READ_ONLY: 'READ_ONLY', ASSISTED: 'ASSISTED', AUTONOMOUS: 'AUTONOMOUS'});
  var HIGH_RISK = Object.freeze(['url', 'slug', 'canonical', 'redirect', 'robots', 'noindex', 'sitemap', 'permalink', 'critical_schema', 'global_wordpress_configuration', 'page_deletion']);

  function now() { return new Date().toISOString(); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function uid(prefix) { return prefix + '_' + (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : Date.now() + '_' + Math.random().toString(36).slice(2)); }
  function stable(value) {
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(function (key) { return JSON.stringify(key) + ':' + stable(value[key]); }).join(',') + '}';
    return JSON.stringify(value);
  }
  function numeric(value) { if (value === null || typeof value === 'undefined' || String(value).trim() === '') return null; var result = Number(value); return Number.isFinite(result) ? result : null; }
  function fingerprint(tool, args, projectId, version) { return [tool, projectId || '', version || '', stable(args || {})].join('|').toLowerCase(); }
  function latestDataset(state, projectId, matcher) {
    return (state.datasets || []).filter(function (dataset) { return dataset.projectId === projectId && matcher(dataset.type); }).sort(function (a, b) { return String(b.importedAt || '').localeCompare(String(a.importedAt || '')); })[0] || null;
  }
  function datasetRows(state, projectId, matcher) { var dataset = latestDataset(state, projectId, matcher); return dataset && Array.isArray(dataset.data) ? dataset.data : []; }

  function AgentBudget(options) {
    this.limits = Object.assign({maxSteps: 12, maxRetries: 1, maxDuration: 30000, maxDataForSEOCalls: 0, maxUrls: 250, maxCost: 0}, options || {});
    this.used = {steps: 0, retries: 0, dataForSEOCalls: 0, urls: 0, cost: 0};
  }
  AgentBudget.prototype.consume = function (kind, amount) {
    amount = Number(amount || 1);
    var limits = {step: 'maxSteps', retry: 'maxRetries', dataForSEOCall: 'maxDataForSEOCalls', url: 'maxUrls', cost: 'maxCost'};
    var used = {step: 'steps', retry: 'retries', dataForSEOCall: 'dataForSEOCalls', url: 'urls', cost: 'cost'};
    if (typeof this.limits[limits[kind]] !== 'number' || this.used[used[kind]] + amount > this.limits[limits[kind]]) { var error = new Error('BUDGET_EXCEEDED:' + kind); error.code = 'BUDGET_EXCEEDED'; throw error; }
    this.used[used[kind]] += amount;
  };

  function PolicyGuard(mode) { this.mode = mode || MODES.ASSISTED; }
  PolicyGuard.prototype.check = function (tool) {
    if (!tool.mutatesData) return {allowed: true, approvalRequired: false};
    var high = tool.risk === 'HIGH' || HIGH_RISK.indexOf(tool.category) >= 0;
    if (this.mode === MODES.READ_ONLY) return {allowed: false, approvalRequired: false, reason: 'READ_ONLY vieta modifiche.'};
    if (high || this.mode === MODES.ASSISTED) return {allowed: false, approvalRequired: true, reason: 'Approvazione esplicita richiesta.'};
    return {allowed: true, approvalRequired: false};
  };

  function ToolRegistry(options) { this.tools = new Map(); this.cache = new Map(); this.runCalls = new Map(); this.clock = options && options.clock || Date.now; }
  ToolRegistry.prototype.register = function (tool) {
    ['name', 'description', 'inputSchema', 'outputSchema', 'source', 'cost', 'freshness', 'risk', 'permission', 'mutatesData', 'timeout', 'execute'].forEach(function (field) { if (typeof tool[field] === 'undefined') throw new Error('Tool non valido: manca ' + field); });
    if (this.tools.has(tool.name)) throw new Error('Tool duplicato: ' + tool.name);
    this.tools.set(tool.name, Object.freeze(Object.assign({}, tool))); return this;
  };
  ToolRegistry.prototype.list = function () { return Array.from(this.tools.values()).map(function (tool) { var item = Object.assign({}, tool); delete item.execute; return item; }); };
  ToolRegistry.prototype.execute = async function (name, args, context) {
    context = context || {}; var tool = this.tools.get(name); if (!tool) throw new Error('Tool sconosciuto: ' + name);
    var permission = (context.policy || new PolicyGuard()).check(tool);
    if (!permission.allowed) { var denied = new Error(permission.reason); denied.code = permission.approvalRequired ? 'APPROVAL_REQUIRED' : 'PERMISSION_DENIED'; throw denied; }
    var fp = fingerprint(name, args, context.projectId, context.dataVersion), calls = this.runCalls.get(context.runId) || new Map(); this.runCalls.set(context.runId, calls);
    if (calls.has(fp)) return Object.assign({reused: true}, clone(calls.get(fp)));
    var cached = this.cache.get(fp);
    if (cached && tool.freshness > 0 && this.clock() - cached.at <= tool.freshness) { calls.set(fp, cached.result); return Object.assign({cached: true, reused: true}, clone(cached.result)); }
    context.budget.consume('step'); if (tool.source === 'DATAFORSEO') context.budget.consume('dataForSEOCall');
    var timer, started = this.clock();
    var timeout = new Promise(function (_, reject) { timer = setTimeout(function () { var error = new Error('Timeout: ' + name); error.code = 'TOOL_TIMEOUT'; reject(error); }, tool.timeout); });
    var data;
    try { data = await Promise.race([Promise.resolve(tool.execute(args || {}, context)), timeout]); } finally { clearTimeout(timer); }
    var result = {data: data, source: tool.source, duration: this.clock() - started, observedAt: now(), fingerprint: fp};
    calls.set(fp, result); this.cache.set(fp, {at: this.clock(), result: result}); return clone(result);
  };

  function Planner() {}
  Planner.prototype.workflow = function (goal) {
    var text = String(goal || '').toLowerCase();
    if (/calo|diminuit|traffic drop/.test(text)) return 'TRAFFIC_DROP';
    if (/top\s*10|prima pagina/.test(text)) return 'TOP_10_PUSH';
    if (/decay|aggiornar|contenut/.test(text)) return 'CONTENT_DECAY';
    if (/internal|link intern/.test(text)) return 'INTERNAL_LINKING';
    return 'TOP_OPPORTUNITIES';
  };
  Planner.prototype.plan = function (goal) {
    if (!String(goal || '').trim()) throw new Error('Inserisci un obiettivo SEO.');
    var workflow = this.workflow(goal), tools = {
      TOP_OPPORTUNITIES: ['datasets.gsc', 'datasets.pages', 'findings.current'],
      TRAFFIC_DROP: ['datasets.gsc', 'datasets.pages'], TOP_10_PUSH: ['datasets.gsc', 'datasets.pages', 'datasets.internalLinks'],
      CONTENT_DECAY: ['datasets.gsc', 'datasets.pages'], INTERNAL_LINKING: ['datasets.internalLinks', 'datasets.pages', 'datasets.gsc']
    }[workflow];
    return {id: uid('plan'), goal: String(goal).trim(), workflow: workflow, version: 1, editable: true, steps: tools.map(function (tool) { return {id: uid('step'), tool: tool, args: {}, status: 'PENDING'}; })};
  };
  Planner.prototype.replan = function (plan, replacementSteps) { var next = clone(plan); next.version += 1; next.steps = (replacementSteps || []).map(function (step) { return Object.assign({id: uid('step'), args: {}, status: 'PENDING'}, step); }); next.replannedAt = now(); return next; };

  function PriorityEngine() {}
  PriorityEngine.prototype.rank = function (values) {
    values = values || {}; var impact = numeric(values.impact); var effort = numeric(values.effort); var confidence = numeric(values.confidence); var commercial = numeric(values.commercialValue); var risk = numeric(values.risk);
    impact = impact === null ? 50 : impact; effort = effort === null ? 50 : effort; confidence = confidence === null ? 50 : confidence; commercial = commercial === null ? 50 : commercial; risk = risk === null ? 20 : risk;
    var score = Math.round(Math.max(0, Math.min(100, impact * .3 + (100 - effort) * .2 + confidence * .25 + commercial * .2 - risk * .05)));
    return {score: score, category: score >= 72 && effort <= 55 ? 'Quick Win' : score >= 65 ? 'Strategic' : score >= 42 ? 'Maintenance' : 'Low Priority'};
  };

  function normalizeGsc(rows) {
    return (rows || []).map(function (row) {
      var data = row && row.data || row || {}, metrics = row && row.metrics || row || {};
      function pick(object, names) { var key = Object.keys(object).find(function (candidate) { return names.indexOf(String(candidate).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()) >= 0; }); return key ? object[key] : null; }
      return {query: String(pick(data, ['query', 'query principale']) || '').trim(), url: String(pick(data, ['url', 'page', 'pagina', 'pagine', 'pagine principali', 'top pages']) || '').trim(), clicks: numeric(metrics.clicks != null ? metrics.clicks : pick(data, ['clicks', 'clic'])), impressions: numeric(metrics.impressions != null ? metrics.impressions : pick(data, ['impressions', 'impressioni'])), position: numeric(metrics.position != null ? metrics.position : pick(data, ['position', 'posizione'])), ctr: numeric(metrics.ctr != null ? metrics.ctr : pick(data, ['ctr'])), date: pick(data, ['date', 'data'])};
    }).filter(function (row) { return row.query || row.url; });
  }
  function recommendation(candidate, priority) {
    if (!candidate.observedData || !candidate.observedData.length || !candidate.sources || !candidate.sources.length) return null;
    var ranked = priority.rank(candidate.scoring); return Object.assign({id: uid('rec'), fingerprint: stable([candidate.page || '', candidate.query || '', candidate.recommendation]), priority: ranked.category, priorityScore: ranked.score, createdAt: now()}, candidate);
  }
  function analyze(workflow, observations, priority) {
    var found = {}; observations.forEach(function (observation) { found[observation.tool] = observation.result && observation.result.data || []; });
    var gsc = normalizeGsc(found['datasets.gsc']), pages = found['datasets.pages'] || [], links = found['datasets.internalLinks'] || [], pageMap = new Map(pages.map(function (page) { return [String(page.url || ''), page]; })), candidates = [];
    if (workflow === 'TRAFFIC_DROP' || workflow === 'CONTENT_DECAY') {
      var dated = gsc.filter(function (row) { return row.date; }).sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); }); var middle = Math.floor(dated.length / 2);
      if (middle) { var sum = function (list) { return list.reduce(function (total, row) { return total + (row.clicks || 0); }, 0); }, before = sum(dated.slice(0, middle)), after = sum(dated.slice(middle)); if (before > after) candidates.push({observedData: [{metric: 'clicks_previous_window', value: before}, {metric: 'clicks_current_window', value: after}], interpretation: 'I clic osservati nel periodo recente sono inferiori al periodo precedente.', recommendation: workflow === 'CONTENT_DECAY' ? 'Rivedi prima pagine e query con la perdita maggiore.' : 'Segmenta la perdita per pagina e query prima di intervenire.', sources: ['GSC'], confidence: 80, scoring: {impact: 80, effort: 45, confidence: 80, risk: 15}}); }
    } else if (workflow === 'INTERNAL_LINKING') {
      var targets = new Set(links.map(function (link) { return String(link.target || ''); })); gsc.filter(function (row) { return row.url && (row.impressions || 0) >= 10 && !targets.has(row.url); }).forEach(function (row) { candidates.push({page: row.url, query: row.query, observedData: [{metric: 'impressions', value: row.impressions}, {metric: 'internal_links_observed', value: 0}], interpretation: 'La pagina ha visibilità ma non compare come destinazione nel grafo importato.', recommendation: 'Prepara un link interno contestuale da una pagina pertinente.', sources: ['GSC', 'INTERNAL_LINK_DATASET'], confidence: 72, scoring: {impact: 70, effort: 25, confidence: 72, risk: 10}}); });
    } else {
      gsc.forEach(function (row) { var eligible = workflow === 'TOP_10_PUSH' ? row.position > 10 && row.position <= 20 : row.position >= 4 && row.position <= 30; if (!row.impressions || row.position === null || !eligible) return; var page = pageMap.get(row.url); candidates.push({page: row.url || null, query: row.query || null, observedData: [{metric: 'impressions', value: row.impressions}, {metric: 'clicks', value: row.clicks}, {metric: 'position', value: row.position}, {metric: 'ctr', value: row.ctr}], interpretation: 'La query ha visibilità misurata ed è abbastanza vicina alla prima pagina per una verifica mirata.', recommendation: row.position > 10 ? 'Rafforza pertinenza on-page e link interni.' : 'Migliora snippet e copertura dell’intento.', sources: ['GSC'].concat(page ? ['PAGE_DATASET'] : []), confidence: page ? 86 : 74, scoring: {impact: Math.min(100, 45 + Math.log10(row.impressions + 1) * 14), effort: page ? 40 : 55, confidence: page ? 86 : 74, commercialValue: 55, risk: 12}}); });
    }
    return candidates.map(function (item) { return recommendation(item, priority); }).filter(Boolean).sort(function (a, b) { return b.priorityScore - a.priorityScore; }).filter(function (item, index, all) { return all.findIndex(function (other) { return other.fingerprint === item.fingerprint; }) === index; }).slice(0, 10);
  }

  function SEOAgentOrchestrator(options) { options = options || {}; this.registry = options.registry; this.planner = options.planner || new Planner(); this.priority = options.priority || new PriorityEngine(); this.assess = options.assess || function () { return {decision: DECISIONS.CONTINUE}; }; this.persist = options.persist || function () {}; this.active = new Map(); }
  SEOAgentOrchestrator.prototype.cancel = function (runId) { if (this.active.has(runId)) this.active.get(runId).cancelled = true; };
  SEOAgentOrchestrator.prototype.run = async function (goal, context) {
    context = context || {}; var run = {id: uid('run'), projectId: context.projectId, goal: String(goal || '').trim(), autonomy: context.autonomy || MODES.ASSISTED, status: RUN_STATES.PLANNING, decision: DECISIONS.CONTINUE, observations: [], recommendations: [], errors: [], startedAt: now()};
    var budget = new AgentBudget(context.budget), policy = new PolicyGuard(run.autonomy), token = {cancelled: false}, started = Date.now(), cursor = 0; this.active.set(run.id, token); this.persist(run);
    try {
      run.plan = this.planner.plan(run.goal); run.status = RUN_STATES.RUNNING; this.persist(run);
      while (cursor < run.plan.steps.length) {
        if (token.cancelled) { run.status = RUN_STATES.CANCELLED; break; }
        if (Date.now() - started > budget.limits.maxDuration) { run.status = RUN_STATES.PARTIAL; run.errors.push('Tempo massimo raggiunto.'); break; }
        var step = run.plan.steps[cursor], attempts = 0, complete = false;
        while (!complete) {
          try {
            var version = (context.state.datasets || []).filter(function (dataset) { return dataset.projectId === run.projectId; }).map(function (dataset) { return dataset.id + ':' + dataset.importedAt; }).sort().join('|');
            step.status = 'RUNNING'; var result = await this.registry.execute(step.tool, step.args, {runId: run.id, projectId: run.projectId, state: context.state, dataVersion: version, budget: budget, policy: policy});
            step.status = 'COMPLETED'; run.observations.push({id: uid('obs'), tool: step.tool, status: 'COMPLETED', result: result}); complete = true;
          } catch (error) {
            if (error.code !== 'BUDGET_EXCEEDED' && attempts < budget.limits.maxRetries) { budget.consume('retry'); attempts += 1; continue; }
            step.status = 'FAILED'; run.errors.push(error.message); run.observations.push({id: uid('obs'), tool: step.tool, status: 'FAILED', error: error.message}); complete = true;
            if (error.code === 'BUDGET_EXCEEDED') run.status = RUN_STATES.PARTIAL;
          }
        }
        this.persist(run); if (run.status === RUN_STATES.PARTIAL) break;
        var assessment = this.assess(run, step) || {decision: DECISIONS.CONTINUE};
        if (assessment.decision === DECISIONS.REPLAN) { run.plan = this.planner.replan(run.plan, assessment.steps || []); run.decision = DECISIONS.REPLAN; cursor = 0; continue; }
        if (assessment.decision === DECISIONS.BLOCKED) { run.status = RUN_STATES.BLOCKED; run.decision = DECISIONS.BLOCKED; break; }
        if (assessment.decision === DECISIONS.COMPLETE) break; cursor += 1;
      }
      if (run.status === RUN_STATES.RUNNING) { run.recommendations = analyze(run.plan.workflow, run.observations, this.priority); var hasData = run.observations.some(function (observation) { return observation.status === 'COMPLETED' && Array.isArray(observation.result.data) && observation.result.data.length; }); if (!hasData) { run.status = RUN_STATES.BLOCKED; run.decision = DECISIONS.BLOCKED; run.errors.push('Dati reali insufficienti.'); } else if (!run.recommendations.length) { run.status = RUN_STATES.PARTIAL; run.decision = DECISIONS.COMPLETE; run.errors.push('Nessuna raccomandazione sufficientemente supportata.'); } else { run.status = RUN_STATES.COMPLETED; run.decision = DECISIONS.COMPLETE; } }
    } catch (error) { run.status = RUN_STATES.FAILED; run.decision = DECISIONS.BLOCKED; run.errors.push(error.message); }
    run.budget = clone(budget); run.completedAt = now(); this.active.delete(run.id); this.persist(run); return clone(run);
  };

  function registerExistingTools(registry) {
    var inputSchema = {type: 'object'}, outputSchema = {type: 'array'};
    function read(name, description, matcher, source) { registry.register({name: name, description: description, inputSchema: inputSchema, outputSchema: outputSchema, source: source, cost: 'LOW', freshness: 900000, risk: 'LOW', permission: 'READ', mutatesData: false, timeout: 3000, execute: function (_, context) { return datasetRows(context.state, context.projectId, matcher); }}); }
    read('datasets.gsc', 'Legge il dataset Search Console più recente.', function (type) { return type === 'search-console' || /^search-console-(queries|query-page)$/.test(type); }, 'GSC');
    read('datasets.pages', 'Legge i dati on-page più recenti.', function (type) { return type === 'pages-onpage'; }, 'DATASET');
    read('datasets.internalLinks', 'Legge il grafo link importato.', function (type) { return type === 'internal-links'; }, 'CRAWL_DATASET');
    registry.register({name: 'findings.current', description: 'Legge i riscontri correnti.', inputSchema: inputSchema, outputSchema: outputSchema, source: 'DATABASE', cost: 'LOW', freshness: 0, risk: 'LOW', permission: 'READ', mutatesData: false, timeout: 1000, execute: function (_, context) { return (context.state.findings || []).filter(function (finding) { return finding.projectId === context.projectId; }); }}); return registry;
  }

  function install() {
    if (!root.document || !root.SeoGrowApp || !root.SeoGrowCore || !root.SeoGrowUI || root.SeoGrowAgentInstalled) return; root.SeoGrowAgentInstalled = true;
    root.SeoGrow.VERSION = '0.11.0'; root.SeoGrow.SCHEMA_VERSION = Math.max(5, Number(root.SeoGrow.SCHEMA_VERSION || 0)); root.document.title = 'seoGrow 0.11.0';
    var migrate = root.SeoGrowCore.migrate; root.SeoGrowCore.migrate = function (raw) { var state = migrate(raw || {}); state.agentRuns = Array.isArray(state.agentRuns) ? state.agentRuns : []; state.agentRecommendations = Array.isArray(state.agentRecommendations) ? state.agentRecommendations : []; state.settings.agent = Object.assign({autonomy: MODES.ASSISTED}, state.settings.agent || {}); state.schemaVersion = root.SeoGrow.SCHEMA_VERSION; state.appVersion = root.SeoGrow.VERSION; return state; };
    var dispatch = root.SeoGrowCore.Store.prototype.dispatch; root.SeoGrowCore.Store.prototype.dispatch = function (action) { if (action.type !== 'AGENT_RUN_UPSERTED') return dispatch.call(this, action); var state = clone(this.state), index = (state.agentRuns || []).findIndex(function (item) { return item.id === action.run.id; }); state.agentRuns = state.agentRuns || []; if (index < 0) state.agentRuns.push(clone(action.run)); else state.agentRuns[index] = clone(action.run); state.agentRecommendations = state.agentRecommendations || []; (action.run.recommendations || []).forEach(function (recommendation) { if (!state.agentRecommendations.some(function (item) { return item.projectId === action.run.projectId && item.fingerprint === recommendation.fingerprint; })) state.agentRecommendations.push(Object.assign({projectId: action.run.projectId, runId: action.run.id}, recommendation)); }); state.history.push({id: uid('history'), projectId: action.run.projectId, entityType: 'agent', entityId: action.run.id, action: action.type, timestamp: now(), metadata: {status: action.run.status}}); this.state = state; this.bus.emit('state:changed', {action: action, state: this.getState()}); return this.getState(); };
    var start = root.SeoGrowApp.prototype.start; root.SeoGrowApp.prototype.start = async function () { var result = await start.call(this), app = this; this.agent = new SEOAgentOrchestrator({registry: registerExistingTools(new ToolRegistry()), persist: function (run) { if (app.store) app.store.dispatch({type: 'AGENT_RUN_UPSERTED', run: run}); }}); root.seoGrowApp = this; return result; };
    var ui = root.SeoGrowUI.App.prototype, oldLayout = ui.layout, oldRender = ui.render, oldClick = ui.click;
    ui.layout = function (content) { return oldLayout.call(this, content).replace(/(<button class="nav [^"]*" data-view="dashboard">Dashboard<\/button>)/, '$1<button class="nav ' + (this.view === 'agent' ? 'active' : '') + '" data-view="agent">SEO Agent</button>'); };
    ui.agentView = function () { var state = this.state(), esc = root.SeoGrowUtils.escapeHTML, run = (state.agentRuns || []).filter(function (item) { return item.projectId === state.activeProjectId; }).sort(function (a, b) { return String(b.startedAt).localeCompare(String(a.startedAt)); })[0]; var quick = ['Trova opportunità SEO', 'Analizza calo traffico', 'Trova contenuti da aggiornare', 'Migliora internal linking', 'Trova pagine da portare in Top 10']; var results = run && run.recommendations && run.recommendations.length ? run.recommendations.map(function (item) { return '<article class="agent-rec"><div class="agent-head"><b>' + esc(item.query || item.page || 'Opportunità') + '</b><span class="status verified">' + esc(item.priority) + '</span></div><p><strong>Evidenza:</strong> ' + esc(item.observedData.map(function (evidence) { return evidence.metric + ': ' + (evidence.value == null ? 'non disponibile' : evidence.value); }).join(' · ')) + '</p><p><strong>Azione:</strong> ' + esc(item.recommendation) + '</p><small>Confidenza ' + esc(item.confidence) + '% · Fonti: ' + esc(item.sources.join(', ')) + '</small></article>'; }).join('') : run ? '<div class="empty">' + esc((run.errors || []).join(' ') || (run.status === RUN_STATES.PLANNING ? 'Preparazione del piano…' : 'Nessun risultato.')) + '</div>' : ''; return '<section class="hero"><h1>SEO Agent</h1><p>Definisci un obiettivo e ottieni raccomandazioni basate sui dati disponibili.</p><label for="agentGoal">Cosa vuoi ottenere?</label><textarea id="agentGoal" rows="3" placeholder="Trova le 10 migliori opportunità SEO"></textarea><div class="agent-quick">' + quick.map(function (label) { return '<button data-action="agent-quick" data-goal="' + esc(label) + '">' + esc(label) + '</button>'; }).join('') + '</div><button class="primary" data-action="agent-run">Avvia analisi</button></section>' + (run ? '<section class="card"><div class="agent-head"><h2>Ultima esecuzione</h2><span class="status ' + (run.status === RUN_STATES.COMPLETED ? 'verified' : 'candidate') + '">' + esc(run.status) + '</span></div><p><strong>Obiettivo:</strong> ' + esc(run.goal) + '</p><ol>' + ((run.plan && run.plan.steps) || []).map(function (step) { return '<li>' + (step.status === 'COMPLETED' ? '✓ ' : '○ ') + esc(step.tool) + '</li>'; }).join('') + '</ol></section><section class="agent-results"><h2>Raccomandazioni</h2>' + results + '</section>' : ''); };
    ui.render = function () { if (this.view !== 'agent') return oldRender.call(this); this.root.innerHTML = this.layout(this.agentView()); };
    ui.click = async function (event) { var element = event.target.closest('[data-action],[data-view]'); if (element && element.dataset.action === 'agent-quick') { root.document.getElementById('agentGoal').value = element.dataset.goal; return; } if (element && element.dataset.action === 'agent-run') { var goal = root.document.getElementById('agentGoal').value.trim(); if (!goal) return this.notify('Inserisci un obiettivo.', 'error'); var state = this.state(); await this.app.agent.run(goal, {projectId: state.activeProjectId, state: state, autonomy: MODES.ASSISTED}); this.view = 'agent'; this.render(); return; } return oldClick.call(this, event); };
    var style = root.document.createElement('style'); style.textContent = '#agentGoal{display:block;width:100%;max-width:760px;padding:12px;border:1px solid var(--line);border-radius:10px;margin:8px 0 12px;font:inherit}.agent-quick{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.agent-results{display:grid;gap:12px}.agent-results>h2{grid-column:1/-1}.agent-rec{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:18px}.agent-head{display:flex;justify-content:space-between;align-items:center;gap:12px}@media(min-width:980px){.agent-results{grid-template-columns:1fr 1fr}}'; root.document.head.appendChild(style);
  }
  install();
  return {DECISIONS: DECISIONS, RUN_STATES: RUN_STATES, MODES: MODES, AgentBudget: AgentBudget, PolicyGuard: PolicyGuard, ToolRegistry: ToolRegistry, Planner: Planner, PriorityEngine: PriorityEngine, SEOAgentOrchestrator: SEOAgentOrchestrator, registerExistingTools: registerExistingTools, analyze: analyze, fingerprint: fingerprint};
});
