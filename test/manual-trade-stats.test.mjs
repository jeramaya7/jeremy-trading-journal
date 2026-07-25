import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Regression coverage for the "manual trades missing from dashboard stats"
// bug (src/main.js).
//
// Root cause: getTradeReportDate() read `trade.closeTime || trade.date` and
// passed it straight to `new Date(...)`. Imported cTrader trades always have
// a full ISO timestamp in `closeTime` (e.g. "2026-07-16T20:49:53.000Z"),
// which JS parses as an absolute instant and converts to local time
// correctly. Manual trades only ever set `trade.date` as a plain
// "YYYY-MM-DD" string (no `closeTime`) — and JS parses date-only strings as
// UTC midnight, not local midnight. In any timezone behind UTC (all of the
// Americas), that UTC midnight is still the *previous* calendar day
// locally, so a manual trade dated "today" silently read back as "yesterday"
// everywhere getTradeReportDate() is used — which is every dashboard stat
// and every period filter (Net P/L, Trades, Win Rate, Protected %, ROI,
// Profit Factor, and the Day/WTD/MTD/YTD/Beginning toggle all ultimately
// call this one shared helper).
//
// Fix: date-only strings are now parsed into local-time Date components
// (`new Date(year, month - 1, day)`) instead of being handed to the
// UTC-parsing `new Date(string)` path. Full ISO timestamps (imported
// trades) are untouched — the regex only matches bare "YYYY-MM-DD" values.

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

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

// Every function these stats transitively depend on, extracted from the
// live source (rather than reimplemented) so the tests exercise the actual
// shipped code — same approach as test/roi-and-starting-balance.test.mjs.
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
  'calculateRoiPercent',
  'calculateAccountBalanceAtPeriodStart',
];

function loadStatsModule() {
  const code = [
    extractConst('OUTCOME_DOLLAR_THRESHOLD'),
    // classifyTradeOutcome's Outcome Override lookup also references this.
    extractConst('OUTCOME_OVERRIDE_LABEL_TO_KEY'),
    ...STATS_MATH_FUNCTIONS.map(extractFunction),
    'module.exports = { ' + STATS_MATH_FUNCTIONS.join(', ') + ' };',
  ].join('\n\n');

  const context = { module: { exports: {} } };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'main.js (extracted dashboard stats math)' });
  return context.module.exports;
}

test('getTradeReportDate reads a manual trade\'s plain date string as local midnight, not UTC midnight', () => {
  const { getTradeReportDate } = loadStatsModule();

  const manualTrade = { date: '2026-07-16' };
  const reportDate = getTradeReportDate(manualTrade);

  // With the old `new Date(trade.date)` UTC-parsing bug, getDate() would
  // read back as 15 in any timezone behind UTC. Constructing from local
  // year/month/day components (the fix) makes this assertion hold in every
  // timezone, which is itself the regression guard.
  assert.equal(reportDate.getFullYear(), 2026, 'Year should match the stored date exactly.');
  assert.equal(reportDate.getMonth(), 6, 'Month should match the stored date exactly (July = index 6).');
  assert.equal(reportDate.getDate(), 16, 'Day should match the stored date exactly, not shift back one day.');
});

test('imported cTrader trades still parse closeTime as an absolute instant (unaffected by the fix)', () => {
  const { getTradeReportDate } = loadStatsModule();

  const importedTrade = { provider: 'ctrader', closeTime: '2026-07-16T14:00:00.000Z' };
  const reportDate = getTradeReportDate(importedTrade);

  assert.equal(reportDate.getTime(), new Date('2026-07-16T14:00:00.000Z').getTime(), 'Imported trades\' closeTime should still parse exactly as before — the fix only changes date-only string handling.');
});

