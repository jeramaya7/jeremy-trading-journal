import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const serverSource = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

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

const EXPORT_FOR_AI_FUNCTIONS = [
  'currency',
  'toOptionalNumber',
  'formatPercent',
  'formatRiskPercent',
  'isCTraderImportedTrade',
  'getTradeDisplaySymbol',
  'firstReadableTradeSymbol',
  'isStopLossCloseReason',
  'getStopLossHitPrice',
  'getActiveStopLoss',
  'calculateOriginalRiskDollars',
  'calculateRiskDollars',
  'getTradeContractSize',
  'calculateRiskPercent',
  'calculateProtectedProfitRMultiple',
  'calculateRMultiple',
  'calculatePnl',
  'classifyTradeOutcome',
  'calculateWinRate',
  'getTradingDayDateKey',
  'getReportPeriodStart',
  'getTradeReportDate',
  'getTradeTradingDayDateKey',
  'filterTradesForPeriod',
  'calculatePnlForPeriod',
  'getPnlReports',
  'calculateBiggestWinner',
  'calculateBiggestLoser',
  'getEquityCurveTrades',
  'getCapitalExposureWalk',
  'calculateMaxCapitalExposure',
  'calculateCapitalEfficiency',
  'getProfitFactor',
  'formatProfitFactor',
  'getSetupAnalytics',
  'compareSetupAnalyticsRows',
  'getFriendlyAssetName',
  'getAssetAnalytics',
  'compareAssetAnalyticsRows',
  'getTimeOfDayBucket',
  'buildSessionStats',
  'getTimeOfDayAnalytics',
  'getSessionVerdict',
  'getMarketStateAnalytics',
  'getStats',
  'calculateRoiPercent',
  'calculateAccountBalanceAtPeriodStart',
  'getActiveTrades',
  'formatDateKey',
  'getDnaResultsReferenceDate',
  'getDnaTimeframeLabel',
  'getAiExportTimeframeLabel',
  'isValidAiExportTimeframe',
  'setAiExportTimeframe',
  'addDaysToDateKey',
  'filterTradesForTradingDayRange',
  'getAiExportSelection',
  'getAiExportDateRange',
  'getDnaResultsDateRange',
  'formatExportDateRange',
  'formatExportMetric',
  'formatExportText',
  'formatMarkdownCell',
  'markdownTable',
  'getRealizedLossSummary',
  'buildExportForAiMarkdown',
  'exportForAiMarkdown',
];

function createExportContext(tradesFixture, exportTimeframe = 'week', customStart = '', customEnd = '', dnaTimeframe = 'all') {
  const code = [
    extractConst('DNA_TIMEFRAME_OPTIONS'),
    extractConst('AI_EXPORT_TIMEFRAME_OPTIONS'),
    extractConst('DEFAULT_AI_EXPORT_TIMEFRAME'),
    extractConst('MARKET_STATE_OPTIONS'),
    extractConst('FRIENDLY_ASSET_NAMES'),
    extractConst('TIME_OF_DAY_ORDER'),
    extractConst('OUTCOME_DOLLAR_THRESHOLD'),
    extractConst('TRADING_DAY_TIME_ZONE'),
    extractConst('TRADING_DAY_RESET_HOUR'),
    extractConst('TRADE_OUTCOME_LABELS'),
    extractConst('OUTCOME_OVERRIDE_LABEL_TO_KEY'),
    ...EXPORT_FOR_AI_FUNCTIONS.map(extractFunction),
    'module.exports = { buildExportForAiMarkdown, exportForAiMarkdown, getStats, filterTradesForPeriod, filterTradesForTradingDayRange, getAiExportSelection, getAiExportDateRange, getDnaResultsDateRange, formatExportDateRange };',
  ].join('\n\n');

  const capturedLinks = [];
  let capturedBlobParts = null;
  const context = {
    trades: tradesFixture,
    dnaResultsTimeframe: dnaTimeframe,
    selectedAiExportTimeframe: exportTimeframe,
    aiExportCustomStartDate: customStart,
    aiExportCustomEndDate: customEnd,
    startingAccountBalance: 5600,
    setupAnalyticsSort: { key: 'netPnl', direction: 'desc' },
    window: {},
    Intl,
    Date,
    Number,
    String,
    Math,
    Map,
    Set,
    Blob: function (parts) {
      capturedBlobParts = parts;
      return { parts };
    },
    URL: { createObjectURL: () => 'blob:mock-ai-export', revokeObjectURL: () => {} },
    document: {
      createElement: () => {
        const link = { href: '', download: '', clicked: false, click() { this.clicked = true; } };
        capturedLinks.push(link);
        return link;
      },
    },
    module: { exports: {} },
  };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'main.js (extracted Export for AI)' });
  return {
    context,
    exports: context.module.exports,
    getCapturedDownload: () => ({
      link: capturedLinks[0],
      markdown: capturedBlobParts ? capturedBlobParts.join('') : '',
    }),
  };
}

