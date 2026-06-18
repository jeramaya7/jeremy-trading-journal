import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

function assertIncludes(text, expected, message) {
  assert.ok(text.includes(expected), `${message}\nExpected to find: ${expected}`);
}

test('reports foundation calculates daily, weekly, monthly, and yearly P&L from existing trades', () => {
  assertIncludes(source, 'function calculatePnlForPeriod(tradeList, period, referenceDate = new Date())', 'Reports have a shared period calculator.');
  assertIncludes(source, 'pnl: report.pnl + calculatePnl(trade)', 'Reports reuse the existing calculatePnl helper for manual and cTrader trades.');
  assertIncludes(source, "{ label: 'Daily P&L', period: 'day', ...calculatePnlForPeriod(trades, 'day', referenceDate) }", 'Daily P&L is calculated.');
  assertIncludes(source, "{ label: 'Weekly P&L', period: 'week', ...calculatePnlForPeriod(trades, 'week', referenceDate) }", 'Weekly P&L is calculated.');
  assertIncludes(source, "{ label: 'Monthly P&L', period: 'month', ...calculatePnlForPeriod(trades, 'month', referenceDate) }", 'Monthly P&L is calculated.');
  assertIncludes(source, "{ label: 'Yearly P&L', period: 'year', ...calculatePnlForPeriod(trades, 'year', referenceDate) }", 'Yearly P&L is calculated.');
  assertIncludes(source, 'periodStart.setMonth(0, 1);', 'Yearly P&L starts from the first day of the current year.');
  assertIncludes(source, 'const dateValue = trade.closeTime || trade.date;', 'Imported cTrader close timestamps are supported without changing import data.');
});

test('P&L cards render inside the balanced dashboard grid', () => {
  const statsIndex = source.indexOf('<section class="dashboard-card-groups" aria-label="Trading performance summary">');
  const workspaceIndex = source.indexOf('<section class="workspace-grid">');

  assert.ok(statsIndex > -1, 'The current dashboard section is still rendered.');
  assert.ok(workspaceIndex > statsIndex, 'Dashboard cards render above the main trade workspace.');
  assertIncludes(source, "statCard('calendar', 'Daily P&L'", 'Daily P&L renders in the dashboard grid.');
  assertIncludes(source, "statCard('calendar', 'Weekly P&L'", 'Weekly P&L renders in the dashboard grid.');
  assertIncludes(source, "statCard('calendar', 'Monthly P&L'", 'Monthly P&L renders in the dashboard grid.');
  assertIncludes(source, "statCard('calendar', 'Yearly P&L'", 'Yearly P&L renders in the dashboard grid.');
});

test('dashboard cards have production 4-column responsive styling', () => {
  assertIncludes(styles, '.stats-grid', 'Dashboard cards use the shared stats grid class.');
  assertIncludes(styles, 'grid-template-columns: repeat(4, minmax(0, 1fr));', 'Desktop dashboard uses four consistent columns.');
  assertIncludes(styles, '@media (max-width: 1100px)', 'Tablet responsive breakpoint is preserved.');
  assertIncludes(styles, 'grid-template-columns: 1fr;', 'Mobile stacking is preserved.');
});
