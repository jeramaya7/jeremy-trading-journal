import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

function getDashboardStatsTemplate() {
  const startMarker = '<section class="stats-grid" aria-label="Trading performance summary">';
  const endMarker = '</section>';
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, 'Dashboard statistics section should render.');
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, 'Dashboard statistics section should close.');
  return source.slice(start, end);
}

test('dashboard focuses R statistics on Average R only', () => {
  const dashboardStats = getDashboardStatsTemplate();

  assert.equal(dashboardStats.includes("'Total R'"), false, 'Total R should not render as a dashboard card.');
  assert.ok(dashboardStats.includes("'Average R'"), 'Average R should still render as a dashboard card.');
});

test('R calculations remain available outside the dashboard summary', () => {
  assert.ok(source.includes('function calculateRMultiple(trade)'), 'Individual R calculation helper should remain.');
  assert.ok(source.includes('<span class="${rTone}">R: ${formatRMultiple(rMultiple)}</span>'), 'Trade cards should still show R values.');
  assert.ok(source.includes('const rMultiple = calculateRMultiple(trade);'), 'Setup Analytics should still reuse R calculations.');
  assert.ok(source.includes('${setupAnalyticsHeader(\'averageR\', \'Average R\')}'), 'Setup Analytics should still show Average R.');
});