function buildMarkdown(tradesFixture, timeframe = 'week', customStart = '', customEnd = '', dnaTimeframe = 'all') {
  const { exports } = createExportContext(tradesFixture, timeframe, customStart, customEnd, dnaTimeframe);
  return exports.buildExportForAiMarkdown(new Date('2026-08-18T12:00:00'));
}

function realisticTrades() {
  return [
    {
      id: 'week-win',
      date: '2026-08-18',
      symbol: 'XAUUSD',
      direction: 'Long',
      entry: 2000,
      exit: 2005,
      size: 1,
      fees: 0,
      stopLoss: 1995,
      setup: 'Momentum / Breakout',
      state: 'Trending',
      timeframe: '5m',
      openTime: '2026-08-18T14:00:00.000Z',
      tradeManagement: 'Trail Stop',
      protected: 'Yes',
      grade: 'A',
      closeReason: 'Target',
      tags: 'clean',
      notes: 'Followed the plan.',
      screenshot: { dataUrl: 'data:image/png;base64,secret-image-data', name: 'chart.png' },
    },
    {
      id: 'week-loss',
      date: '2026-08-17',
      symbol: 'EURUSD',
      direction: 'Long',
      entry: 1.1,
      exit: 1.099,
      size: 10000,
      fees: 0,
      stopLoss: 1.098,
      setup: 'Retrace / Bounce',
      state: 'Channel',
      timeframe: '1m',
      openTime: '2026-08-17T20:00:00.000Z',
      closeReason: 'Stop Loss',
      lossReason: 'Early entry',
      notes: 'Chased a little.',
    },
    {
      id: 'old-win',
      date: '2026-08-10',
      symbol: 'GBPUSD',
      direction: 'Long',
      entry: 1.2,
      exit: 1.21,
      size: 10000,
      fees: 0,
      stopLoss: 1.195,
      setup: 'Old setup',
      state: 'Compressed',
      timeframe: '15m',
      openTime: '2026-08-10T13:00:00.000Z',
      notes: 'Previous week winner.',
    },
  ];
}

function countOccurrences(text, value) {
  return text.split(value).length - 1;
}

test('DNA Doctor Request Analysis button is wired to the markdown download function', () => {
  assert.equal(source.includes('id="exportForAi"'), false, 'The temporary Export for AI hero button should be removed.');
  assertIncludes(source, 'Download for AI', 'The DNA Doctor panel should use the new download label.');
  assertIncludes(source, 'id="requestAnalysis"', 'The Doctor button should use the Request Analysis id.');
  assertIncludes(source, "document.querySelector('#requestAnalysis')?.addEventListener('click', exportForAiMarkdown, { signal });", 'The Doctor button should call the markdown export function.');
  assertIncludes(source, 'id="aiExportTimeframe"', 'The export should have its own timeframe selector.');
  assertIncludes(source, "document.querySelector('#aiExportTimeframe')?.addEventListener('change'", 'The export timeframe selector should update only export state.');
  assertIncludes(source, 'function buildExportForAiMarkdown(', 'The markdown builder should exist for Step 1.');
});

