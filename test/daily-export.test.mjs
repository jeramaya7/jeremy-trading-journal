import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Guards Trading Mode's "🧬 Daily Export" button (src/main.js): exports
// every trade dated today as one JSON file (today's daily summary +
// sanitized trade list), without the actual screenshot image data.

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
  const openIndex = markerIndex + marker.length;
  const openChar = source[openIndex];
  if (openChar !== '{' && openChar !== '[') {
    const semicolonIndex = source.indexOf(';', openIndex);
    return source.slice(markerIndex, semicolonIndex + 1);
  }
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  let cursor = openIndex;
  while (true) {
    if (source[cursor] === openChar) depth += 1;
    else if (source[cursor] === closeChar) {
      depth -= 1;
      if (depth === 0) break;
    }
    cursor += 1;
  }
  const semicolonIndex = source.indexOf(';', cursor);
  return source.slice(markerIndex, semicolonIndex + 1);
}

// Every function exportDailyTrades() transitively depends on, extracted
// from the live source (rather than reimplemented) — same approach as
// test/manual-trade-stats.test.mjs's STATS_MATH_FUNCTIONS, plus the extra
// helpers exportDailyTrades itself needs (getActiveTrades, calculateRMultiple
// and its fallback, and exportDailyTrades).
const EXPORT_FUNCTIONS = [
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
  'calculateProtectedProfitRMultiple',
  'calculateRMultiple',
  'classifyTradeOutcome',
  'calculateWinRate',
  'getProfitFactor',
  'calculateBiggestWinner',
  'calculateBiggestLoser',
  'getTradingDayDateKey',
  'getTradeReportDate',
  'getTradeTradingDayDateKey',
  'getReportPeriodStart',
  'formatDateKey',
  'filterTradesForPeriod',
  'getEquityCurveTrades',
  'getCapitalExposureWalk',
  'calculateMaxCapitalExposure',
  'calculateCapitalEfficiency',
  'getStats',
  'getActiveTrades',
  'exportDailyTrades',
];

function makeFakeLink() {
  return { href: '', download: '', clicked: false, click() { this.clicked = true; } };
}

// Runs the real exportDailyTrades() against a fixture `trades` array, with
// Blob/URL/document stubbed just enough to capture what would have been
// downloaded, so the test exercises the actual shipped save/build logic
// instead of reimplementing it.
function runExportDailyTrades(tradesFixture, referenceDate = '2026-08-20T21:00:00.000Z') {
  const code = [
    extractConst('OUTCOME_DOLLAR_THRESHOLD'),
    extractConst('TRADING_DAY_TIME_ZONE'),
    extractConst('TRADING_DAY_RESET_HOUR'),
    extractConst('TRADE_OUTCOME_LABELS'),
    // classifyTradeOutcome's Outcome Override lookup also references this.
    extractConst('OUTCOME_OVERRIDE_LABEL_TO_KEY'),
    ...EXPORT_FUNCTIONS.map(extractFunction),
    'module.exports = { exportDailyTrades, getTradingDayDateKey };',
  ].join('\n\n');

  const capturedLinks = [];
  let capturedBlobParts = null;
  const fixedTimestamp = new Date(referenceDate).getTime();
  class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [fixedTimestamp]));
    }

    static now() {
      return fixedTimestamp;
    }
  }
  const context = {
    trades: tradesFixture,
    Date: FixedDate,
    Blob: function (parts) {
      capturedBlobParts = parts;
      return { parts };
    },
    URL: { createObjectURL: () => 'blob:mock-url', revokeObjectURL: () => {} },
    document: {
      createElement: () => {
        const link = makeFakeLink();
        capturedLinks.push(link);
        return link;
      },
    },
    module: { exports: {} },
  };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'main.js (extracted daily export)' });
  context.module.exports.exportDailyTrades();

  return {
    link: capturedLinks[0],
    payload: JSON.parse(capturedBlobParts.join('')),
    tradingDayKey: context.module.exports.getTradingDayDateKey(new FixedDate()),
  };
}

