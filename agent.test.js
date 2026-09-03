const test = require('node:test');
const assert = require('node:assert/strict');
const Agent = require('./agent.js');

function tool(name, execute, overrides = {}) {
  return {name, description: name, inputSchema: {}, outputSchema: {}, source: 'DB', cost: 'LOW', freshness: 0, risk: 'LOW', permission: 'READ', mutatesData: false, timeout: 100, execute, ...overrides};
}

test('planning selects all required workflows and tools', () => {
  const planner = new Agent.Planner();
  assert.equal(planner.plan('Trova opportunità SEO').workflow, 'TOP_OPPORTUNITIES');
  assert.equal(planner.plan('Perché il traffico è diminuito?').workflow, 'TRAFFIC_DROP');
  assert.equal(planner.plan('Pagine da portare in Top 10').workflow, 'TOP_10_PUSH');
  assert.equal(planner.plan('Contenuti da aggiornare').workflow, 'CONTENT_DECAY');
  assert.equal(planner.plan('Migliora internal linking').workflow, 'INTERNAL_LINKING');
  assert.deepEqual(planner.plan('Trova opportunità SEO').steps.map(x => x.tool), ['datasets.gsc', 'datasets.pages', 'findings.current']);
});

test('tool registry prevents equivalent duplicate calls', async () => {
  let calls = 0; const registry = new Agent.ToolRegistry().register(tool('read', () => { calls++; return [1]; }, {freshness: 1000}));
  const context = {runId: 'r', projectId: 'p', dataVersion: 'v1', budget: new Agent.AgentBudget(), policy: new Agent.PolicyGuard()};
  await registry.execute('read', {b: 2, a: 1}, context); const second = await registry.execute('read', {a: 1, b: 2}, context);
  assert.equal(calls, 1); assert.equal(second.reused, true);
});

test('cache is invalidated when project data version changes', async () => {
  let calls = 0; const registry = new Agent.ToolRegistry().register(tool('read', () => { calls++; return []; }, {freshness: 60000})); const base = {projectId: 'p', budget: new Agent.AgentBudget(), policy: new Agent.PolicyGuard()};
  await registry.execute('read', {}, {...base, runId: 'a', dataVersion: 'v1'}); await registry.execute('read', {}, {...base, runId: 'b', dataVersion: 'v2'}); assert.equal(calls, 2);
});

test('execution loop retries a transient tool error', async () => {
  let calls = 0; const registry = new Agent.ToolRegistry().register(tool('datasets.gsc', () => { calls++; if (calls === 1) throw new Error('transient'); return [{query: 'x', url: 'https://e.test/x', impressions: 100, position: 8}]; }));
  const planner = {plan: () => ({workflow: 'TOP_OPPORTUNITIES', version: 1, steps: [{id: 's', tool: 'datasets.gsc', args: {}, status: 'PENDING'}]}), replan: () => {}};
  const run = await new Agent.SEOAgentOrchestrator({registry, planner}).run('goal', {projectId: 'p', state: {datasets: [], findings: []}, budget: {maxRetries: 1}});
  assert.equal(calls, 2); assert.equal(run.status, Agent.RUN_STATES.COMPLETED); assert.equal(run.budget.used.retries, 1);
});

test('replanning replaces remaining steps and continues', async () => {
  const called = []; const registry = new Agent.ToolRegistry().register(tool('one', () => { called.push('one'); return [1]; })).register(tool('two', () => { called.push('two'); return [2]; }));
  const planner = {plan: () => ({workflow: 'TOP_OPPORTUNITIES', version: 1, steps: [{id: '1', tool: 'one', args: {}, status: 'PENDING'}]}), replan: (plan, steps) => ({...plan, version: 2, steps: steps.map((x, i) => ({id: String(i), args: {}, status: 'PENDING', ...x}))})};
  let assessed = false; const assess = () => { if (!assessed) { assessed = true; return {decision: Agent.DECISIONS.REPLAN, steps: [{tool: 'two'}]}; } return {decision: Agent.DECISIONS.COMPLETE}; };
  await new Agent.SEOAgentOrchestrator({registry, planner, assess}).run('goal', {projectId: 'p', state: {datasets: [], findings: []}}); assert.deepEqual(called, ['one', 'two']);
});

