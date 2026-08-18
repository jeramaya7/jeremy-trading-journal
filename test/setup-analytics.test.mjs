import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

function assertIncludes(text, expected, message) {
  assert.ok(text.includes(expected), `${message}\nExpected to find: ${expected}`);
}

test('setup analytics groups non-blank setups using existing trade calculations', () => {
  assertIncludes(source, 'function getSetupAnalytics(tradeList = trades)', 'Setup analytics has a dedicated report calculator.');
  assertIncludes(source, "const setupName = String(trade.setup ?? '').trim();", 'Setup values are normalized from existing trade data.');
  assertIncludes(source, 'if (!setupName) {', 'Blank setup values are ignored.');
  assertIncludes(source, 'const pnl = calculatePnl(trade);', 'Setup analytics reuses the existing P&L calculation.');
  assertIncludes(source, 'const rMultiple = calculateRMultiple(trade);', 'Setup analytics reuses the existing R calculation.');
  assertIncludes(source, 'profitFactor: getProfitFactor(report.winningPnl, report.losingPnl),', 'Setup analytics calculates Profit Factor from shared win/loss P&L buckets.');
  assertIncludes(source, 'netPnl: report.netPnl,', 'Net P&L is included for each setup row.');
});

test('setup analytics renders below the dashboard as a sortable table ordered by net P&L by default', () => {
  const statsIndex = source.indexOf('${dashboardSnapshot}');
  const setupIndex = source.indexOf('${setupAnalyticsSection}');
  const workspaceIndex = source.indexOf('<section class="workspace-grid">');

  assert.ok(statsIndex > -1, 'Existing dashboard section still renders before setup analytics.');
  assert.ok(setupIndex > statsIndex, 'Setup analytics renders below the dashboard.');
  assert.ok(workspaceIndex > setupIndex, 'Setup analytics renders above the workspace.');
  assertIncludes(source, "let setupAnalyticsSort = { key: 'netPnl', direction: 'desc' };", 'Setup analytics defaults to highest Net P&L first.');
  assertIncludes(source, 'data-setup-sort-key', 'Setup analytics table headers are sortable.');
  assertIncludes(source, '<table class="setup-analytics-table">', 'Setup analytics is displayed as a table.');
});

test('setup analytics has clean production table styling', () => {
  assertIncludes(styles, '.setup-analytics-panel', 'Setup analytics panel has dedicated styling.');
  assertIncludes(styles, '.setup-analytics-table', 'Setup analytics table has dedicated styling.');
  assertIncludes(styles, '.table-sort-button', 'Sortable table headers have dedicated styling.');
});

test('setup analytics displays Profit Factor instead of Average R', () => {
  assertIncludes(source, "${setupAnalyticsHeader('profitFactor', 'Profit Factor')}", 'Setup analytics renders a Profit Factor column.');
  assertIncludes(source, "const sortLabels = { setupName: 'Setup Name', tradeCount: 'Number of Trades', winRate: 'Win Rate %', profitFactor: 'Profit Factor', netPnl: 'Net P&L' };", 'Setup analytics sorting labels include Profit Factor.');
  assertIncludes(source, '<td class="${pfTone}">${formatProfitFactor(report.profitFactor)}</td>', 'Setup analytics rows render formatted Profit Factor.');
  assert.equal(source.includes("${setupAnalyticsHeader('averageR', 'Average R')}"), false, 'Setup analytics no longer renders Average R.');
});