test('old DNA Doctor API scan implementation is removed while Request Analysis remains', () => {
  assert.equal(serverSource.includes(['/api', ['dna', 'doctor'].join('-')].join('/')), false, 'The old Doctor API route should be removed.');
  assert.equal(serverSource.includes(['api.', 'openai', '.com/v1/', 'responses'].join('')), false, 'The old server-side OpenAI request should be removed.');
  assert.equal(source.includes(['run', 'Dna', 'Doctor'].join('')), false, 'The old frontend scan button id should be removed.');
  assert.equal(source.includes(['build', 'Dna', 'Scan', 'Payload'].join('')), false, 'The old frontend scan payload builder should be removed.');
  assert.equal(source.includes(['render', 'Dna', 'Doctor', 'Report'].join('')), false, 'The old frontend report renderer should be removed.');
  assert.equal(source.includes(['DNA', 'DOCTOR', 'LOADING', 'STEPS'].join('_')), false, 'The old frontend loading flow should be removed.');
  assert.equal(styles.includes(['dna', 'doctor', 'loading'].join('-')), false, 'The old loading styles should be removed.');
  assert.equal(styles.includes(['dna', 'doctor', 'report'].join('-')), false, 'The old report styles should be removed.');
  assertIncludes(source, '<h2 class="dna-doctor-title">DNA Doctor</h2>', 'The DNA Doctor section should remain.');
  assertIncludes(source, 'Download for AI', 'The Request Analysis download button should remain.');
});

test('buildExportForAiMarkdown uses the selected AI export timeframe and includes required sections', () => {
  const markdown = buildMarkdown(realisticTrades());

  assertIncludes(markdown, '# DNA Export for AI', 'The export should have a clear title.');
  assertIncludes(markdown, '## AI Coaching Instructions', 'The export should include built-in coaching instructions.');
  assertIncludes(markdown, 'provide an overall assessment, proven strengths, proven weaknesses only when supported by the data, important patterns, and practical next steps', 'The coaching prompt should tell the AI what analysis to provide.');
  assertIncludes(markdown, 'Never invent a weakness just because every trader is expected to have one.', 'The coaching prompt should forbid invented weaknesses.');
  assertIncludes(markdown, 'Distinguish clearly between statistically supported findings and observations based on small samples.', 'The coaching prompt should separate proven findings from small samples.');
  assertIncludes(markdown, 'Judge profitability using Net P/L, Profit Factor, consistency, and supporting metrics together.', 'The coaching prompt should define profitability judgment.');
  assertIncludes(markdown, 'Use realized trading results and realized closed-trade losses rather than theoretical risk assumptions.', 'The coaching prompt should emphasize realized results.');
  assertIncludes(markdown, 'Do not impose generic textbook trading rules when the trader\'s actual results do not support them.', 'The coaching prompt should reject unsupported textbook rules.');
  assertIncludes(markdown, 'Timeframe: WTD (week)', 'The export should use the selected AI export timeframe.');
  assertIncludes(markdown, 'Selected date range: 2026-08-17 to 2026-08-18', 'The export should include the actual selected date range.');
  assertIncludes(markdown, '## DNA Results', 'DNA Results should be included.');
  assertIncludes(markdown, '## Risk / Realized-Loss Summary', 'Risk / realized-loss summary should be included.');
  assertIncludes(markdown, '## Setup Analytics', 'Setup analytics should be included.');
  assertIncludes(markdown, '## Asset Analytics', 'Asset analytics should be included.');
  assertIncludes(markdown, '## Trading Session Analytics', 'Trading Session analytics should be included.');
  assertIncludes(markdown, '## Market State Analytics', 'Market State analytics should be included.');
  assertIncludes(markdown, '## Individual Trades + Annotations', 'Individual trades and annotations should be included.');
  assertIncludes(markdown, 'Momentum / Breakout', 'A trade from the selected timeframe should be included.');
  assertIncludes(markdown, 'Followed the plan.', 'Trade annotations should be included.');
  assertIncludes(markdown, 'Chased a little.', 'Loss notes should be included.');
  assert.equal(markdown.includes('Old setup'), false, 'Trades outside the selected timeframe should be excluded.');
});

test('buildExportForAiMarkdown excludes forbidden fields and screenshot image data', () => {
  const markdown = buildMarkdown([
    {
      id: 'a',
      date: '2026-08-18',
      symbol: 'XAUUSD',
      direction: 'Long',
      entry: 2000,
      exit: 2005,
      size: 1,
      fees: 0,
      setup: 'Momentum / Breakout',
      state: 'Trending',
      screenshot: { dataUrl: 'data:image/png;base64,secret-image-data', name: 'chart.png' },
    },
  ]);

  assert.equal(markdown.includes('Average R'), false, 'The markdown should not include Average R.');
  assert.equal(markdown.includes('Capital Efficiency'), false, 'The markdown should not include Capital Efficiency.');
  assert.equal(markdown.includes('CE'), false, 'The markdown should not include CE.');
  assert.equal(markdown.includes('secret-image-data'), false, 'The markdown should not include screenshot image bytes.');
  assert.equal(markdown.includes(['/api', ['dna', 'doctor'].join('-')].join('/')), false, 'The markdown should not include the old Doctor API path.');
  assert.equal(markdown.includes(['dnaDoctor', 'State'].join('')), false, 'The markdown should not include old Doctor UI output/state.');
  assert.equal(markdown.includes('Biggest Risk Used'), false, 'The realized-loss summary should not include theoretical biggest risk.');
  assert.equal(markdown.includes('Mean Risk $'), false, 'The realized-loss summary should not include mean risk dollars.');
  assert.equal(markdown.includes('Mean Risk %'), false, 'The realized-loss summary should not include mean risk percent.');
  assertIncludes(markdown, 'Screenshot: Attached (chart.png)', 'The export can include a screenshot reference.');
});

