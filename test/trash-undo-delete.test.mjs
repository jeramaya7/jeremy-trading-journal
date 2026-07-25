import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Guards Trash / Undo Delete (src/main.js): deleting a trade now sets
// `deletedAt` instead of removing it from `trades`, so it can be viewed in
// Trash, Restored, or Permanently Deleted. getActiveTrades() is the single
// place `deletedAt` trades are excluded, and every journal/dashboard read
// path (getDnaResultsTrades, getFilteredTrades, hasTradesForDate,
// getTradesForCalendarDate, and render()'s own activeTrades) was switched
// to it — see the "Deleted trades (Trash) are excluded..." comment in
// render().

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

function assertIncludes(text, expected, message) {
  assert.ok(text.includes(expected), `${message}\nExpected to find: ${expected}`);
}

function extractFunction(name) {
  const marker = `\nfunction ${name}(`;
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Expected to find function ${name} in src/main.js`);
  const start = markerIndex + 1;
  const braceStart = source.indexOf('{', markerIndex);
  let depth = 0;
  let cursor = braceStart;
  while (true) {
    if (source[cursor] === '{') depth += 1;
    else if (source[cursor] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
    cursor += 1;
  }
  return source.slice(start, cursor + 1);
}

function extractConst(name) {
  const marker = `const ${name} = `;
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Expected to find const ${name} in src/main.js`);
  const semicolonIndex = source.indexOf(';', markerIndex);
  return source.slice(markerIndex, semicolonIndex + 1);
}

// Same dependency set as test/manual-trade-stats.test.mjs, plus
// getActiveTrades — proves deleted trades are excluded from the exact
// stats math the dashboard runs (Net P/L, Trades, Win Rate, Profit Factor),
// not just that a filter function exists somewhere.
const STATS_MATH_FUNCTIONS = [
  'toOptionalNumber',
  'isCTraderImportedTrade',
  'getTradeDisplaySymbol',
  'firstReadableTradeSymbol',
  'getTradeContractSize',
  'calculatePnl',
  'isStopLossCloseReason',
  'getStopLossHitPrice',
  'getActiveStopLoss',
  'calculateOriginalRiskDollars',
  'calculateRiskDollars',
  'calculateRiskPercent',
  'classifyTradeOutcome',
  'calculateWinRate',
  'getProfitFactor',
  'calculateBiggestWinner',
  'calculateBiggestLoser',
  'getTradeReportDate',
  'getReportPeriodStart',
  'filterTradesForPeriod',
  'getEquityCurveTrades',
  'getCapitalExposureWalk',
  'calculateMaxCapitalExposure',
  'calculateCapitalEfficiency',
  'getStats',
];

function loadStatsModuleWithTrades(initialTrades) {
  const code = [
    'let trades = ' + JSON.stringify(initialTrades) + ';',
    extractConst('OUTCOME_DOLLAR_THRESHOLD'),
    // classifyTradeOutcome's Outcome Override lookup also references this.
    extractConst('OUTCOME_OVERRIDE_LABEL_TO_KEY'),
    'function getActiveTrades() { return trades.filter((trade) => !trade.deletedAt); }',
    ...STATS_MATH_FUNCTIONS.map(extractFunction),
    'module.exports = { getActiveTrades, filterTradesForPeriod, getStats };',
  ].join('\n\n');

  const context = { module: { exports: {} } };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'main.js (extracted trash/active-trades math)' });
  return context.module.exports;
}

test('getActiveTrades excludes deleted trades and includes everything else, unchanged', () => {
  const activeTrade = { id: 'a', deletedAt: null, symbol: 'AAPL' };
  const alsoActiveTrade = { id: 'b', symbol: 'MSFT' }; // no deletedAt key at all — must still count as active
  const deletedTrade = { id: 'c', deletedAt: '2026-07-16T12:00:00.000Z', symbol: 'TSLA' };

  const { getActiveTrades } = loadStatsModuleWithTrades([activeTrade, alsoActiveTrade, deletedTrade]);
  const active = getActiveTrades();

  assert.equal(active.length, 2, 'Only the two non-deleted trades should be active.');
  assert.ok(active.some((t) => t.id === 'a'), 'The explicitly non-deleted trade should be active.');
  assert.ok(active.some((t) => t.id === 'b'), 'A trade with no deletedAt field at all should still be active (existing trades stay safe).');
  assert.ok(!active.some((t) => t.id === 'c'), 'The deleted trade should be excluded.');
});

