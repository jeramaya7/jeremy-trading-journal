import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Guards the desktop single-row layout of the Trading Mode and Dashboard
// KPI strips (src/styles.css). These assertions keep the column count aligned
// with the actual visible card count while leaving the existing card styling
// untouched.
//
// Follow-up fix: Trading Mode's <section> actually renders with all three
// classes at once — "stats-grid hero-stats-row trading-today-kpi-strip"
// (see renderTodayKpiStrip below) — so a plain two-class
// ".stats-grid.trading-today-kpi-strip" selector was tied in specificity
// with ".stats-grid.hero-stats-row" and lost on source order, silently
// putting Trading Mode back on Dashboard columns even though the
// Dashboard-only 5-column rule was never meant to apply there. Fixed by
// naming all three classes on the Trading Mode selector so it always wins
// on that element regardless of rule order.

const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

function assertIncludes(text, expected, message) {
  assert.ok(text.includes(expected), `${message}\nExpected to find: ${expected}`);
}

test('Trading Mode strip actually renders all three classes together (the reason a two-class selector was not enough)', () => {
  assertIncludes(
    source,
    '<section class="stats-grid hero-stats-row trading-today-kpi-strip" aria-label="Today trading statistics">',
    'Trading Mode\'s KPI strip element carries stats-grid, hero-stats-row, AND trading-today-kpi-strip at once.',
  );
  assertIncludes(
    source,
    '<section class="stats-grid hero-stats-row" aria-label="DNA trading statistics">',
    'Dashboard\'s KPI strip element carries only stats-grid and hero-stats-row (no trading-today-kpi-strip).',
  );
});

test('Trading Mode KPI strip (4 cards) uses a 4-column desktop grid that outranks the Dashboard-only rule', () => {
  // Confirms the Trading Mode strip actually renders exactly 4 stat cards,
  // so this test would fail loudly if a card were ever added/removed
  // without updating the column count below.
  const todayStripStart = source.indexOf('function renderTodayKpiStrip(todayTrades, todayStats)');
  const todayStripEnd = source.indexOf('\nfunction ', todayStripStart + 1);
  const todayStripBody = source.slice(todayStripStart, todayStripEnd);
  const cardCount = (todayStripBody.match(/statCard\(/g) || []).length;
  assert.equal(cardCount, 4, 'Trading Mode KPI strip should render exactly 4 stat cards: Today P/L, Trades, Win Rate, Profit Factor.');

  assertIncludes(
    styles,
    '.stats-grid.hero-stats-row.trading-today-kpi-strip {\n    gap: clamp(0.65rem, 1vw, 0.9rem);\n    grid-template-columns: repeat(4, minmax(0, 1fr));\n  }',
    'The Trading Mode KPI strip selector must name all three classes (three-class specificity), so it reliably beats the plain two-class .stats-grid.hero-stats-row rule on the same element regardless of source order.',
  );
});

test('Dashboard header KPI strip (4 cards) uses a 4-column desktop grid, and never matches the Trading Mode selector', () => {
  const heroRowStart = source.indexOf('function renderHeroStatsRow(stats)');
  const heroRowEnd = source.indexOf('\nfunction ', heroRowStart + 1);
  const heroRowBody = source.slice(heroRowStart, heroRowEnd);
  const cardCount = (heroRowBody.match(/statCard\(/g) || []).length;
  assert.equal(cardCount, 4, 'Dashboard header KPI strip should render exactly 4 stat cards: Net P/L, Trades, Win Rate, Profit Factor.');

  assertIncludes(
    styles,
    '.stats-grid.hero-stats-row {\n    grid-template-columns: repeat(4, minmax(0, 1fr));\n  }',
    'The Dashboard header KPI strip should use a 4-column desktop grid, one column per card, so all four fit on a single row.',
  );
});

test('both single-row overrides only apply at desktop width, so mobile/tablet stacking is unaffected', () => {
  const desktopBreakpointIndex = styles.indexOf('@media (min-width: 1101px) {');
  const tradingStripIndex = styles.indexOf('.stats-grid.hero-stats-row.trading-today-kpi-strip {');
  const fourColIndex = styles.indexOf('.stats-grid.hero-stats-row {\n    grid-template-columns: repeat(4, minmax(0, 1fr));');
  assert.ok(desktopBreakpointIndex !== -1 && desktopBreakpointIndex < tradingStripIndex, 'The Trading Mode override should live inside the desktop (min-width: 1101px) media query.');
  assert.ok(desktopBreakpointIndex !== -1 && desktopBreakpointIndex < fourColIndex, 'The 4-column override should live inside the desktop (min-width: 1101px) media query.');

  // The existing tablet/mobile stacking rules for the shared .stats-grid
  // class (2 columns under 1100px, 1 column under 620px) are untouched —
  // they still apply to these strips since both keep the base "stats-grid"
  // class alongside their strip-specific class(es).
  assertIncludes(styles, '@media (max-width: 1100px) {\n  .stats-grid,\n  .reports-grid {\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n  }\n}', 'Tablet 2-column stacking for .stats-grid is untouched.');
});
