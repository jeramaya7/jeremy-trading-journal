import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const serverSource = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

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

function buildPayload(trades, coachingFocus) {
  const code = [
    extractConst('DNA_DOCTOR_COACHING_FOCUS_OPTIONS'),
    "const DEFAULT_DNA_DOCTOR_COACHING_FOCUS = 'Overall';",
    extractConst('DNA_DOCTOR_TRADE_FIELDS'),
    extractFunction('buildDnaDoctorTradePayload'),
    extractFunction('getDnaDoctorCoachingFocus'),
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
  return context.module.exports.buildDnaScanPayload(trades, coachingFocus);
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
  assert.equal(payload.coachingFocus, 'Overall');
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

test('DNA Doctor UI exposes Coaching Focus and sends the selected focus', () => {
  assert.ok(source.includes('const DNA_DOCTOR_COACHING_FOCUS_OPTIONS = ['), 'Coaching Focus options should be centralized.');
  for (const option of ['Overall', 'Capital Efficiency (CE)', 'Risk / Position Sizing', 'Trade Management', 'Psychology / Discipline']) {
    assert.ok(source.includes(`'${option}',`), `Coaching Focus should include ${option}.`);
  }
  assert.ok(source.includes("const DEFAULT_DNA_DOCTOR_COACHING_FOCUS = 'Overall';"), 'Overall should be the default Coaching Focus.');
  assert.ok(source.includes('let selectedDnaDoctorCoachingFocus = \'Overall\';'), 'The selected Coaching Focus should start as Overall.');
  assert.ok(source.includes('<span>Coaching Focus</span>'), 'The Doctor UI should label the Coaching Focus dropdown.');
  assert.ok(source.includes('<select id="dnaDoctorCoachingFocus" ${isLoading ? \'disabled\' : \'\'}>'), 'The dropdown should render immediately before the scan button and disable while loading.');
  assert.ok(source.indexOf('id="dnaDoctorCoachingFocus"') < source.indexOf('id="runDnaDoctor"'), 'The Coaching Focus dropdown should appear before Run DNA Scan.');
  assert.ok(source.includes('selectedDnaDoctorCoachingFocus = getDnaDoctorCoachingFocus(event.target.value);'), 'Changing the dropdown should update the selected focus.');
  assert.ok(styles.includes('.dna-doctor-focus-control'), 'The dropdown should have compact Doctor-scoped styling.');
});

test('DNA Doctor payload carries Coaching Focus without dropping existing data', () => {
  const payload = buildPayload([{ id: 'trade-1', date: '2026-08-08', symbol: 'XAUUSD' }], 'Risk / Position Sizing');

  assert.equal(payload.coachingFocus, 'Risk / Position Sizing');
  assert.equal(payload.tradeCount, 1);
  assert.equal(Array.isArray(payload.trades), true);

  const fallbackPayload = buildPayload([], 'Unsupported Focus');
  assert.equal(fallbackPayload.coachingFocus, 'Overall');
});

test('DNA Doctor backend includes individual trades in the data sent to the model', () => {
  assert.ok(serverSource.includes('Individual Trades:'), 'User prompt data should include an Individual Trades section.');
  assert.ok(serverSource.includes('JSON.stringify(payload.trades || [], null, 2)'), 'Individual trades should be passed through as JSON data.');
});

test('DNA Doctor scan uses the dashboard-filtered trade list', () => {
  const clickStart = source.indexOf("document.querySelector('#runDnaDoctor')?.addEventListener('click', async () => {");
  const clickEnd = source.indexOf("\n  document.querySelector('#dnaDoctorDismissError')", clickStart);
  assert.notEqual(clickStart, -1, 'DNA Doctor click handler should exist.');
  assert.notEqual(clickEnd, -1, 'DNA Doctor click handler should end before the dismiss handler.');
  const clickHandler = source.slice(clickStart, clickEnd);

  assert.ok(source.includes('let currentDnaDoctorTrades = [];'), 'The current dashboard-filtered Doctor trade list should be tracked.');
  assert.ok(source.includes('currentDnaDoctorTrades = dnaResultsTrades;'), 'Render should store the same filtered trade list used by the dashboard.');
  assert.ok(source.includes('renderDnaDoctor(dnaResultsTrades)'), 'The Doctor panel should be rendered from the dashboard-filtered trade list.');
  assert.ok(clickHandler.includes('const dnaDoctorTrades = currentDnaDoctorTrades;'), 'The scan should capture the currently displayed dashboard-filtered trade list.');
  assert.ok(clickHandler.includes('const coachingFocus = selectedDnaDoctorCoachingFocus;'), 'The scan should capture the currently selected Coaching Focus.');
  assert.ok(clickHandler.includes('const report = await runDnaDoctor(dnaDoctorTrades, coachingFocus);'), 'The scan should send the captured trade list and focus to DNA Doctor.');
  assert.equal(clickHandler.includes('getDnaResultsTrades('), false, 'The scan click handler should not recompute a separate timeframe filter.');
  assert.equal(clickHandler.includes("'day'"), false, 'The Doctor data path should not hardcode today/day filtering.');
});

test('DNA Doctor backend includes risk and process metrics in the model data', () => {
  assert.ok(serverSource.includes('Protected Trades %: ${payload.protectedPercent != null ? Number(payload.protectedPercent).toFixed(1) + \'%\' : \'N/A\'}'), 'User prompt data should include protected trade percentage.');
  assert.ok(serverSource.includes('Biggest Risk $: ${payload.biggestRisk != null ? \'$\' + Number(payload.biggestRisk).toFixed(2) : \'N/A\'}'), 'User prompt data should include biggest risk dollars.');
  assert.ok(serverSource.includes('Capital Efficiency: ${payload.capitalEfficiency != null ? Number(payload.capitalEfficiency).toFixed(2) + \'x\' : \'N/A\'}'), 'User prompt data should include capital efficiency.');
});

test('DNA Doctor backend includes Coaching Focus instructions in the prompt data', () => {
  assert.ok(serverSource.includes('const coachingFocus = typeof payload.coachingFocus === \'string\' && payload.coachingFocus.trim()'), 'Backend should read Coaching Focus from the payload.');
  assert.ok(serverSource.includes('Coaching Focus: Overall. Use the current balanced DNA Doctor behavior and weigh all areas normally.'), 'Overall should preserve balanced Doctor behavior.');
  assert.ok(serverSource.includes('Still consider all provided data, but prioritize this area when determining the Overall grade, biggest weakness or issue, recommendations, and goal.'), 'A selected focus should prioritize grade, issue, recommendations, and goal while keeping all data.');
  assert.ok(serverSource.includes('${coachingFocusInstruction}'), 'The focus instruction should be included in the user prompt sent to the model.');
});

test('DNA Doctor prompt defines Capital Efficiency using the DNA formula and guardrails', () => {
  assert.ok(serverSource.includes('Capital Efficiency (CE) Definition'), 'The prompt should include a Capital Efficiency definition section.');
  assert.ok(serverSource.includes('CE = Net Profit ÷ Maximum Capital Exposure.'), 'CE should be defined as net profit divided by maximum capital exposure.');
  assert.ok(serverSource.includes('Capital Exposure = max(0, -RunningPnLBeforeThisTrade) + RiskDollars(trade).'), 'Capital Exposure should use the DNA running drawdown plus trade risk formula.');
  assert.ok(serverSource.includes('Maximum Capital Exposure = the highest exposure reached during the selected period.'), 'Maximum Capital Exposure should be defined as the selected period peak exposure.');
  assert.ok(serverSource.includes('CE measures how much net profit was produced for each dollar of maximum capital actually exposed during the period.'), 'The prompt should explain what CE measures.');
  assert.ok(serverSource.includes('Do not judge CE from Average R alone.'), 'The prompt should prevent judging CE from Average R alone.');
  assert.ok(serverSource.includes('Do not use risk/reward, expectancy, win rate, or profit factor as substitutes for CE.'), 'The prompt should prevent substituting other performance metrics for CE.');
  assert.ok(serverSource.includes('Low R does not automatically mean poor CE.'), 'The prompt should state that low R is not automatically poor CE.');
  assert.ok(serverSource.includes("CE commentary must be based on the actual CE value and DNA's CE definition."), 'CE commentary should use the actual CE value and DNA definition.');
  assert.ok(serverSource.includes('When Coaching Focus is Capital Efficiency (CE), the top Biggest Issue must identify the biggest problem affecting CE, such as maximum capital exposure, oversized risk, unrecovered drawdown, net profit, or exposure efficiency; do not choose low Average R unless it has a clear direct effect on CE.'), 'CE focus should prevent low Average R from becoming the Biggest Issue unless it directly affects CE.');
  assert.ok(serverSource.includes('When Coaching Focus is Capital Efficiency (CE), the Overall grade, biggest issue, recommendations, and goal should primarily reflect CE using this definition.'), 'CE focus should prioritize CE using the DNA definition.');
  assert.ok(serverSource.includes('${capitalEfficiencyInstruction}'), 'The CE instruction should be included in the user prompt sent to the model.');
});

test('DNA Doctor report renders Best Trade and Worst Trade sections', () => {
  assert.ok(source.includes('<span class="dna-doctor-section-icon">✅</span><h4>Best Trade</h4>'), 'Report should render a Best Trade section.');
  assert.ok(source.includes('<p>${escapeHtml(report.bestTrade || \'\')}</p>'), 'Best Trade should render from report.bestTrade.');
  assert.ok(source.includes('<span class="dna-doctor-section-icon">⚠️</span><h4>Worst Trade</h4>'), 'Report should render a Worst Trade section.');
  assert.ok(source.includes('<p>${escapeHtml(report.worstTrade || \'\')}</p>'), 'Worst Trade should render from report.worstTrade.');
});

test('DNA Doctor payload and report support behavior analysis from existing journal context', () => {
  for (const field of ['notes', 'emotion', 'tradeManagement', 'closeReason', 'lossReason']) {
    assert.ok(source.includes(`'${field}',`), `Trade payload should include existing ${field} field when present.`);
  }
  assert.equal(source.includes("'mindset',"), false, 'Trade payload should no longer include Mindset.');
  assert.ok(serverSource.includes('Use notes, emotion, tradeManagement, closeReason, and lossReason only when those fields are present to inform behavior and discipline analysis.'), 'Behavior analysis should use active journal context only when present.');
  assert.ok(source.includes('<span class="dna-doctor-section-icon">🧠</span><h4>Psychology Review</h4>'), 'Report should render a Psychology Review section.');
  assert.ok(source.includes('<p>${escapeHtml(report.psychologyReview || \'\')}</p>'), 'Psychology Review should render from report.psychologyReview.');
});

test('DNA Doctor report matches the Aug 7 target section order', () => {
  const expectedSections = [
    '<h4>Overall Grade</h4>',
    '<h4>Biggest Strength</h4>',
    '<h4>Biggest Weakness</h4>',
    '<h4>Best Trade</h4>',
    '<h4>Worst Trade</h4>',
    '<h4>Risk Review</h4>',
    '<h4>Psychology Review</h4>',
    '<h4>Three Things Done Well</h4>',
    '<h4>Three Improvements</h4>',
    '<h4>Goal for Tomorrow</h4>',
    '<h4>Quote of the Day</h4>',
  ];
  let previousIndex = -1;
  for (const section of expectedSections) {
    const index = source.indexOf(section);
    assert.ok(index > previousIndex, `${section} should appear in target order.`);
    previousIndex = index;
  }
  assert.ok(source.includes('<p>${escapeHtml(report.riskReview || \'\')}</p>'), 'Risk Review should render from report.riskReview.');
  assert.ok(source.includes('<p>${escapeHtml(report.quoteOfDay || \'\')}</p>'), 'Quote of the Day should render from report.quoteOfDay.');
});

test('DNA Doctor report sections use a responsive compact grid', () => {
  assert.ok(source.includes('<div class="dna-doctor-sections-grid">'), 'Report sections should be grouped in the compact grid wrapper.');
  assert.ok(styles.includes('.dna-doctor-sections-grid {\n  display: grid;'), 'Report sections should use CSS grid on desktop.');
  assert.ok(styles.includes('grid-template-columns: repeat(2, minmax(0, 1fr));'), 'Desktop report should use two equal columns.');
  assert.ok(styles.includes('.dna-doctor-sections-grid { grid-template-columns: 1fr; }'), 'Small screens should collapse the report grid to one column.');
});