test('max step returns a partial result instead of running forever', async () => {
  const registry = new Agent.ToolRegistry().register(tool('one', () => [1])).register(tool('two', () => [2])); const planner = {plan: () => ({workflow: 'TOP_OPPORTUNITIES', steps: [{tool: 'one', args: {}}, {tool: 'two', args: {}}]}), replan: () => {}};
  const run = await new Agent.SEOAgentOrchestrator({registry, planner}).run('goal', {projectId: 'p', state: {datasets: [], findings: []}, budget: {maxSteps: 1}}); assert.equal(run.status, Agent.RUN_STATES.PARTIAL); assert.match(run.errors.join(' '), /BUDGET_EXCEEDED/);
});

test('permission modes enforce writes and high-risk approval', () => {
  const write = {mutatesData: true, risk: 'LOW', category: 'content'}, high = {mutatesData: true, risk: 'HIGH', category: 'canonical'};
  assert.equal(new Agent.PolicyGuard(Agent.MODES.READ_ONLY).check(write).allowed, false); assert.equal(new Agent.PolicyGuard(Agent.MODES.ASSISTED).check(write).approvalRequired, true); assert.equal(new Agent.PolicyGuard(Agent.MODES.AUTONOMOUS).check(write).allowed, true); assert.equal(new Agent.PolicyGuard(Agent.MODES.AUTONOMOUS).check(high).approvalRequired, true);
});

test('tool timeout is handled as partial/error observation', async () => {
  const registry = new Agent.ToolRegistry().register(tool('slow', () => new Promise(resolve => setTimeout(() => resolve([]), 50)), {timeout: 5})); const planner = {plan: () => ({workflow: 'TOP_OPPORTUNITIES', steps: [{tool: 'slow', args: {}}]}), replan: () => {}};
  const run = await new Agent.SEOAgentOrchestrator({registry, planner}).run('goal', {projectId: 'p', state: {datasets: [], findings: []}, budget: {maxRetries: 0}}); assert.equal(run.observations[0].status, 'FAILED'); assert.notEqual(run.status, Agent.RUN_STATES.COMPLETED);
});

test('missing real data produces explicit blocked partial recovery state', async () => {
  const run = await new Agent.SEOAgentOrchestrator({registry: Agent.registerExistingTools(new Agent.ToolRegistry())}).run('Trova opportunità SEO', {projectId: 'p', state: {datasets: [], findings: []}}); assert.equal(run.status, Agent.RUN_STATES.BLOCKED); assert.ok(run.observations.length); assert.match(run.errors.join(' '), /insufficienti/);
});

test('basic workflow creates sourced recommendations from existing data contracts', async () => {
  const state = {datasets: [{id: 'g', projectId: 'p', type: 'search-console-query-page', importedAt: '2026-09-01', data: [{data: {Query: 'seo agent', Pagina: 'https://e.test/seo'}, metrics: {clicks: 8, impressions: 800, ctr: null, position: 11.2}}]}, {id: 'p1', projectId: 'p', type: 'pages-onpage', importedAt: '2026-09-01', data: [{url: 'https://e.test/seo', title: 'SEO Agent'}]}], findings: []};
  const run = await new Agent.SEOAgentOrchestrator({registry: Agent.registerExistingTools(new Agent.ToolRegistry())}).run('Trova opportunità SEO', {projectId: 'p', state}); assert.equal(run.status, Agent.RUN_STATES.COMPLETED); assert.equal(run.recommendations.length, 1); assert.ok(run.recommendations[0].sources.includes('GSC')); assert.ok(run.recommendations[0].observedData.length);
});
