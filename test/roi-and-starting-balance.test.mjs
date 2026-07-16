import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Guards the ROI % dashboard metric and its Starting Account Balance setting
// (src/main.js): ROI % = Net P/L ÷ Starting Account Balance × 100, a global
// setting (default $5,600) editable inline on the ROI % card, and the
// DNA Results first-row reorder (ROI %, Biggest Winner, Biggest Loser,
// Profit Factor) that moved Biggest Risk into the Risk Metrics row and
// removed Profit Factor from the top KPI row.

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

test('the Starting Account Balance is editable inline on the ROI % card', () => {
  assert.ok(
    source.includes('function renderRoiCard(roiPercent, accountBalance)'),
    'A dedicated ROI % card renderer should exist.',
  );
  assert.ok(
    source.includes('data-starting-account-balance'),
    'The ROI % card should render an editable Starting Account Balance input.',
  );
  assert.ok(
    source.includes("document.querySelector('[data-starting-account-balance]')?.addEventListener('change'"),
    'Editing the Starting Account Balance input should be wired to a change handler.',
  );
  assert.ok(
    source.includes('setStartingAccountBalance(event.target.value);') && source.includes('render();'),
    'Changing the Starting Account Balance should save it and trigger a re-render, so ROI % recalculates immediately.',
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

test('Biggest Risk moved into the Risk Metrics row, alongside Average Winner/Loser/Risk $/Risk %', () => {
  const riskMetricsLabelIndex = source.indexOf("label: 'Risk Metrics'");
  assert.notEqual(riskMetricsLabelIndex, -1, 'Risk Metrics row should exist.');

  const nextRowLabelIndex = source.indexOf("label: 'Time Performance'", riskMetricsLabelIndex);
  assert.notEqual(nextRowLabelIndex, -1, 'Time Performance row should follow Risk Metrics.');

  const riskMetricsBody = source.slice(riskMetricsLabelIndex, nextRowLabelIndex);
  assert.ok(
    riskMetricsBody.includes("statCard('line', 'Biggest Risk'"),
    'Biggest Risk should render inside the Risk Metrics row.',
  );
  assert.ok(
    riskMetricsBody.includes("statCard('target', 'Average Risk %'"),
    'Risk Metrics row should still include Average Risk %.',
  );
});
