import test from 'node:test';
import assert from 'node:assert/strict';
import { addDatasetToHistory, contentPlan, queryTaskDetail } from './platform.js';

const row = { dimension: 'gnatologo bergamo', clicks: 12, impressions: 327, ctr: 3.67, position: 18.77 };

test('il piano editoriale contiene tempi, obiettivo e pagina query–URL confermata', () => {
  const plan = contentPlan({ queries: [row], pages: [], queryPages: [{ query: row.dimension, pages: ['https://example.it/gnatologo/'] }] });
  assert.equal(plan[0].url, 'https://example.it/gnatologo/');
  assert.equal(plan[0].association, 'Confermata da dati query–pagina');
  assert.match(plan[0].slot, /^Settimana /);
  assert.ok(plan[0].objective);
});

test('la task Search Console espone metriche, cautela e azioni', () => {
  const detail = queryTaskDetail(row, 'https://example.it/gnatologo-bergamo/', false);
  assert.match(detail, /327 impressioni/);
  assert.match(detail, /da verificare/);
  assert.match(detail, /AZIONI CONSIGLIATE/);
  assert.match(detail, /link interni/);
});

test('lo storico usa il periodo dei dati, non l’ordine di importazione', () => {
  const oldPeriod = { property: { host: 'example.it' }, dateFrom: '2026-01-01', dateTo: '2026-01-31', importedAt: '2026-09-03T12:00:00Z', totals: { clicks: 1, impressions: 10 } };
  const newPeriod = { property: { host: 'example.it' }, dateFrom: '2026-02-01', dateTo: '2026-02-28', importedAt: '2026-09-03T11:00:00Z', totals: { clicks: 2, impressions: 20 } };
  const history = addDatasetToHistory({ 1: [oldPeriod] }, 1, newPeriod);
  assert.equal(history[1][0].dateTo, '2026-02-28');
});