test('buildExportForAiMarkdown numbers match existing DNA Results calculations', () => {
  const tradesFixture = realisticTrades();
  const { exports } = createExportContext(tradesFixture, 'week');
  const referenceDate = new Date('2026-08-18T12:00:00');
  const selectedTrades = exports.filterTradesForPeriod(tradesFixture, 'week', referenceDate);
  const stats = exports.getStats(selectedTrades);
  const markdown = exports.buildExportForAiMarkdown(referenceDate);

  assertIncludes(markdown, `| Total Trades | ${stats.tradeCount} |`, 'Total Trades should match getStats().');
  assertIncludes(markdown, `| Net P/L | ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(stats.totalPnl)} |`, 'Net P/L should match getStats().');
  assertIncludes(markdown, `| Profit Factor | ${stats.profitFactor.toFixed(2)} |`, 'Profit Factor should match getStats().');
  assertIncludes(markdown, '| Total Realized Loss | $10.00 |', 'Realized losses should use closed losing P/L.');
  assertIncludes(markdown, '| Mean Realized Loss | $10.00 |', 'Mean realized loss should use actual closed losing P/L.');
  assertIncludes(markdown, '| Largest Realized Loss | -$10.00 |', 'Largest realized loss should use actual closed losing P/L.');
  assertIncludes(markdown, '| Gold | 1 | 100.0% | $500.00 | ∞ | $500.00 | - |', 'Asset analytics should match the selected trade calculations and existing friendly asset names.');
  assertIncludes(markdown, '| EURUSD | 1 | 0.0% | -$10.00 | 0.00 | - | -$10.00 |', 'Asset analytics should include the selected losing asset.');
});

test('Today AI export after 5 PM New York can correctly return zero trades', () => {
  const tradesFixture = [
    { id: 'prior', closeTime: '2026-08-20T20:59:59.999Z', symbol: 'AAPL', direction: 'Long', netProfitLoss: 1, notes: 'Prior complete trading day' },
  ];
  const { exports } = createExportContext(tradesFixture, 'today');
  const markdown = exports.buildExportForAiMarkdown(new Date('2026-08-20T21:30:00.000Z'));

  assertIncludes(markdown, 'Timeframe: Today (today)', 'The selected Today timeframe should be visible.');
  assertIncludes(markdown, 'Selected date range: 2026-08-21 to 2026-08-21', 'Today should mean the current DNA trading day after the cutoff.');
  assertIncludes(markdown, '| Total Trades | 0 |', 'Today can correctly contain zero trades after the 5 PM New York reset.');
  assert.equal(markdown.includes('Prior complete trading day'), false, 'Today must not include trades from the prior complete trading day.');
});

test('Yesterday AI export returns the immediately previous complete DNA trading day', () => {
  const tradesFixture = [
    { id: 'previous-open', closeTime: '2026-08-19T21:00:00.000Z', symbol: 'AAPL', direction: 'Long', netProfitLoss: 1, notes: 'Previous day open' },
    { id: 'previous-close', closeTime: '2026-08-20T20:59:59.999Z', symbol: 'MSFT', direction: 'Long', netProfitLoss: 2, notes: 'Previous day close' },
    { id: 'current-open', closeTime: '2026-08-20T21:00:00.000Z', symbol: 'TSLA', direction: 'Long', netProfitLoss: 3, notes: 'Current day open' },
  ];
  const { exports } = createExportContext(tradesFixture, 'yesterday');
  const markdown = exports.buildExportForAiMarkdown(new Date('2026-08-20T21:30:00.000Z'));

  assertIncludes(markdown, 'Timeframe: Yesterday (yesterday)', 'The selected Yesterday timeframe should be visible.');
  assertIncludes(markdown, 'Selected date range: 2026-08-20 to 2026-08-20', 'Yesterday should be the prior complete DNA trading day.');
  assertIncludes(markdown, 'Previous day open', 'Yesterday should include the first trade in the prior full trading day.');
  assertIncludes(markdown, 'Previous day close', 'Yesterday should include the last trade in the prior full trading day.');
  assert.equal(markdown.includes('Current day open'), false, 'Yesterday must not include the current trading day.');
});