test('the Daily Export button renders only in Trading Mode, with the requested label and icon', () => {
  const tradingModeStart = source.indexOf('function renderTodayKpiStrip(todayTrades, todayStats)');
  const tradingModeEnd = source.indexOf('\nfunction ', tradingModeStart + 1);
  assert.notEqual(tradingModeStart, -1, 'renderTodayKpiStrip should exist.');
  const tradingModeBody = source.slice(tradingModeStart, tradingModeEnd);
  assertIncludes(tradingModeBody, 'id="dailyExport"', 'A Daily Export button should render in the Today KPI strip (Trading Mode only).');
  assertIncludes(tradingModeBody, '🧬 Daily Export', 'The button should use the requested label and icon.');

  // Dashboard Mode's equivalent (renderHeroStatsRow) must not gain this
  // button — it is Trading-Mode-only, per the request.
  const heroRowStart = source.indexOf('function renderHeroStatsRow(stats)');
  const heroRowEnd = source.indexOf('\nfunction ', heroRowStart + 1);
  const heroRowBody = source.slice(heroRowStart, heroRowEnd);
  assert.equal(heroRowBody.includes('dailyExport'), false, 'Dashboard Mode\'s hero stats row should not render the Daily Export button.');
});

test('the Daily Export button is wired to exportDailyTrades, optionally (it only exists in Trading Mode)', () => {
  assertIncludes(
    source,
    "document.querySelector('#dailyExport')?.addEventListener('click', exportDailyTrades, { signal });",
    'Daily Export should be wired with optional chaining, same pattern as other mode-conditional buttons (e.g. #connectCTrader).',
  );
});

test('exportDailyTrades downloads a file named for the current New York trading day', () => {
  const { link, tradingDayKey } = runExportDailyTrades([]);
  assert.equal(link.download, `DNA-Daily-Export-${tradingDayKey}.json`, 'Filename should use the current 5 PM New York trading-day date.');
  assert.equal(link.clicked, true, 'The download link should be clicked to trigger the download.');
});

