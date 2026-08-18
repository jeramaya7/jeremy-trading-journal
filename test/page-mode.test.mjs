import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

function assertIncludes(text, expected, message) {
  assert.ok(text.includes(expected), `${message}\nExpected to find: ${expected}`);
}

test('page mode toggle persists Dashboard Mode and Trading Mode selection', () => {
  assertIncludes(source, "const PAGE_MODE_STORAGE_KEY = 'jeremy-trading-journal:page-mode:v1';", 'Page mode uses a dedicated localStorage key.');
  assertIncludes(source, 'function loadPageMode()', 'Page mode is restored on load.');
  assertIncludes(source, 'window.localStorage.setItem(PAGE_MODE_STORAGE_KEY, pageMode);', 'Page mode changes are persisted.');
  assertIncludes(source, 'Dashboard Mode', 'Dashboard Mode toggle label is visible.');
  assertIncludes(source, 'Trading Mode', 'Trading Mode toggle label is visible.');
  assertIncludes(styles, '.page-mode-toggle', 'Page mode toggle has visible styling.');
});

test('Trading Mode renders a focused workbench without dashboard analytics sections', () => {
  assertIncludes(source, 'function renderTodayKpiStrip(todayTrades, todayStats)', 'Trading Mode has a dedicated Today KPI strip.');
  assertIncludes(source, "statCard('calendar', 'Today P/L'", 'Today KPI strip shows Today P/L.');
  assertIncludes(source, "statCard('chart', 'Trades', todayStats.tradeCount)", 'Today KPI strip shows Trades.');
  assertIncludes(source, "statCard('target', 'Win Rate'", 'Today KPI strip shows Win Rate.');
  assertIncludes(source, "statCard('line', 'Profit Factor', formatProfitFactor(todayStats.profitFactor), getProfitFactorTone(todayStats.profitFactor))", 'Today KPI strip shows Profit Factor in place of Expectancy.');
  assert.equal(source.includes("statCard('trend', 'Today %'"), false, 'Today % should no longer render in the Today KPI strip.');
  assert.equal(source.includes("statCard('line', 'CE', formatCapitalEfficiency(todayStats.capitalEfficiency)"), false, 'CE should no longer render in the Today KPI strip.');
  assert.equal(source.includes("statCard('trend', 'Expectancy', formatRMultiple(todayStats.averageR))"), false, 'Expectancy should no longer render in the Today KPI strip.');
  // Follow-up fix: Trading Mode now also shows the Manual Trade panel
  // (moved to the top of the journal panel) — it no longer opts out via
  // showManualTradePanel. isTradingMode only keeps its compact styling.
  assertIncludes(source, "const tradingModeSections = `${renderTodayKpiStrip(todayTrades, getStats(todayTrades))}${renderJournalWorkspace(filteredTrades, today, { isTradingMode: true })}`;", 'Trading Mode includes the Today KPI strip and the journal workspace, with its compact styling and the Manual Trade panel.');
  assertIncludes(source, '? tradingModeSections', 'Trading Mode uses the focused workbench sections.');
  assertIncludes(source, ': `${dashboardSections}${journalWorkspaceSection}`;', 'Dashboard Mode keeps the dashboard-first layout.');

  // Today KPI strip order must stay: Today P/L, Trades, Win Rate, Profit Factor.
  const todayPnlIndex = source.indexOf("statCard('calendar', 'Today P/L'");
  const todayWinRateIndex = source.indexOf("statCard('target', 'Win Rate', formatPercent(todayStats.winRate))");
  const todayTradesIndex = source.indexOf("statCard('chart', 'Trades', todayStats.tradeCount)");
  const todayProfitFactorIndex = source.indexOf("statCard('line', 'Profit Factor', formatProfitFactor(todayStats.profitFactor), getProfitFactorTone(todayStats.profitFactor))");
  assert.ok(
    todayPnlIndex !== -1 && todayPnlIndex < todayTradesIndex
      && todayTradesIndex < todayWinRateIndex
      && todayWinRateIndex < todayProfitFactorIndex,
    'Today KPI strip should render in order: Today P/L, Trades, Win Rate, Profit Factor.',
  );
});
