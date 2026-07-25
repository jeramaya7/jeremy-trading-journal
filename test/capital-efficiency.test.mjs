import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Guards Capital Efficiency (CE) — DNA 27 (src/main.js). CE = Net Profit ÷
// Maximum Capital Exposure, where Maximum Capital Exposure is built by
// walking every closed trade in a period in chronological close order and
// tracking, for each trade: max(0, -RunningPnLBeforeThisTrade) + RiskDollars.
// This file exercises the actual shipped math (extracted from source,
// rather than reimplemented) against hand-computed examples, so a change
// to the formula can't silently drift from what the UI displays.

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

// Every function calculateCapitalEfficiency/calculateMaxCapitalExposure
// transitively depend on, extracted from the live source — same approach
// as test/manual-trade-stats.test.mjs's STATS_MATH_FUNCTIONS.
const CE_FUNCTIONS = [
  'toOptionalNumber',
  'isCTraderImportedTrade',
  'getTradeDisplaySymbol',
  'firstReadableTradeSymbol',
  'getTradeContractSize',
  'calculatePnl',
  'isStopLossCloseReason',
  'getStopLossHitPrice',
  'getActiveStopLoss',
  'calculateRiskDollars',
  'getTradeReportDate',
  'getEquityCurveTrades',
  'getCapitalExposureWalk',
  'calculateMaxCapitalExposure',
  'calculateCapitalEfficiency',
  'formatCapitalEfficiency',
];

function loadCeModule() {
  const code = [
    ...CE_FUNCTIONS.map(extractFunction),
    'module.exports = { ' + CE_FUNCTIONS.join(', ') + ' };',
  ].join('\n\n');

  const context = { module: { exports: {} } };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'main.js (extracted capital efficiency)' });
  return context.module.exports;
}

// Minimal closed trade: a long trade that nets `pnl` dollars and risks
// `riskDollars` (via entry/stopLoss/size), closed on `date`.
function makeTrade({ id, date, pnl, riskDollars }) {
  // entry/exit/size are chosen so (exit - entry) * size === pnl exactly for
  // a Long trade with 0 fees (see calculatePnl). Using size = 1 keeps the
  // arithmetic direct: exit = entry + pnl.
  const entry = 100;
  const exit = entry + pnl;
  // riskDollars === (entry - stopLoss) * size, size = 1, so stopLoss = entry - riskDollars.
  const stopLoss = riskDollars === null ? undefined : entry - riskDollars;
  return {
    id,
    date,
    symbol: 'TEST',
    direction: 'Long',
    entry,
    exit,
    size: 1,
    fees: 0,
    stopLoss,
  };
}

test('Vale worked example: down $50, then a trade risking $22 -> exposure $72', () => {
  const { calculateMaxCapitalExposure } = loadCeModule();

  const trades = [
    makeTrade({ id: 'a', date: '2026-07-01', pnl: -50, riskDollars: null }),
    makeTrade({ id: 'b', date: '2026-07-02', pnl: 10, riskDollars: 22 }),
  ];

  assert.equal(calculateMaxCapitalExposure(trades), 72, 'Down $50 then risking $22 should expose $72 (the $50 drawdown plus the $22 risk).');
});

test('Vale worked example: up $200, then a trade risking $50 -> exposure is only $50', () => {
  const { calculateMaxCapitalExposure } = loadCeModule();

  const trades = [
    makeTrade({ id: 'a', date: '2026-07-01', pnl: 200, riskDollars: null }),
    makeTrade({ id: 'b', date: '2026-07-02', pnl: -10, riskDollars: 50 }),
  ];

  assert.equal(calculateMaxCapitalExposure(trades), 50, 'Up $200 then risking $50 should expose only $50 — profit is a cushion, never a negative exposure.');
});

test('exposure can never be less than the current trade\'s own Risk $, no matter how large the cushion', () => {
  const { calculateMaxCapitalExposure } = loadCeModule();

  const trades = [
    makeTrade({ id: 'a', date: '2026-07-01', pnl: 100000, riskDollars: null }),
    makeTrade({ id: 'b', date: '2026-07-02', pnl: 1, riskDollars: 5 }),
  ];

  assert.equal(calculateMaxCapitalExposure(trades), 5, 'A trade always contributes at least its own Risk $, regardless of how big the running profit cushion is.');
});

test('Maximum Capital Exposure is the highest single-trade exposure anywhere in the period, not the last one', () => {
  const { calculateMaxCapitalExposure } = loadCeModule();

  const trades = [
    makeTrade({ id: 'a', date: '2026-07-01', pnl: -100, riskDollars: 20 }), // exposure: max(0,0)+20 = 20
    makeTrade({ id: 'b', date: '2026-07-02', pnl: -50, riskDollars: 30 }), // running pnl before = -100; exposure: 100+30 = 130
    makeTrade({ id: 'c', date: '2026-07-03', pnl: 200, riskDollars: 10 }), // running pnl before = -150; exposure: 150+10 = 160 (peak)
    makeTrade({ id: 'd', date: '2026-07-04', pnl: 5, riskDollars: 15 }), // running pnl before = 50; exposure: 0+15 = 15
  ];

  assert.equal(calculateMaxCapitalExposure(trades), 160, 'The peak exposure trade (trade c, the deepest point in the drawdown) should win, even though it is not the last trade.');
});