test('exportDailyTrades only includes trades assigned to the current trading day and includes its summary', () => {
  const initialRun = runExportDailyTrades([]);
  const todayKey = initialRun.tradingDayKey;
  const yesterday = new Date(`${todayKey}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayKey = yesterday.toISOString().slice(0, 10);

  const todayTrade = {
    id: 'today-1', date: todayKey, symbol: 'EURUSD', direction: 'Long',
    entry: 1.1000, exit: 1.1010, size: 10000, fees: 0,
  };
  const yesterdayTrade = {
    id: 'yesterday-1', date: yesterdayKey, symbol: 'GBPUSD', direction: 'Long',
    entry: 1.2000, exit: 1.2050, size: 10000, fees: 0,
  };

  const { payload } = runExportDailyTrades([todayTrade, yesterdayTrade]);

  assert.equal(payload.trades.length, 1, 'Only the trade dated today should be included.');
  assert.equal(payload.trades[0].id, 'today-1');
  assert.ok(payload.summary, 'A daily summary object should be included.');
  assert.equal(payload.summary.tradeCount, 1, 'The summary should reflect only today\'s trades, matching the Today KPI strip.');
  assert.equal(payload.date, todayKey, 'The payload date should be the current New York trading-day date.');
});

test('exportDailyTrades applies the exact EDT cutoff to imported close timestamps', () => {
  const trades = [
    { id: 'before', closeTime: '2026-08-20T20:59:59.999Z', symbol: 'AAPL', netProfitLoss: 1 },
    { id: 'open', closeTime: '2026-08-20T21:00:00.000Z', symbol: 'AAPL', netProfitLoss: 2 },
    { id: 'close', closeTime: '2026-08-21T20:59:59.999Z', symbol: 'AAPL', netProfitLoss: 3 },
    { id: 'next', closeTime: '2026-08-21T21:00:00.000Z', symbol: 'AAPL', netProfitLoss: 4 },
  ];
  const { payload, link } = runExportDailyTrades(trades, '2026-08-21T20:59:59.999Z');

  assert.deepEqual(payload.trades.map((trade) => trade.id), ['open', 'close']);
  assert.equal(payload.date, '2026-08-21');
  assert.equal(link.download, 'DNA-Daily-Export-2026-08-21.json');
});

test('exportDailyTrades includes every saved trade-card field plus outcome, P/L, and R — but never the screenshot image data', () => {
  const { tradingDayKey: todayKey } = runExportDailyTrades([]);
  const tradeWithScreenshot = {
    id: 'a', date: todayKey, symbol: 'XAUUSD', direction: 'Long',
    entry: 2000, exit: 2010, size: 1, fees: 0, stopLoss: 1990,
    notes: 'Good entry off the 15m structure', tags: 'gap, A+',
    timeframe: '5m', setup: 'Trend', state: 'Trending',
    tradeManagement: 'Trail Stop', protected: 'Yes',
    grade: 'A', closeReason: 'Trailed Stop', lossReason: '',
    screenshot: { dataUrl: 'data:image/png;base64,verylongimagedatahere', name: 'chart.png', type: 'image/png', size: 12345 },
  };

  const { payload } = runExportDailyTrades([tradeWithScreenshot]);
  const exported = payload.trades[0];

  // Every saved trade-card field survives the export.
  for (const field of ['notes', 'tags', 'timeframe', 'setup', 'state', 'tradeManagement', 'protected', 'grade', 'closeReason']) {
    assert.equal(exported[field], tradeWithScreenshot[field], `${field} should be included in the export exactly as saved.`);
  }

  // Derived fields the trade card shows but never stores. XAUUSD infers the
  // 100oz gold contract size (see getTradeContractSize), so P/L here is
  // (2010 - 2000) * 1 * 100 = 1000, same as the trade card itself computes.
  assert.equal(exported.outcome, 'Win', 'Outcome should be computed via the shared classifier.');
  assert.equal(exported.pnl, 1000, 'P/L should be computed the same way the trade card does.');
  assert.equal(typeof exported.rMultiple, 'number', 'R multiple should be computed and included.');

  // Screenshot: reference only, never the actual image data.
  assert.equal(exported.screenshot.attached, true, 'Screenshot reference should note that a screenshot is attached.');
  assert.equal(exported.screenshot.name, 'chart.png', 'Screenshot reference should include the filename.');
  assert.equal(exported.screenshot.dataUrl, undefined, 'The screenshot dataUrl (actual image data) must never be included in the export.');
  assert.equal(JSON.stringify(payload).includes('verylongimagedatahere'), false, 'The raw image data must not appear anywhere in the exported JSON.');
});

test('exportDailyTrades marks trades with no screenshot as not attached, without inventing a screenshot object', () => {
  const { tradingDayKey: todayKey } = runExportDailyTrades([]);
  const tradeWithoutScreenshot = { id: 'b', date: todayKey, symbol: 'EURUSD', direction: 'Long', entry: 1, exit: 1, size: 1, fees: 0 };

  const { payload } = runExportDailyTrades([tradeWithoutScreenshot]);
  assert.deepEqual(payload.trades[0].screenshot, { attached: false }, 'A trade with no screenshot should export { attached: false }, nothing else.');
});

test('exportDailyTrades produces a valid empty export on a day with no trades logged yet', () => {
  const { payload } = runExportDailyTrades([]);
  assert.deepEqual(payload.trades, [], 'No trades today should still produce a valid (empty) trades array.');
  assert.equal(payload.summary.tradeCount, 0, 'Summary should reflect zero trades rather than throwing.');
});
