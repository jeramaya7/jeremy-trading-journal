import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const serverSource = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');

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
  const closeChar = openChar === '[' ? ']' : '}';
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

function buildPayload(trades) {
  const code = [
    extractConst('DNA_DOCTOR_TRADE_FIELDS'),
    extractFunction('buildDnaDoctorTradePayload'),
    extractFunction('buildDnaScanPayload'),
    'module.exports = { buildDnaScanPayload };',
  ].join('\n\n');

  const context = {
    module: { exports: {} },
    getStats: () => ({
      tradeCount: trades.length,
      winRate: 50,
      totalPnl: 10,
      averageWin: 20,
      averageLoss: -10,
      averageR: 0.5,
      profitFactor: 2,
      biggestWinner: 20,
      biggestLoser: -10,
      protectedPercent: 75,
      averageRiskDollars: 5,
      averageRiskPercent: 1,
      biggestRisk: 15,
      capitalEfficiency: 1.25,
    }),
    getAssetAnalytics: () => [],
    getSetupAnalytics: () => [],
    getTimeOfDayAnalytics: () => [],
  };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'main.js (extracted DNA Doctor payload)' });
  return context.module.exports.buildDnaScanPayload(trades);
}

test('DNA Doctor payload includes selected trades without screenshots or invented fields', () => {
  const payload = buildPayload([
    {
      id: 'trade-1',
      date: '2026-08-08',
      openTime: '2026-08-08T13:00:00.000Z',
      closeTime: '2026-08-08T13:15:00.000Z',
      symbol: 'XAUUSD',
      brokerSymbol: 'Gold',
      direction: 'Long',
      setup: 'Trend Continuation',
      state: 'Trending',
      timeframe: '5m',
      entry: 2400,
      exit: 2410,
      size: 1,
      fees: 2,
      stopLoss: 2395,
      adjustedStopLoss: 2402,
      takeProfit: 2420,
      adjustedTakeProfit: 2412,
      accountSize: 5000,
      riskPercent: 1,
      protected: 'Yes',
      tradeManagement: 'Trail Stop',
      grade: 'A',
      closeReason: 'Take Profit',
      lossReason: '',
      outcomeOverride: 'Win',
      tags: 'gold, trend',
      notes: 'Followed the plan.',
      emotion: 'Patient',
      screenshot: { dataUrl: 'data:image/png;base64,abc' },
      sourceDealId: 123,
    },
  ]);

  assert.equal(payload.tradeCount, 1);
  assert.equal(payload.protectedPercent, 75);
  assert.equal(payload.biggestRisk, 15);
  assert.equal(payload.capitalEfficiency, 1.25);
  assert.deepEqual(JSON.parse(JSON.stringify(payload.trades)), [{
    date: '2026-08-08',
    openTime: '2026-08-08T13:00:00.000Z',
    closeTime: '2026-08-08T13:15:00.000Z',
    symbol: 'XAUUSD',
    brokerSymbol: 'Gold',
    direction: 'Long',
    setup: 'Trend Continuation',
    state: 'Trending',
    timeframe: '5m',
    entry: 2400,
    exit: 2410,
    size: 1,
    fees: 2,
    stopLoss: 2395,
    adjustedStopLoss: 2402,
    takeProfit: 2420,
    adjustedTakeProfit: 2412,
    accountSize: 5000,
    riskPercent: 1,
    protected: 'Yes',
    tradeManagement: 'Trail Stop',
    grade: 'A',
    closeReason: 'Take Profit',
    outcomeOverride: 'Win',
    tags: 'gold, trend',
    notes: 'Followed the plan.',
    emotion: 'Patient',
  }]);
  assert.equal('screenshot' in payload.trades[0], false);
  assert.equal('sourceDealId' in payload.trades[0], false);
  assert.equal('lossReason' in payload.trades[0], false);
});

test('DNA Doctor backend includes individual trades in the data sent to the model', () => {
  assert.ok(serverSource.includes('Individual Trades:'), 'User prompt data should include an Individual Trades section.');
  assert.ok(serverSource.includes('JSON.stringify(payload.trades || [], null, 2)'), 'Individual trades should be passed through as JSON data.');
});

test('DNA Doctor backend includes risk and process metrics in the model data', () => {
  assert.ok(serverSource.includes('Protected Trades %: ${payload.protectedPercent != null ? Number(payload.protectedPercent).toFixed(1) + \'%\' : \'N/A\'}'), 'User prompt data should include protected trade percentage.');
  assert.ok(serverSource.includes('Biggest Risk $: ${payload.biggestRisk != null ? \'$\' + Number(payload.biggestRisk).toFixed(2) : \'N/A\'}'), 'User prompt data should include biggest risk dollars.');
  assert.ok(serverSource.includes('Capital Efficiency: ${payload.capitalEfficiency != null ? Number(payload.capitalEfficiency).toFixed(2) + \'x\' : \'N/A\'}'), 'User prompt data should include capital efficiency.');
});

test('DNA Doctor report renders Best Trade and Worst Trade sections', () => {
  assert.ok(source.includes('<span class="dna-doctor-section-icon">✅</span><h4>Best Trade</h4>'), 'Report should render a Best Trade section.');
  assert.ok(source.includes('<p>${escapeHtml(report.bestTrade || \'\')}</p>'), 'Best Trade should render from report.bestTrade.');
  assert.ok(source.includes('<span class="dna-doctor-section-icon">⚠️</span><h4>Worst Trade</h4>'), 'Report should render a Worst Trade section.');
  assert.ok(source.includes('<p>${escapeHtml(report.worstTrade || \'\')}</p>'), 'Worst Trade should render from report.worstTrade.');
});