test('Today AI export uses the exact 5 PM New York boundary and trading-day date label', () => {
  const tradesFixture = [
    { id: 'before', closeTime: '2026-08-20T20:59:59.999Z', symbol: 'AAPL', direction: 'Long', netProfitLoss: 1, notes: 'Prior trading day' },
    { id: 'inside', closeTime: '2026-08-20T21:00:00.000Z', symbol: 'MSFT', direction: 'Long', netProfitLoss: 2, notes: 'Current trading day' },
    { id: 'close', closeTime: '2026-08-21T20:59:59.999Z', symbol: 'TSLA', direction: 'Long', netProfitLoss: 3, notes: 'Current trading day close' },
    { id: 'next', closeTime: '2026-08-21T21:00:00.000Z', symbol: 'NVDA', direction: 'Long', netProfitLoss: 4, notes: 'Next trading day' },
  ];
  const { exports } = createExportContext(tradesFixture, 'today');
  const markdown = exports.buildExportForAiMarkdown(new Date('2026-08-21T20:59:59.999Z'));

  assertIncludes(markdown, 'Timeframe: Today (today)', 'The selected Today timeframe should remain visible.');
  assertIncludes(markdown, 'Selected date range: 2026-08-21 to 2026-08-21', 'The date range should use the trading-day label.');
  assertIncludes(markdown, 'Current trading day', 'The trade at the opening cutoff should be included.');
  assertIncludes(markdown, 'Current trading day close', 'The trade at the closing edge should be included.');
  assert.equal(markdown.includes('Prior trading day'), false, 'The trade before the opening cutoff should be excluded.');
  assert.equal(markdown.includes('Next trading day'), false, 'The trade at the next opening cutoff should be excluded.');
});

test('WTD and MTD AI exports use the independent export selector with trading-day boundaries', () => {
  const tradesFixture = [
    { id: 'july', closeTime: '2026-07-31T20:59:59.999Z', symbol: 'AAPL', direction: 'Long', netProfitLoss: 1, notes: 'July trading day' },
    { id: 'month-open', closeTime: '2026-07-31T21:00:00.000Z', symbol: 'MSFT', direction: 'Long', netProfitLoss: 2, notes: 'August month open' },
    { id: 'prior-week', closeTime: '2026-08-14T20:59:59.999Z', symbol: 'TSLA', direction: 'Long', netProfitLoss: 3, notes: 'Prior week trade' },
    { id: 'week-open', closeTime: '2026-08-17T21:00:00.000Z', symbol: 'NVDA', direction: 'Long', netProfitLoss: 4, notes: 'Current week trade' },
  ];
  const weekRunner = createExportContext(tradesFixture, 'week');
  const monthRunner = createExportContext(tradesFixture, 'month');
  const referenceDate = new Date('2026-08-20T20:00:00.000Z');
  const weekMarkdown = weekRunner.exports.buildExportForAiMarkdown(referenceDate);
  const monthMarkdown = monthRunner.exports.buildExportForAiMarkdown(referenceDate);

  assertIncludes(weekMarkdown, 'Timeframe: WTD (week)', 'WTD should be available in the export selector.');
  assertIncludes(weekMarkdown, 'Selected date range: 2026-08-17 to 2026-08-20', 'WTD should start from the Monday trading-day label.');
  assertIncludes(weekMarkdown, 'Current week trade', 'WTD should include current-week trades.');
  assert.equal(weekMarkdown.includes('Prior week trade'), false, 'WTD must not include trades before the week start.');
  assertIncludes(monthMarkdown, 'Timeframe: MTD (month)', 'MTD should be available in the export selector.');
  assertIncludes(monthMarkdown, 'Selected date range: 2026-08-01 to 2026-08-20', 'MTD should start from the month trading-day label.');
  assertIncludes(monthMarkdown, 'August month open', 'MTD should include trades from the first August trading day.');
  assertIncludes(monthMarkdown, 'Prior week trade', 'MTD should include prior-week trades in the same month.');
  assert.equal(monthMarkdown.includes('July trading day'), false, 'MTD must not include the previous month.');
});

