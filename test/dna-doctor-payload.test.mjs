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
  assert.equal('capitalEfficiency' in payload, false, 'Capital Efficiency should not be sent to DNA Doctor.');
  assert.equal('averageR' in payload, false, 'Average R should not be sent as a top-level Doctor payload field.');
  assert.equal(source.includes('averageR: stats.averageR,'), false, 'Doctor payload should not include stats.averageR.');
  assert.equal(source.includes('averageR: r.averageR'), false, 'Doctor asset/setup/session payload rows should not include Average R.');
  assert.equal(source.includes('capitalEfficiency: stats.capitalEfficiency,'), false, 'Doctor payload should not include Capital Efficiency.');
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

test('DNA Doctor backend keeps Coaching Focus support while the visible UI uses Request Analysis', () => {
  assert.ok(source.includes('const DNA_DOCTOR_COACHING_FOCUS_OPTIONS = ['), 'Coaching Focus options should be centralized.');
  for (const option of ['Overall', 'Risk / Position Sizing', 'Trade Management', 'Psychology / Discipline']) {
    assert.ok(source.includes(`'${option}',`), `Coaching Focus should include ${option}.`);
  }
  assert.equal(source.includes("'Capital Efficiency (CE)',"), false, 'Capital Efficiency should not be available as a Coaching Focus.');
  assert.ok(source.includes("const DEFAULT_DNA_DOCTOR_COACHING_FOCUS = 'Overall';"), 'Overall should be the default Coaching Focus.');
  assert.ok(source.includes('let selectedDnaDoctorCoachingFocus = \'Overall\';'), 'The selected Coaching Focus should start as Overall.');
  assert.equal(source.includes('<span>Coaching Focus</span>'), false, 'The visible Doctor UI should no longer show the Coaching Focus dropdown.');
  assert.equal(source.includes('<select id="dnaDoctorCoachingFocus" ${isLoading ? \'disabled\' : \'\'}>'), false, 'The visible Doctor UI should no longer render the old dropdown.');
  assert.ok(source.includes('Request Analysis'), 'The visible Doctor UI should show Request Analysis.');
  assert.ok(source.includes("document.querySelector('#runDnaDoctor')?.addEventListener('click', exportForAiMarkdown, { signal });"), 'Request Analysis should download the AI markdown export.');
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

test('DNA Doctor Request Analysis uses the dashboard timeframe export instead of the backend scan UI', () => {
  const clickStart = source.indexOf("document.querySelector('#runDnaDoctor')?.addEventListener('click', exportForAiMarkdown, { signal });");
  const clickEnd = clickStart + "document.querySelector('#runDnaDoctor')?.addEventListener('click', exportForAiMarkdown, { signal });".length;
  assert.notEqual(clickStart, -1, 'DNA Doctor click handler should exist.');
  const clickHandler = source.slice(clickStart, clickEnd);

  assert.ok(source.includes('let currentDnaDoctorTrades = [];'), 'The current dashboard-filtered Doctor trade list should be tracked.');
  assert.ok(source.includes('currentDnaDoctorTrades = dnaResultsTrades;'), 'Render should store the same filtered trade list used by the dashboard.');
  assert.ok(source.includes('renderDnaDoctor(dnaResultsTrades)'), 'The Doctor panel should be rendered from the dashboard-filtered trade list.');
  assert.ok(clickHandler.includes('exportForAiMarkdown'), 'The visible Doctor button should run the markdown export.');
  assert.equal(source.includes('const report = await runDnaDoctor(dnaDoctorTrades, coachingFocus);'), false, 'The visible Doctor click path should not call the backend scan.');
  assert.equal(clickHandler.includes('getDnaResultsTrades('), false, 'The scan click handler should not recompute a separate timeframe filter.');
  assert.equal(clickHandler.includes("'day'"), false, 'The Doctor data path should not hardcode today/day filtering.');
});

test('DNA Doctor backend includes risk and process metrics in the model data', () => {
  assert.ok(serverSource.includes('Protected Trades %: ${payload.protectedPercent != null ? Number(payload.protectedPercent).toFixed(1) + \'%\' : \'N/A\'}'), 'User prompt data should include protected trade percentage.');
  assert.ok(serverSource.includes('Biggest Risk $: ${payload.biggestRisk != null ? \'$\' + Number(payload.biggestRisk).toFixed(2) : \'N/A\'}'), 'User prompt data should include biggest risk dollars.');
  assert.equal(serverSource.includes('Capital Efficiency:'), false, 'User prompt data should not include Capital Efficiency.');
  assert.equal(serverSource.includes('Average R:'), false, 'User prompt data should not include Average R.');
  assert.equal(serverSource.includes('avg R'), false, 'Asset/setup/session prompt rows should not include Average R.');
});

test('DNA Doctor backend includes Coaching Focus instructions in the prompt data', () => {
  assert.ok(serverSource.includes('const coachingFocus = typeof payload.coachingFocus === \'string\' && payload.coachingFocus.trim()'), 'Backend should read Coaching Focus from the payload.');
  assert.ok(serverSource.includes('Coaching Focus: Overall. Use the current balanced DNA Doctor behavior and weigh all areas normally.'), 'Overall should preserve balanced Doctor behavior.');
  assert.ok(serverSource.includes('Still consider all provided data, but prioritize this area when determining the Overall grade, biggest weakness or issue, recommendations, and goal.'), 'A selected focus should prioritize grade, issue, recommendations, and goal while keeping all data.');
  assert.ok(serverSource.includes('${coachingFocusInstruction}'), 'The focus instruction should be included in the user prompt sent to the model.');
});

test('DNA Doctor prompt and payload do not include Capital Efficiency', () => {
  assert.equal(serverSource.includes('Capital Efficiency'), false, 'Doctor backend prompt should not mention Capital Efficiency.');
  assert.equal(serverSource.includes('capitalEfficiency'), false, 'Doctor backend should not read Capital Efficiency.');
  assert.equal(serverSource.includes('CE '), false, 'Doctor backend prompt should not mention CE.');
});

test('DNA Doctor report renders Best Trade and Worst Trade sections', () => {
  assert.ok(source.includes('<strong>Biggest issue / observation:</strong>'), 'Top report summary should label the first issue item as an issue or observation.');
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
