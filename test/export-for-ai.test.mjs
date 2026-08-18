import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

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
  'getReportPeriodStart',
  'getTradeReportDate',
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

function createExportContext(tradesFixture, timeframe = 'week') {
  const code = [
    extractConst('DNA_TIMEFRAME_OPTIONS'),
    extractConst('MARKET_STATE_OPTIONS'),
    extractConst('FRIENDLY_ASSET_NAMES'),
    extractConst('TIME_OF_DAY_ORDER'),
    extractConst('OUTCOME_DOLLAR_THRESHOLD'),
    extractConst('TRADE_OUTCOME_LABELS'),
    extractConst('OUTCOME_OVERRIDE_LABEL_TO_KEY'),
    ...EXPORT_FOR_AI_FUNCTIONS.map(extractFunction),
    'module.exports = { buildExportForAiMarkdown, exportForAiMarkdown, getStats, filterTradesForPeriod, getDnaResultsDateRange, formatExportDateRange };',
  ].join('\n\n');

  const capturedLinks = [];
  let capturedBlobParts = null;
  const context = {
    trades: tradesFixture,
    dnaResultsTimeframe: timeframe,
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

function buildMarkdown(tradesFixture, timeframe = 'week') {
  const { exports } = createExportContext(tradesFixture, timeframe);
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
  assertIncludes(source, 'Request Analysis', 'The DNA Doctor panel should use the new Request Analysis label.');
  assertIncludes(source, "document.querySelector('#runDnaDoctor')?.addEventListener('click', exportForAiMarkdown, { signal });", 'The Doctor button should call the markdown export function.');
  assertIncludes(source, 'function buildExportForAiMarkdown(', 'The markdown builder should exist for Step 1.');
});

test('buildExportForAiMarkdown uses the selected DNA Results timeframe and includes required sections', () => {
  const markdown = buildMarkdown(realisticTrades());

  assertIncludes(markdown, '# DNA Export for AI', 'The export should have a clear title.');
  assertIncludes(markdown, '## AI Coaching Instructions', 'The export should include built-in coaching instructions.');
  assertIncludes(markdown, 'Timeframe: WTD (week)', 'The export should use the selected DNA timeframe.');
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
  assert.equal(markdown.includes('/api/dna-doctor'), false, 'The markdown should not include the DNA Doctor API path.');
  assert.equal(markdown.includes('dnaDoctorState'), false, 'The markdown should not include DNA Doctor UI output/state.');
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
  assertIncludes(markdown, '| Gold | 1 | 100.0% | $500.00 | ∞ | $500.00 | - |', 'Asset analytics should match the selected trade calculations and existing friendly asset names.');
  assertIncludes(markdown, '| EURUSD | 1 | 0.0% | -$10.00 | 0.00 | - | -$10.00 |', 'Asset analytics should include the selected losing asset.');
});

test('Export for AI markdown has clean single sections and timeframe changes alter the export', () => {
  const tradesFixture = realisticTrades();
  const weekMarkdown = buildMarkdown(tradesFixture, 'week');
  const allMarkdown = buildMarkdown(tradesFixture, 'all');

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
  assertIncludes(allMarkdown, 'Timeframe: Beginning (all)', 'All-time export should identify Beginning.');
  assertIncludes(allMarkdown, 'Old setup', 'All-time export should include earlier trades.');
  assert.equal(weekMarkdown.includes('Old setup'), false, 'WTD export should not include earlier trades.');
  assert.ok(weekMarkdown.split('\n').every((line) => !/\s+$/.test(line)), 'Markdown lines should not have trailing whitespace.');
});

test('exportForAiMarkdown downloads a sensible markdown filename for the selected timeframe and date range', () => {
  const runner = createExportContext(realisticTrades(), 'week');
  runner.exports.exportForAiMarkdown();
  const { link, markdown } = runner.getCapturedDownload();

  assert.equal(link.clicked, true, 'The download link should be clicked.');
  assert.equal(link.href, 'blob:mock-ai-export', 'The download should use the Blob URL pattern.');
  assert.equal(link.download, 'DNA-AI-Export-week-2026-08-17_to_2026-08-18.md', 'The filename should include timeframe and date range.');
  assert.ok(markdown.startsWith('# DNA Export for AI'), 'The downloaded markdown should be the AI export content.');
});
