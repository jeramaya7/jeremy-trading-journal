import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

function getDashboardStatsTemplate() {
  const startMarker = '<section class="dashboard-card-groups" aria-label="Trading performance summary">';
  const endMarker = '</section>';
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, 'Dashboard statistics section should render.');
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, 'Dashboard statistics section should close.');
  return source.slice(start, end);
}

test('dashboard focuses R and risk statistics without Total R', () => {
  const dashboardStats = getDashboardStatsTemplate();

  assert.equal(dashboardStats.includes("'Total R'"), false, 'Total R should not render as a dashboard card.');
  assert.ok(dashboardStats.includes('dashboardCardRows.map'), 'Dashboard card rows should render as a balanced grouped grid.');
  assert.ok(source.includes("statCard('line', 'Average R'"), 'Average R should still render as a dashboard card.');
  assert.ok(source.includes("statCard('target', 'Average Risk $'"), 'Average Risk $ should render as a dashboard card.');
  assert.ok(source.includes("statCard('target', 'Average Risk %'"), 'Average Risk % should render as a dashboard card.');
});

test('dashboard average risk metrics only use valid risk values', () => {
  assert.ok(source.includes('const riskDollarValues = trades.map(calculateRiskDollars).filter(Number.isFinite);'), 'Average Risk $ should ignore missing or invalid Risk $ values.');
  assert.ok(source.includes('const riskPercentValues = trades.map(calculateRiskPercent).filter(Number.isFinite);'), 'Average Risk % should ignore missing or invalid Risk % values.');
  assert.ok(source.includes('riskDollarValues.reduce((sum, value) => sum + value, 0) / riskDollarValues.length'), 'Average Risk $ should average only valid Risk $ values.');
  assert.ok(source.includes('riskPercentValues.reduce((sum, value) => sum + value, 0) / riskPercentValues.length'), 'Average Risk % should average only valid Risk % values.');
});

test('R and risk calculations remain available outside the dashboard summary', () => {
  assert.ok(source.includes('function calculateRMultiple(trade)'), 'Individual R calculation helper should remain.');
  assert.ok(source.includes('function calculateRiskDollars(trade)'), 'Risk dollar calculation helper should remain.');
  assert.ok(source.includes('function calculateRiskPercent(trade)'), 'Risk percent calculation helper should remain.');
  assert.ok(source.includes('<span>Risk $: ${riskDollars === null ?'), 'Trade cards should still show Risk $ values.');
  assert.ok(source.includes('function getActiveStopLoss(trade)'), 'Risk statistics should use the active adjusted-or-original stop loss helper.');
  assert.ok(source.includes('<span>Risk %: ${formatRiskPercent(riskPercent)}</span>'), 'Trade cards should still show Risk % values.');
  assert.ok(source.includes('<span class="${rTone}">R: ${formatRMultiple(rMultiple)}</span>'), 'Trade cards should still show R values.');
  assert.ok(source.includes('const rMultiple = calculateRMultiple(trade);'), 'Setup Analytics should still reuse R calculations.');
  assert.ok(source.includes('${setupAnalyticsHeader(\'averageR\', \'Average R\')}'), 'Setup Analytics should still show Average R.');
});

test('R and risk percent display with one decimal place without changing calculations', () => {
  assert.ok(source.includes('return calculatePnl(trade) / riskDollars;'), 'R calculation should continue to use the raw calculated values.');
  assert.ok(source.includes('return (riskDollars / accountSize) * 100;'), 'Risk % calculation should continue to return the raw calculated value.');
  assert.ok(source.includes("`${value.toFixed(1)}R`"), 'R display values should render with one decimal place.');
  assert.ok(source.includes("return `${value.toFixed(1)}%`;"), 'Risk % display values should render with one decimal place.');
  assert.ok(source.includes("if (value > 0 && value < 0.1)"), 'Risk % display should not round non-zero calculated risk down to 0.0%.');
  assert.ok(source.includes("riskPercentInput.value = riskPercent === null ? '' : formatRiskPercent(riskPercent).replace('%', '');"), 'Readonly form Risk % display should use the shared one-decimal Risk % formatter.');
});


test('dashboard renders twelve cards in three balanced 4-column rows', () => {
  assert.ok(source.includes('const dashboardCardRows = ['), 'Dashboard cards should be assembled in grouped rows.');
  assert.equal((source.match(/statCard\('/g) ?? []).length >= 12, true, 'Dashboard should define at least twelve stat cards.');
  assert.ok(source.includes("statCard('trend', 'Biggest Winner'"), 'Biggest Winner should render as a dashboard card.');
  assert.ok(source.includes("statCard('calendar', 'Yearly P&L'"), 'Yearly P&L should render as a dashboard card.');
});

test('biggest winner calculates from closed winning trade P&L', () => {
  assert.ok(source.includes('function calculateBiggestWinner(tradeList)'), 'Biggest Winner should have a dedicated helper.');
  assert.ok(source.includes('.filter((trade) => getTradeReportDate(trade) !== null)'), 'Biggest Winner should only use closed/reportable trades.');
  assert.ok(source.includes('.map(calculatePnl)'), 'Biggest Winner should reuse existing P&L data.');
  assert.ok(source.includes('Math.max(...winningPnlValues)'), 'Biggest Winner should select the highest winning P&L.');
});