test('Custom AI export uses explicit inclusive trading-day start and end dates', () => {
  const tradesFixture = [
    { id: 'before', date: '2026-08-16', symbol: 'AAPL', direction: 'Long', netProfitLoss: 1, notes: 'Before custom range' },
    { id: 'start', date: '2026-08-17', symbol: 'MSFT', direction: 'Long', netProfitLoss: 2, notes: 'Custom start trade' },
    { id: 'end', date: '2026-08-18', symbol: 'TSLA', direction: 'Long', netProfitLoss: 3, notes: 'Custom end trade' },
    { id: 'after', date: '2026-08-19', symbol: 'NVDA', direction: 'Long', netProfitLoss: 4, notes: 'After custom range' },
  ];
  const { exports } = createExportContext(tradesFixture, 'custom', '2026-08-17', '2026-08-18');
  const markdown = exports.buildExportForAiMarkdown(new Date('2026-08-20T12:00:00.000Z'));

  assertIncludes(markdown, 'Timeframe: Custom (custom)', 'Custom should be available in the export selector.');
  assertIncludes(markdown, 'Selected date range: 2026-08-17 to 2026-08-18', 'Custom should show the explicit selected range.');
  assertIncludes(markdown, 'Custom start trade', 'Custom should include the start date.');
  assertIncludes(markdown, 'Custom end trade', 'Custom should include the end date.');
  assert.equal(markdown.includes('Before custom range'), false, 'Custom must exclude trades before the selected start.');
  assert.equal(markdown.includes('After custom range'), false, 'Custom must exclude trades after the selected end.');
});

test('Export for AI markdown has clean single sections and timeframe changes alter the export', () => {
  const tradesFixture = realisticTrades();
  const weekMarkdown = buildMarkdown(tradesFixture, 'week');
  const todayMarkdown = buildMarkdown(tradesFixture, 'today');

  [
    '## AI Coaching Instructions',
    '## Selected Timeframe',
    '## DNA Results',
    '## Risk / Realized-Loss Summary',
    '## Setup Analytics',
    '## Asset Analytics',
    '## Trading Session Analytics',
    '## Market State Analytics',
    '## Individual Trades + Annotations',
  ].forEach((section) => {
    assert.equal(countOccurrences(weekMarkdown, section), 1, `${section} should appear exactly once.`);
  });

  assertIncludes(weekMarkdown, 'Timeframe: WTD (week)', 'Week export should identify WTD.');
  assertIncludes(todayMarkdown, 'Timeframe: Today (today)', 'Today export should identify Today.');
  assertIncludes(weekMarkdown, 'Chased a little.', 'WTD export should include the prior trading day inside the week.');
  assert.equal(todayMarkdown.includes('Chased a little.'), false, 'Today export should not include prior trading days from the same week.');
  assert.equal(weekMarkdown.includes('Old setup'), false, 'WTD export should not include earlier weeks.');
  assert.ok(weekMarkdown.split('\n').every((line) => !/\s+$/.test(line)), 'Markdown lines should not have trailing whitespace.');
});

test('exportForAiMarkdown downloads a sensible markdown filename for the selected timeframe and date range', () => {
  const tradesFixture = realisticTrades();
  const runner = createExportContext(tradesFixture, 'week');
  runner.exports.exportForAiMarkdown();
  const { link, markdown } = runner.getCapturedDownload();
  const selection = runner.exports.getAiExportSelection(new Date(), tradesFixture);
  const expectedRange = runner.exports
    .formatExportDateRange(runner.exports.getAiExportDateRange(selection))
    .replace(/\s+to\s+/g, '_to_')
    .replace(/[^a-z0-9_-]+/gi, '-');

  assert.equal(link.clicked, true, 'The download link should be clicked.');
  assert.equal(link.href, 'blob:mock-ai-export', 'The download should use the Blob URL pattern.');
  assert.equal(link.download, `DNA-AI-Export-week-${expectedRange}.md`, 'The filename should include the current trading timeframe and date range.');
  assert.ok(markdown.startsWith('# DNA Export for AI'), 'The downloaded markdown should be the AI export content.');
});