test('one manual trade + one imported trade together update every dashboard stat the Day filter uses', () => {
  const { getStats, filterTradesForPeriod, calculateRoiPercent, calculateAccountBalanceAtPeriodStart } = loadStatsModule();

  // A fixed local "today" — built from local components (not an ISO string)
  // so this test is stable regardless of which timezone it runs in.
  const referenceDate = new Date(2026, 6, 16, 15, 0, 0);

  const manualTrade = {
    id: 'manual-1',
    date: '2026-07-16', // manual trades only ever set this — no closeTime
    symbol: 'AAPL',
    direction: 'Short',
    entry: 100,
    exit: 110,
    size: 1,
    stopLoss: 112,
    accountSize: 5000,
    protected: 'No',
  };
  const importedTrade = {
    id: 'ctrader-1',
    provider: 'ctrader',
    symbol: 'EURUSD',
    openTime: '2026-07-16T13:00:00.000Z',
    closeTime: '2026-07-16T14:00:00.000Z', // well clear of the day boundary
    netProfitLoss: 50,
    entry: 1.1000,
    exit: 1.1010,
    size: 10000,
    direction: 'Long',
    stopLoss: 1.0990,
    accountSize: 5000,
    protected: 'Yes',
  };

  const allTrades = [manualTrade, importedTrade];
  const dayTrades = filterTradesForPeriod(allTrades, 'day', referenceDate);

  assert.equal(dayTrades.length, 2, 'Both the manual trade and the imported trade should be counted in the Day filter.');
  assert.ok(dayTrades.includes(manualTrade), 'The manual trade specifically must survive the Day filter (this is the bug being fixed).');

  const stats = getStats(dayTrades);

  // manualTrade: (100 - 110) * 1 * contractSize(1) = -10 (a Short loss)
  // importedTrade: netProfitLoss = 50 (a win)
  assert.equal(stats.tradeCount, 2, 'Trades stat should count both trades.');
  assert.equal(stats.totalPnl, 40, 'Net P/L should be the sum of the manual trade (-10) and the imported trade (+50).');
  assert.equal(stats.winRate, 50, 'Win Rate should be 1 win / 2 decided trades = 50%, only true if the manual loss is counted.');
  assert.equal(stats.protectedPercent, 50, 'Protected % should be 1 of 2 trades = 50%, only true if the manual (Protected: No) trade is counted in the denominator.');
  assert.equal(stats.profitFactor, 5, 'Profit Factor should be grossProfit(50) / grossLoss(10) = 5, only true if the manual loss is counted.');

  // ROI: both trades close "today", so the balance at the start of today
  // excludes them both — ROI should reflect the combined P/L of both trades
  // against the unchanged starting balance.
  const startingBalance = 5600;
  const balanceAtDayStart = calculateAccountBalanceAtPeriodStart('day', referenceDate, allTrades, startingBalance);
  assert.equal(balanceAtDayStart, startingBalance, 'Balance at start of today should be unaffected by trades that close today.');
  const roiPercent = calculateRoiPercent(stats.totalPnl, balanceAtDayStart);
  assert.equal(roiPercent, (40 / 5600) * 100, 'ROI % should be computed from Net P/L that includes the manual trade.');
});

test('Outcome Override flows through getStats(): a Breakeven-overridden loss no longer counts as a loss', () => {
  const { getStats } = loadStatsModule();

  // A real loss (-$50) that the user has manually reclassified as Breakeven
  // (e.g. a small stop-out caused by slippage/commission) must not count
  // toward Win Rate's denominator or Profit Factor's gross loss — exactly
  // as if it had automatically classified as Breakeven.
  const overriddenLossTrade = {
    id: 'overridden-1', date: '2026-07-16', symbol: 'EURUSD', direction: 'Long',
    entry: 1.1000, exit: 1.0995, size: 100000, protected: 'No',
    outcomeOverride: 'Breakeven',
  };
  const plainWinTrade = {
    id: 'plain-win', date: '2026-07-16', symbol: 'EURUSD', direction: 'Long',
    entry: 1.1000, exit: 1.1010, size: 100000, protected: 'No',
  };

  const stats = getStats([overriddenLossTrade, plainWinTrade]);

  assert.equal(stats.tradeCount, 2, 'Both trades should still be counted.');
  assert.ok(Math.abs(stats.totalPnl - 50) < 0.01, 'Total P/L should still reflect the real dollar P/L (-50 + 100 = 50), override or not.');
  assert.equal(stats.winRate, 100, 'Win Rate should be 1 win / 1 decided trade = 100%, since the overridden loss is excluded as Breakeven, not counted as a loss.');
});

test('Outcome Override flows through getStats(): a Win-overridden breakeven trade counts as a win', () => {
  const { getStats } = loadStatsModule();

  // A near-flat trade (well inside the $1.00 automatic Breakeven band) that
  // the user manually marks as a Win must count as a win in Win Rate.
  const overriddenWinTrade = {
    id: 'overridden-2', date: '2026-07-16', symbol: 'EURUSD', direction: 'Long',
    entry: 1.1000, exit: 1.10002, size: 100000, protected: 'No',
    outcomeOverride: 'Win',
  };
  const plainLossTrade = {
    id: 'plain-loss', date: '2026-07-16', symbol: 'EURUSD', direction: 'Long',
    entry: 1.1000, exit: 1.0990, size: 100000, protected: 'No',
  };

  const stats = getStats([overriddenWinTrade, plainLossTrade]);

  assert.equal(stats.winRate, 50, 'Win Rate should be 1 win / 2 decided trades = 50%, only true if the overridden near-flat trade counts as a Win rather than Breakeven.');
});

test('a manual trade with only a date string is counted in every period filter (Day/WTD/MTD/YTD/Beginning)', () => {
  const { filterTradesForPeriod } = loadStatsModule();

  const referenceDate = new Date(2026, 6, 16, 15, 0, 0); // local "today"
  const manualTrade = { id: 'manual-only', date: '2026-07-16', symbol: 'AAPL', direction: 'Long', entry: 10, exit: 11, size: 1 };

  for (const period of ['day', 'week', 'month', 'year', 'all']) {
    const filtered = filterTradesForPeriod([manualTrade], period, referenceDate);
    assert.equal(filtered.length, 1, `The manual trade should be counted in the "${period}" period filter.`);
  }
});