test('the exposure walk is independent of input array order — it always re-sorts by close date first', () => {
  const { calculateMaxCapitalExposure, calculateCapitalEfficiency } = loadCeModule();

  const chronological = [
    makeTrade({ id: 'a', date: '2026-07-01', pnl: -100, riskDollars: 20 }),
    makeTrade({ id: 'b', date: '2026-07-02', pnl: -50, riskDollars: 30 }),
    makeTrade({ id: 'c', date: '2026-07-03', pnl: 200, riskDollars: 10 }),
  ];
  const shuffled = [chronological[2], chronological[0], chronological[1]];

  assert.equal(calculateMaxCapitalExposure(shuffled), calculateMaxCapitalExposure(chronological), 'Maximum Capital Exposure must not depend on the order trades are passed in.');
  assert.equal(calculateCapitalEfficiency(shuffled), calculateCapitalEfficiency(chronological), 'CE must not depend on the order trades are passed in.');
});

test('a trade with no computable Risk $ (missing stop loss) contributes $0 of its own risk but still affects running P/L', () => {
  const { calculateMaxCapitalExposure } = loadCeModule();

  const trades = [
    makeTrade({ id: 'a', date: '2026-07-01', pnl: -80, riskDollars: null }), // exposure: max(0,0)+0 = 0
    makeTrade({ id: 'b', date: '2026-07-02', pnl: 5, riskDollars: null }), // running pnl before = -80; exposure: 80+0 = 80
  ];

  assert.equal(calculateMaxCapitalExposure(trades), 80, 'A trade with no known Risk $ still lets prior drawdown carry through to the next trade\'s exposure.');
});

test('CE = Net Profit ÷ Maximum Capital Exposure, using the exact same trade set for both', () => {
  const { calculateCapitalEfficiency } = loadCeModule();

  const trades = [
    makeTrade({ id: 'a', date: '2026-07-01', pnl: -50, riskDollars: null }),
    makeTrade({ id: 'b', date: '2026-07-02', pnl: 122, riskDollars: 22 }),
  ];
  // Net Profit = -50 + 122 = 72. Maximum Capital Exposure = 72 (from the first worked example).
  assert.equal(calculateCapitalEfficiency(trades), 1, 'Net Profit 72 / Maximum Capital Exposure 72 = 1.00.');
});

test('CE is null (not Infinity or a crash) when Maximum Capital Exposure is zero', () => {
  const { calculateCapitalEfficiency, calculateMaxCapitalExposure } = loadCeModule();

  assert.equal(calculateMaxCapitalExposure([]), 0, 'No trades means zero exposure.');
  assert.equal(calculateCapitalEfficiency([]), null, 'CE should be null, not a division-by-zero result, with no trades.');

  const noRiskProfitableTrades = [
    makeTrade({ id: 'a', date: '2026-07-01', pnl: 50, riskDollars: null }),
    makeTrade({ id: 'b', date: '2026-07-02', pnl: 30, riskDollars: null }),
  ];
  assert.equal(calculateMaxCapitalExposure(noRiskProfitableTrades), 0, 'All-profitable trades with no known Risk $ never create any exposure.');
  assert.equal(calculateCapitalEfficiency(noRiskProfitableTrades), null, 'CE should be null when exposure never left zero.');
});

test('formatCapitalEfficiency renders two decimal places with a × suffix, and — for null/non-finite', () => {
  const { formatCapitalEfficiency } = loadCeModule();

  assert.equal(formatCapitalEfficiency(3.14159), '3.14×');
  assert.equal(formatCapitalEfficiency(1), '1.00×');
  assert.equal(formatCapitalEfficiency(-0.5), '-0.50×');
  assert.equal(formatCapitalEfficiency(null), '—');
  assert.equal(formatCapitalEfficiency(undefined), '—');
  assert.equal(formatCapitalEfficiency(NaN), '—');
});

// --- Wiring: getStats(), calculatePnlForPeriod(), and the UI -------------

test('getStats() returns capitalEfficiency computed from the exact same tradeList passed in', () => {
  assertIncludes(source, 'const capitalEfficiency = calculateCapitalEfficiency(tradeList);', 'getStats should compute CE from its own tradeList argument, so it always reflects whatever period/filter the caller applied.');
  const getStatsStart = source.indexOf('function getStats(tradeList = trades)');
  const getStatsEnd = source.indexOf('\nfunction ', getStatsStart + 1);
  const getStatsBody = source.slice(getStatsStart, getStatsEnd);
  assertIncludes(getStatsBody, 'capitalEfficiency,', 'getStats() should return capitalEfficiency on the stats object.');
});

