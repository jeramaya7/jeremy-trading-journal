import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

function assertIncludes(text, expected, message) {
  assert.ok(text.includes(expected), `${message}\nExpected to find: ${expected}`);
}

test('asset analytics groups trades by existing display symbol logic', () => {
  assertIncludes(source, 'function getAssetAnalytics(tradeList = trades)', 'Asset analytics has a dedicated calculator.');
  assertIncludes(source, 'const asset = getTradeDisplaySymbol(trade).trim();', 'Asset analytics reuses display-symbol logic.');
  assertIncludes(source, 'const pnl = calculatePnl(trade);', 'Asset analytics reuses existing P&L calculation.');
  assertIncludes(source, 'const rMultiple = calculateRMultiple(trade);', 'Asset analytics reuses existing R calculation.');
  assertIncludes(source, 'averageWinner: report.winningPnlCount ? report.totalWinningPnl / report.winningPnlCount : null,', 'Asset analytics calculates average winner.');
  assertIncludes(source, 'averageLoser: report.losingPnlCount ? report.totalLosingPnl / report.losingPnlCount : null,', 'Asset analytics calculates average loser.');
});

test('asset analytics uses DNA timeframe filtered trades and sorts by net P&L descending', () => {
  assertIncludes(source, "let assetAnalyticsSort = { key: 'netPnl', direction: 'desc' };", 'Asset analytics defaults to highest Net P&L first.');
  assertIncludes(source, 'const assetAnalyticsSection = renderAssetAnalytics(dnaResultsTrades);', 'Asset analytics uses the current DNA timeframe trade set.');
  assertIncludes(source, '.sort(compareAssetAnalyticsRows);', 'Asset analytics rows are sorted.');
  assertIncludes(source, 'data-asset-sort-key', 'Asset analytics headers support existing sortable-table pattern.');
});

test('asset analytics renders near setup analytics with required columns', () => {
  const setupIndex = source.indexOf('${setupAnalyticsSection}');
  const assetIndex = source.indexOf('${assetAnalyticsSection}');
  const workspaceIndex = source.indexOf('<section class="workspace-grid">');

  assert.ok(assetIndex > setupIndex, 'Asset analytics renders near and after setup analytics.');
  assert.ok(workspaceIndex > assetIndex, 'Asset analytics renders above the workspace.');
  assertIncludes(source, '<h2>Asset Analytics</h2>', 'Asset analytics section has a title.');
  assertIncludes(source, "assetAnalyticsHeader('asset', 'Asset')", 'Asset column is rendered.');
  assertIncludes(source, "assetAnalyticsHeader('tradeCount', 'Total Trades')", 'Total Trades column is rendered.');
  assertIncludes(source, "assetAnalyticsHeader('winRate', 'Win Rate')", 'Win Rate column is rendered.');
  assertIncludes(source, "assetAnalyticsHeader('netPnl', 'Net P&L')", 'Net P&L column is rendered.');
  assertIncludes(source, "assetAnalyticsHeader('averageR', 'Average R')", 'Average R column is rendered.');
  assertIncludes(source, "assetAnalyticsHeader('averageWinner', 'Average Winner')", 'Average Winner column is rendered.');
  assertIncludes(source, "assetAnalyticsHeader('averageLoser', 'Average Loser')", 'Average Loser column is rendered.');
});

test('asset analytics uses setup analytics table styling patterns', () => {
  assertIncludes(styles, '.asset-analytics-panel', 'Asset analytics has a section-specific style hook.');
  assertIncludes(styles, '.asset-analytics-table', 'Asset analytics has a table-specific style hook.');
  assertIncludes(source, '<table class="setup-analytics-table asset-analytics-table">', 'Asset analytics reuses setup analytics table styles.');
});