test('a deleted trade is removed from Net P/L, Trades, Win Rate, and Profit Factor — not just hidden from the list', () => {
  const referenceDate = new Date(2026, 6, 16, 15, 0, 0);

  const keptWin = {
    id: 'kept-win', provider: 'ctrader', symbol: 'EURUSD',
    closeTime: '2026-07-16T14:00:00.000Z', netProfitLoss: 50,
    entry: 1.1, exit: 1.101, size: 10000, direction: 'Long', stopLoss: 1.099,
  };
  const deletedLoss = {
    id: 'deleted-loss', provider: 'ctrader', symbol: 'GBPUSD',
    closeTime: '2026-07-16T13:00:00.000Z', netProfitLoss: -500,
    entry: 1.27, exit: 1.265, size: 10000, direction: 'Long', stopLoss: 1.268,
    deletedAt: '2026-07-16T13:30:00.000Z',
  };

  const { getActiveTrades, filterTradesForPeriod, getStats } = loadStatsModuleWithTrades([keptWin, deletedLoss]);

  const dayTrades = filterTradesForPeriod(getActiveTrades(), 'day', referenceDate);
  assert.equal(dayTrades.length, 1, 'Only the non-deleted trade should survive into the period-filtered list.');
  assert.equal(dayTrades[0].id, 'kept-win', 'The deleted trade must not be the one that survives.');

  const stats = getStats(dayTrades);
  assert.equal(stats.tradeCount, 1, 'Trades count must not include the deleted trade.');
  assert.equal(stats.totalPnl, 50, 'Net P/L must not include the deleted trade\'s -500 loss.');
  assert.equal(stats.winRate, 100, 'Win Rate must not be dragged down by the deleted loss.');
  assert.equal(stats.profitFactor, Infinity, 'Profit Factor must not count the deleted loss as gross loss (no losses left once it is excluded).');
});

test('restoring a trade (clearing deletedAt) brings it back into the exact same stats', () => {
  const referenceDate = new Date(2026, 6, 16, 15, 0, 0);
  const restoredTrade = {
    id: 'restored', provider: 'ctrader', symbol: 'GBPUSD',
    closeTime: '2026-07-16T13:00:00.000Z', netProfitLoss: -500,
    entry: 1.27, exit: 1.265, size: 10000, direction: 'Long', stopLoss: 1.268,
    deletedAt: null, // restoreTrade() sets this back to null
  };
  const keptWin = {
    id: 'kept-win', provider: 'ctrader', symbol: 'EURUSD',
    closeTime: '2026-07-16T14:00:00.000Z', netProfitLoss: 50,
    entry: 1.1, exit: 1.101, size: 10000, direction: 'Long', stopLoss: 1.099,
  };

  const { getActiveTrades, filterTradesForPeriod, getStats } = loadStatsModuleWithTrades([keptWin, restoredTrade]);
  const dayTrades = filterTradesForPeriod(getActiveTrades(), 'day', referenceDate);
  const stats = getStats(dayTrades);

  assert.equal(stats.tradeCount, 2, 'Trades count should include the restored trade.');
  assert.equal(stats.totalPnl, -450, 'Net P/L should include both the win and the restored loss.');
  assert.equal(stats.winRate, 50, 'Win Rate should reflect 1 win / 2 decided trades once restored.');
});

test('softDeleteTrade sets deletedAt instead of removing the trade from `trades`', () => {
  assertIncludes(source, 'function softDeleteTrade(tradeId) {', 'A dedicated soft-delete function exists.');
  const fnStart = source.indexOf('function softDeleteTrade(tradeId) {');
  const fnEnd = source.indexOf('\nfunction restoreTrade(tradeId) {');
  const fnBody = source.slice(fnStart, fnEnd);

  assertIncludes(fnBody, 'deletedAt: new Date().toISOString()', 'Deleting a trade sets a deletedAt timestamp.');
  assert.equal(fnBody.includes('trades.filter'), false, 'softDeleteTrade must not remove the trade from the array (that would be a hard delete).');
  assertIncludes(fnBody, 'trades.map((existingTrade)', 'softDeleteTrade maps over the existing array, keeping every trade, and only changes the matching one.');
  assertIncludes(fnBody, 'rememberDeletedCTraderSourceKey(trade);', 'Deleting a cTrader-imported trade still blocks it from being re-imported by Auto Sync, same as before.');
  assertIncludes(fnBody, 'recentlyDeletedTrade = {', 'Deleting a trade shows the Undo toast.');
  assertIncludes(fnBody, 'scheduleUndoToastDismiss();', 'The Undo toast auto-dismisses after a delay.');
});

test('restoreTrade clears deletedAt and un-blocks cTrader re-import', () => {
  assertIncludes(source, 'function restoreTrade(tradeId) {', 'A dedicated restore function exists.');
  const fnStart = source.indexOf('function restoreTrade(tradeId) {');
  const fnEnd = source.indexOf('\nfunction permanentlyDeleteTrade(tradeId) {');
  const fnBody = source.slice(fnStart, fnEnd);

  assertIncludes(fnBody, 'deletedAt: null', 'Restoring a trade clears its deletedAt timestamp.');
  assertIncludes(fnBody, 'forgetDeletedCTraderSourceKey(trade);', 'Restoring a cTrader-imported trade un-blocks it from Auto Sync — it behaves as if never deleted.');
});

