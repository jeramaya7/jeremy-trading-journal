import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Guards the ROI % dashboard metric and its Starting Account Balance setting
// (src/main.js): ROI % = Net P/L ÷ Starting Account Balance × 100, a global
// setting (default $5,600) editable from the Settings modal (not the ROI
// card itself), and the DNA Results 4x3 grid (ROI %, Biggest Winner,
// Biggest Loser, Profit Factor / Average Winner, Average Loser, Average
// Risk $, Average Risk % / Daily P/L, Weekly P/L, Monthly P/L, Yearly P/L)
// with Biggest Risk removed entirely and Profit Factor moved out of the top
// KPI row.

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

function loadRoiModule() {
  const code = [
    extractFunction('calculateRoiPercent'),
    'module.exports = { calculateRoiPercent };',
  ].join('\n\n');

  const context = { module: { exports: {} } };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'main.js (extracted ROI calc)' });
  return context.module.exports;
}

test('Starting Account Balance defaults to $5,600 and is a dedicated localStorage setting', () => {
  assert.ok(
    source.includes("const DEFAULT_STARTING_ACCOUNT_BALANCE = 5600;"),
    'Default starting account balance should be $5,600.',
  );
  assert.ok(
    source.includes("const STARTING_ACCOUNT_BALANCE_STORAGE_KEY = 'jeremy-trading-journal:starting-account-balance:v1';"),
    'Starting Account Balance should use its own dedicated localStorage key, following the same pattern as other settings (DNA timeframe, page mode, etc).',
  );
  assert.ok(
    source.includes('function loadStartingAccountBalance()'),
    'Starting Account Balance should be restored on load.',
  );
  assert.ok(
    source.includes('function setStartingAccountBalance(rawValue)'),
    'Starting Account Balance should be settable and persisted.',
  );
});

test('ROI % = Net P/L ÷ Starting Account Balance × 100, and recalculates from the current stats.totalPnl on every render (never cached)', () => {
  const { calculateRoiPercent } = loadRoiModule();

  assert.equal(calculateRoiPercent(560, 5600), 10, '$560 P/L on a $5,600 balance should be 10% ROI.');
  assert.equal(calculateRoiPercent(-280, 5600), -5, '-$280 P/L on a $5,600 balance should be -5% ROI.');
  assert.equal(calculateRoiPercent(0, 5600), 0, '$0 P/L should be 0% ROI, not null.');
  assert.equal(calculateRoiPercent(1000, 0), null, 'A zero or invalid starting balance should return null, not divide by zero.');

  // ROI is computed fresh in render() from stats.totalPnl every time, not
  // stored on the stats object or cached anywhere — this is what makes it
  // "automatic" whenever Net P/L changes.
  assert.ok(
    source.includes('const roiPercent = calculateRoiPercent(stats.totalPnl, startingAccountBalance);'),
    'ROI % should be derived from the current render\'s stats.totalPnl and the current Starting Account Balance setting.',
  );
});

test('the ROI % card displays only the label, value, and a starting-balance note — no editable input', () => {
  assert.ok(
    source.includes('function renderRoiCard(roiPercent, accountBalance)'),
    'A dedicated ROI % card renderer should exist.',
  );
  assert.ok(
    source.includes("<span>ROI %</span>"),
    'The ROI % card should show the ROI % label.',
  );
  assert.ok(
    source.includes('roi-starting-balance-note'),
    'The ROI % card should show a small starting-balance note.',
  );
  assert.ok(
    source.includes("Based on $${balanceLabel} starting balance."),
    'The note should read "Based on $X starting balance." using the configured starting balance.',
  );
  assert.equal(source.includes('data-starting-account-balance'), false, 'The ROI % card should no longer render an editable Starting Account Balance input.');
  assert.equal(source.includes('roi-starting-balance-edit'), false, 'The old inline-edit markup/styling should be fully removed.');
});

test('Starting Account Balance is editable from the Settings modal, not the dashboard card', () => {
  assert.ok(
    source.includes('function renderSettingsModal()'),
    'A dedicated Settings modal renderer should exist.',
  );
  assert.ok(
    source.includes('isSettingsModalOpen'),
    'Settings modal visibility should be tracked in state, like the Session Notes modal.',
  );
  assert.ok(
    source.includes('data-settings-open'),
    'A Settings button should open the modal.',
  );
  assert.ok(
    source.includes('name="startingAccountBalance"'),
    'The Settings modal should contain the Starting Account Balance field.',
  );
  assert.ok(
    source.includes("document.querySelector('#settingsForm')?.addEventListener('submit'"),
    'Saving the Settings form should be wired to a submit handler.',
  );
  assert.ok(
    source.includes("setStartingAccountBalance(new FormData(event.currentTarget).get('startingAccountBalance'));"),
    'Saving Settings should persist the new Starting Account Balance.',
  );
  assert.ok(
    source.includes('data-settings-cancel'),
    'The Settings modal should be cancelable without saving.',
  );
});

