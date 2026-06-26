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
  assertIncludes(source, 'const assetAnalyticsSection = renderAssetAnalytics(dnaResultsTrades);', 'Asset analytics uses the current DNA timeframe trade set.');
  assertIncludes(source, '.sort(compareAssetAnalyticsRows);', 'Asset analytics rows are sorted.');
  assert.ok(!source.includes('data-asset-sort-key'), 'Asset analytics removes inactive sortable-table controls.');
  assert.ok(!source.includes('assetAnalyticsSort'), 'Asset analytics removes inactive sort state.');
  assertIncludes(source, 'const netPnlResult = secondRow.netPnl - firstRow.netPnl;', 'Asset analytics sorts by Net P&L descending.');
  assertIncludes(source, 'const tradeCountResult = secondRow.tradeCount - firstRow.tradeCount;', 'Asset analytics breaks Net P&L ties by Total Trades descending.');
});

test('asset analytics renders near setup analytics with required columns', () => {
  const setupIndex = source.indexOf('${setupAnalyticsSection}');
  const assetIndex = source.indexOf('${assetAnalyticsSection}');
  const workspaceIndex = source.indexOf('<section class="workspace-grid">');

  assert.ok(assetIndex > setupIndex, 'Asset analytics renders near and after setup analytics.');
  assert.ok(workspaceIndex > assetIndex, 'Asset analytics renders above the workspace.');
  assertIncludes(source, '<h2>Asset Analytics</h2>', 'Asset analytics section has a title.');
  assertIncludes(source, '<th scope="col">Asset</th>', 'Asset column is rendered.');
  assertIncludes(source, '<th scope="col">Total Trades</th>', 'Total Trades column is rendered.');
  assertIncludes(source, '<th scope="col">Win Rate</th>', 'Win Rate column is rendered.');
  assertIncludes(source, '<th scope="col">Net P&L</th>', 'Net P&L column is rendered.');
  assertIncludes(source, '<th scope="col">Average R</th>', 'Average R column is rendered.');
  assertIncludes(source, '<th scope="col">Average Winner</th>', 'Average Winner column is rendered.');
  assertIncludes(source, '<th scope="col">Average Loser</th>', 'Average Loser column is rendered.');
});

test('asset analytics uses setup analytics table styling patterns', () => {
  assertIncludes(styles, '.asset-analytics-panel', 'Asset analytics has a section-specific style hook.');
  assertIncludes(styles, '.asset-analytics-table', 'Asset analytics has a table-specific style hook.');
  assertIncludes(source, '<table class="setup-analytics-table asset-analytics-table">', 'Asset analytics reuses setup analytics table styles.');
});


test('asset analytics maps known symbols to friendly names', () => {
  assertIncludes(source, "XAUUSD: 'Gold',", 'Gold has a friendly asset name.');
  assertIncludes(source, "BTCUSD: 'Bitcoin',", 'Bitcoin has a friendly asset name.');
  assertIncludes(source, "ETHUSD: 'Ethereum',", 'Ethereum has a friendly asset name.');
  assertIncludes(source, "US30: 'Dow Jones',", 'Dow Jones has a friendly asset name.');
  assertIncludes(source, "US100: 'Nasdaq',", 'Nasdaq has a friendly asset name.');
  assertIncludes(source, "SPX500: 'S&P 500',", 'S&P 500 has a friendly asset name.');
  assertIncludes(source, "return FRIENDLY_ASSET_NAMES[normalizedSymbol] || String(symbol ?? '').trim();", 'Unknown assets fall back to the existing symbol.');
});

test('asset analytics asset names toggle the journal asset filter', () => {
  assertIncludes(source, "let selectedAssetFilter = '';", 'Asset filter state exists.');
  assertIncludes(source, 'class="asset-filter-button"', 'Asset row names use a dedicated clickable control.');
  assertIncludes(source, 'data-asset-filter="${escapeHtml(report.asset)}"', 'Asset row names expose a filter target.');
  assertIncludes(source, "selectedAssetFilter = selectedAssetFilter === button.dataset.assetFilter ? '' : button.dataset.assetFilter;", 'Clicking the same asset clears the filter.');
  assertIncludes(source, "document.querySelector('.journal-panel')?.scrollIntoView", 'Asset filter follows existing journal navigation behavior.');
});

test('journal filtering includes the selected asset', () => {
  assertIncludes(source, 'const normalizedAssetFilter = selectedAssetFilter.trim().toLowerCase();', 'Journal filter normalizes the selected asset.');
  assertIncludes(source, 'const matchesAsset = !normalizedAssetFilter || getTradeDisplaySymbol(trade).trim().toLowerCase() === normalizedAssetFilter;', 'Journal entries filter by display symbol.');
  assertIncludes(source, 'return matchesCalendarDate && matchesAsset && matchesSearch;', 'Journal filtering preserves existing calendar and search filters.');
});