test('permanentlyDeleteTrade only removes trades that are already in Trash, and confirms first', () => {
  assertIncludes(source, 'function permanentlyDeleteTrade(tradeId) {', 'A dedicated permanent-delete function exists.');
  const fnStart = source.indexOf('function permanentlyDeleteTrade(tradeId) {');
  const fnEnd = source.indexOf('\nfunction scheduleUndoToastDismiss(', fnStart);
  const fnBody = source.slice(fnStart, fnEnd);

  assertIncludes(fnBody, 'if (!trade || !trade.deletedAt) {', 'Permanent delete refuses to act on a trade that is not already soft-deleted.');
  assertIncludes(fnBody, 'window.confirm(', 'Permanent delete asks for confirmation before removing data for good.');
  assertIncludes(fnBody, 'trades.filter((existingTrade) => String(existingTrade.id) !== String(tradeId))', 'Only permanent delete actually removes the trade from the array.');
});

test('the Delete button on a trade card calls softDeleteTrade, not a hard filter', () => {
  assertIncludes(source, 'softDeleteTrade(button.dataset.deleteTrade);', 'The trade card Delete button is wired to the soft-delete function.');
});

test('Trash panel lists deleted trades with Restore and Delete Permanently, and a working back-to-journal toggle', () => {
  assertIncludes(source, 'function renderTrashPanel() {', 'A dedicated Trash panel renderer exists.');
  assertIncludes(source, 'const deletedTrades = getDeletedTrades();', 'The Trash panel lists exactly the deleted trades.');
  assertIncludes(source, 'data-restore-trade="${escapeHtml(trade.id)}"', 'Each Trash row has a Restore button tied to that trade.');
  assertIncludes(source, 'data-permanent-delete-trade="${escapeHtml(trade.id)}"', 'Each Trash row has a Delete Permanently button tied to that trade.');
  assertIncludes(source, "button.addEventListener('click', () => restoreTrade(button.dataset.restoreTrade)", 'Restore buttons are wired to restoreTrade().');
  assertIncludes(source, "button.addEventListener('click', () => permanentlyDeleteTrade(button.dataset.permanentDeleteTrade)", 'Delete Permanently buttons are wired to permanentlyDeleteTrade().');
  assertIncludes(source, 'data-toggle-trash', 'A Trash toggle button exists to open/close the Trash view.');
  assertIncludes(source, 'function toggleTrash() {', 'The Trash toggle has a dedicated handler.');
  assertIncludes(source, 'isTrashOpen = !isTrashOpen;', 'Toggling Trash flips a simple boolean — no complicated new view/routing system.');
});

test('an Undo toast appears immediately after deleting and can undo the delete', () => {
  assertIncludes(source, 'function renderUndoDeleteToast() {', 'A dedicated Undo toast renderer exists.');
  assertIncludes(source, 'if (!recentlyDeletedTrade) {\n    return \'\';\n  }', 'The Undo toast only renders right after a delete.');
  assertIncludes(source, 'data-undo-delete', 'The Undo toast has an Undo button.');
  assertIncludes(source, 'function undoLastDelete() {', 'A dedicated undo function exists.');
  assertIncludes(source, 'restoreTrade(recentlyDeletedTrade.id);', 'Undo restores the most recently deleted trade using the same restore path Trash uses.');
  assertIncludes(source, 'const UNDO_TOAST_DURATION_MS = 6000;', 'The Undo toast auto-dismisses after a fixed delay.');
});

test('every journal and dashboard read path was switched from `trades` to the active (non-deleted) list', () => {
  assertIncludes(source, 'return filterTradesForPeriod(getActiveTrades(), dnaResultsTimeframe, referenceDate);', 'getDnaResultsTrades excludes deleted trades — this feeds Net P/L, Trades, Win Rate, Protected %, Profit Factor, and every period filter.');
  assertIncludes(source, 'return getActiveTrades().filter((trade) => {', 'getFilteredTrades (the journal list) excludes deleted trades.');
  assertIncludes(source, 'const activeTrades = getActiveTrades();', 'render() computes one active-trades list for Daily/Weekly/Monthly/Yearly P/L, ROI, the calendar, and Trading Mode\'s Today KPIs.');
  assertIncludes(source, 'getPnlReports(dnaReferenceDate, activeTrades)', 'Daily/Weekly/Monthly/Yearly P/L exclude deleted trades.');
  assertIncludes(source, 'calculateAccountBalanceAtPeriodStart(dnaResultsTimeframe, dnaReferenceDate, activeTrades, startingAccountBalance)', 'ROI\'s account balance calculation excludes deleted trades.');
  assertIncludes(source, 'renderMonthlyTradingCalendar(monthlyCalendarDate, activeTrades)', 'The monthly calendar excludes deleted trades.');
  assertIncludes(source, "filterTradesForPeriod(activeTrades, 'day', dnaReferenceDate)", 'Trading Mode\'s Today KPI strip excludes deleted trades.');
});

test('existing trades without a deletedAt field remain completely unaffected', () => {
  // No migration was added — this is deliberate. `!trade.deletedAt` treats
  // undefined exactly like null, so trades saved before this feature
  // shipped are active by default with zero data changes required.
  assert.equal(source.includes('migrateDeletedAt'), false, 'No migration function was added — old trade data needs none.');
  assertIncludes(source, 'function getActiveTrades() {\n  return trades.filter((trade) => !trade.deletedAt);\n}', 'getActiveTrades treats a missing deletedAt field the same as an explicit null/false.');
});