test('calculatePnlForPeriod() returns capitalEfficiency for the same period-filtered trades used for pnl/tradeCount', () => {
  assertIncludes(source, 'const periodTrades = filterTradesForPeriod(tradeList, period, referenceDate);', 'The period trade set should be computed once and reused.');
  assertIncludes(source, 'return { ...baseReport, capitalEfficiency: calculateCapitalEfficiency(periodTrades) };', 'capitalEfficiency should be computed from the same periodTrades as pnl/tradeCount, so Daily/Weekly/Monthly/Yearly CE can never disagree with Daily/Weekly/Monthly/Yearly P/L about which trades were included.');
});

test('CE renders as the final KPI in the Trading Mode header, after Profit Factor', () => {
  const todayStripStart = source.indexOf('function renderTodayKpiStrip(todayTrades, todayStats)');
  const todayStripEnd = source.indexOf('\nfunction ', todayStripStart + 1);
  const todayStripBody = source.slice(todayStripStart, todayStripEnd);

  const profitFactorIndex = todayStripBody.indexOf("statCard('line', 'Profit Factor'");
  const ceIndex = todayStripBody.indexOf("statCard('line', 'CE'");
  assert.notEqual(profitFactorIndex, -1, 'Profit Factor should still render in the Trading Mode header.');
  assert.notEqual(ceIndex, -1, 'CE should render in the Trading Mode header.');
  assert.ok(profitFactorIndex < ceIndex, 'CE should render after Profit Factor: Today P/L | Today % | Win Rate | Trades | Profit Factor | CE.');
  assertIncludes(todayStripBody, "formatCapitalEfficiency(todayStats.capitalEfficiency)", 'Trading Mode CE should use the shared formatter and todayStats.capitalEfficiency.');
});

test('CE renders as the final KPI in the Dashboard header, after Profit Factor', () => {
  const heroRowStart = source.indexOf('function renderHeroStatsRow(stats)');
  const heroRowEnd = source.indexOf('\nfunction ', heroRowStart + 1);
  const heroRowBody = source.slice(heroRowStart, heroRowEnd);

  const profitFactorIndex = heroRowBody.indexOf("statCard('line', 'Profit Factor'");
  const ceIndex = heroRowBody.indexOf("statCard('line', 'CE'");
  assert.notEqual(profitFactorIndex, -1, 'Profit Factor should still render in the Dashboard header.');
  assert.notEqual(ceIndex, -1, 'CE should render in the Dashboard header.');
  assert.ok(profitFactorIndex < ceIndex, 'CE should render after Profit Factor: Net P/L | Trades | Win Rate | Profit Factor | CE.');
  assertIncludes(heroRowBody, "formatCapitalEfficiency(stats.capitalEfficiency)", 'Dashboard CE should use the shared formatter and stats.capitalEfficiency.');
});

test('DNA Results has a Capital Efficiency row with Daily/Weekly/Monthly/Yearly CE, after Time Performance', () => {
  const dashboardCardRowsStart = source.indexOf('const dashboardCardRows = [');
  const dashboardCardRowsEnd = source.indexOf('\n  ];', dashboardCardRowsStart) + '\n  ];'.length;
  const dashboardCardRowsBody = source.slice(dashboardCardRowsStart, dashboardCardRowsEnd);

  assertIncludes(dashboardCardRowsBody, "label: 'Capital Efficiency'", 'A Capital Efficiency row should exist in DNA Results.');
  assertIncludes(dashboardCardRowsBody, "statCard('line', 'Daily CE', formatCapitalEfficiency(dailyPnl.capitalEfficiency)", 'Daily CE should render.');
  assertIncludes(dashboardCardRowsBody, "statCard('line', 'Weekly CE', formatCapitalEfficiency(weeklyPnl.capitalEfficiency)", 'Weekly CE should render.');
  assertIncludes(dashboardCardRowsBody, "statCard('line', 'Monthly CE', formatCapitalEfficiency(monthlyPnl.capitalEfficiency)", 'Monthly CE should render.');
  assertIncludes(dashboardCardRowsBody, "statCard('line', 'Yearly CE', formatCapitalEfficiency(yearlyPnl.capitalEfficiency)", 'Yearly CE should render.');

  const timePerformanceIndex = dashboardCardRowsBody.indexOf("label: 'Time Performance'");
  const capitalEfficiencyIndex = dashboardCardRowsBody.indexOf("label: 'Capital Efficiency'");
  assert.ok(timePerformanceIndex !== -1 && timePerformanceIndex < capitalEfficiencyIndex, 'Capital Efficiency should be the row after Time Performance, so existing rows are unmoved.');

  // No existing metric was removed or replaced — every prior row/card is still present.
  assertIncludes(dashboardCardRowsBody, "label: 'R Metrics'", 'R Metrics row is untouched.');
  assertIncludes(dashboardCardRowsBody, "label: 'Risk Metrics'", 'Risk Metrics row is untouched.');
  assertIncludes(dashboardCardRowsBody, "statCard('calendar', 'Daily P/L'", 'Daily P/L is untouched.');
});
