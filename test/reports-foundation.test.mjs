import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

function assertIncludes(text, expected, message) {
  assert.ok(text.includes(expected), `${message}\nExpected to find: ${expected}`);
}

test('reports foundation calculates daily, weekly, and monthly P&L from existing trades', () => {
  assertIncludes(source, 'function calculatePnlForPeriod(tradeList, period, referenceDate = new Date())', 'Reports have a shared period calculator.');
  assertIncludes(source, 'pnl: report.pnl + calculatePnl(trade)', 'Reports reuse the existing calculatePnl helper for manual and cTrader trades.');
  assertIncludes(source, "{ label: 'Daily P&L', period: 'day', ...calculatePnlForPeriod(trades, 'day', referenceDate) }", 'Daily P&L is calculated.');
  assertIncludes(source, "{ label: 'Weekly P&L', period: 'week', ...calculatePnlForPeriod(trades, 'week', referenceDate) }", 'Weekly P&L is calculated.');
  assertIncludes(source, "{ label: 'Monthly P&L', period: 'month', ...calculatePnlForPeriod(trades, 'month', referenceDate) }", 'Monthly P&L is calculated.');
  assertIncludes(source, 'const dateValue = trade.closeTime || trade.date;', 'Imported cTrader close timestamps are supported without changing import data.');
});

test('P&L report cards render below the statistics section', () => {
  const statsIndex = source.indexOf('<section class="stats-grid" aria-label="Trading performance summary">');
  const reportsIndex = source.indexOf('<section class="reports-grid" aria-label="P&L reports">');
  const workspaceIndex = source.indexOf('<section class="workspace-grid">');

  assert.ok(statsIndex > -1, 'The current statistics section is still rendered.');
  assert.ok(reportsIndex > statsIndex, 'Report cards render below the current statistics section.');
  assert.ok(workspaceIndex > reportsIndex, 'Report cards render above the main trade workspace.');
  assertIncludes(source, '${pnlReports.map(reportCard).join(\'\')}', 'The report cards are rendered from the calculated P&L reports.');
});

test('report cards have production UI styling separate from trade entry and cTrader controls', () => {
  assertIncludes(styles, '.reports-grid', 'Report cards use a dedicated grid class.');
  assertIncludes(styles, '.report-card-header', 'Report cards have header styling.');
  assertIncludes(styles, '.report-card small', 'Report cards include supporting trade-count text styling.');
});