test('DNA Results first row renders ROI %, Biggest Winner, Biggest Loser, Profit Factor in that order', () => {
  const roiIndex = source.indexOf('renderRoiCard(roiPercent, startingAccountBalance),');
  const biggestWinnerIndex = source.indexOf("statCard('trend', 'Biggest Winner'");
  const biggestLoserIndex = source.indexOf("statCard('trend', 'Biggest Loser'");
  const profitFactorIndex = source.indexOf("statCard('line', 'Profit Factor', formatProfitFactor(stats.profitFactor), getProfitFactorTone(stats.profitFactor))");

  assert.notEqual(roiIndex, -1, 'ROI % card should render in the DNA Results first row.');
  assert.notEqual(profitFactorIndex, -1, 'Profit Factor card should render in the DNA Results first row.');
  assert.ok(
    roiIndex < biggestWinnerIndex && biggestWinnerIndex < biggestLoserIndex && biggestLoserIndex < profitFactorIndex,
    'DNA Results first row order should be: ROI %, Biggest Winner, Biggest Loser, Profit Factor.',
  );
});

test('Profit Factor no longer renders in the top KPI row (it now lives under DNA Results)', () => {
  const heroRowStart = source.indexOf('function renderHeroStatsRow(stats)');
  const heroRowEnd = source.indexOf('\nfunction ', heroRowStart + 1);
  const heroRowBody = source.slice(heroRowStart, heroRowEnd);

  assert.equal(heroRowBody.includes('Profit Factor'), false, 'Profit Factor should not appear in renderHeroStatsRow.');
});

test('Biggest Risk is removed from the dashboard entirely (display only — the calculation itself is untouched)', () => {
  const dashboardCardRowsStart = source.indexOf('const dashboardCardRows = [');
  const dashboardCardRowsEnd = source.indexOf('\n  ];', dashboardCardRowsStart) + '\n  ];'.length;
  const dashboardCardRowsBody = source.slice(dashboardCardRowsStart, dashboardCardRowsEnd);

  assert.equal(dashboardCardRowsBody.includes('Biggest Risk'), false, 'Biggest Risk should not render as a dashboard card anywhere.');

  // The underlying calculation must remain untouched — only the display
  // changed, per "do not change any calculations except the display".
  assert.ok(source.includes('biggestRisk'), 'stats.biggestRisk should still be computed in getStats() even though it is no longer displayed.');
  assert.ok(source.includes('const biggestRisk = riskDollarValues.length ? Math.max(...riskDollarValues) : null;'), 'The Biggest Risk calculation itself should be unchanged.');
});

test('DNA Results is a consistent 4x3 grid — every row has exactly four cards', () => {
  const dashboardCardRowsStart = source.indexOf('const dashboardCardRows = [');
  const dashboardCardRowsEnd = source.indexOf('\n  ];', dashboardCardRowsStart) + '\n  ];'.length;
  const dashboardCardRowsBody = source.slice(dashboardCardRowsStart, dashboardCardRowsEnd);

  const rowLabels = ['R Metrics', 'Risk Metrics', 'Time Performance'];
  const rowBoundaries = rowLabels.map((label) => dashboardCardRowsBody.indexOf(`label: '${label}'`));
  rowBoundaries.forEach((index, i) => assert.notEqual(index, -1, `${rowLabels[i]} row should exist.`));

  const rowBodies = rowBoundaries.map((start, i) => {
    const end = i + 1 < rowBoundaries.length ? rowBoundaries[i + 1] : dashboardCardRowsBody.length;
    return dashboardCardRowsBody.slice(start, end);
  });

  // Each row's card list is a `cards: [ ... ]` array — count top-level
  // entries by counting statCard(/renderRoiCard( calls between its `cards: [`
  // and the matching closing `],`.
  rowBodies.forEach((rowBody, i) => {
    const cardsStart = rowBody.indexOf('cards: [');
    const cardsEnd = rowBody.indexOf('\n      ],', cardsStart);
    const cardsBody = rowBody.slice(cardsStart, cardsEnd);
    const cardCount = (cardsBody.match(/(?:statCard|renderRoiCard)\(/g) ?? []).length;
    assert.equal(cardCount, 4, `${rowLabels[i]} row should have exactly 4 cards, found ${cardCount}.`);
  });

  // No row-level five-card modifier should remain now that every row is 4.
  assert.equal(source.includes('dashboard-card-row--five'), false, 'The five-card grid modifier should be removed now that every DNA Results row has exactly 4 cards.');
});
