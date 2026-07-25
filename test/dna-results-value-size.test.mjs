import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Guards the reduced metric-value font size inside DNA Results cards
// (src/styles.css). Requested: shrink only the numeric value text (the
// <strong> inside each .stat-card) in DNA Results by ~15-20%, while the
// Trading Mode / Dashboard header KPI strips at the top of the page keep
// their existing, larger size. Values stay bold — only font-size changes.

const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

function assertIncludes(text, expected, message) {
  assert.ok(text.includes(expected), `${message}\nExpected to find: ${expected}`);
}

test('DNA Results card values are ~17% smaller than before, and stay bold', () => {
  assertIncludes(
    styles,
    '.dashboard-card-row .stat-card strong {\n  /* ~17% smaller than the previous clamp(1.75rem, 3.1vw, 3.2rem) — DNA\n     Results values only. Trading Mode/Dashboard header KPI cards use the\n     base .stat-card strong rule above and are unaffected. */\n  font-size: clamp(1.45rem, 2.55vw, 2.65rem);\n  letter-spacing: -0.055em;\n  line-height: 0.98;\n}',
    'DNA Results value font-size should be reduced to clamp(1.45rem, 2.55vw, 2.65rem) (down from clamp(1.75rem, 3.1vw, 3.2rem)) — a ~17% reduction across the min, preferred, and max clamp values.',
  );

  // Bold weight comes from the shared base rule (.stat-card strong,
  // .report-card strong, .trade-pnl-badge { font-weight: 950 }) — confirm
  // that rule still exists and this change didn't touch font-weight at all.
  assertIncludes(
    styles,
    '.stat-card strong,\n.report-card strong,\n.trade-pnl-badge {\n  color: var(--dna-navy);\n  font-weight: 950;\n}',
    'Values must stay bold — font-weight is untouched by the DNA Results size reduction.',
  );
});

test('the reduction is scoped to DNA Results only — the top-of-page KPI strips keep their own font-size rule untouched', () => {
  // The Trading Mode and Dashboard header KPI strips (.trading-today-kpi-strip,
  // .hero-stats-row) don't define their own strong font-size, so they fall
  // through to the base .stat-card strong rule, not the DNA-Results-scoped
  // .dashboard-card-row .stat-card strong rule this change edited.
  const tradingTodayBlockStart = styles.indexOf('.trading-today-kpi-strip .stat-card {');
  const tradingTodayBlockEnd = styles.indexOf('}', tradingTodayBlockStart);
  const tradingTodayBlock = styles.slice(tradingTodayBlockStart, tradingTodayBlockEnd);
  assert.equal(tradingTodayBlock.includes('font-size'), false, 'Trading Mode KPI card should not define its own value font-size (unaffected by the DNA Results change).');

  const heroStatsCardStart = styles.indexOf('.hero-stats-row .stat-card {');
  const heroStatsCardEnd = styles.indexOf('}', heroStatsCardStart);
  const heroStatsCardBlock = styles.slice(heroStatsCardStart, heroStatsCardEnd);
  assert.equal(heroStatsCardBlock.includes('font-size'), false, 'Dashboard header KPI card should not define its own value font-size (unaffected by the DNA Results change).');

  // Base rule (both KPI strips' actual font-size source) is unchanged.
  assertIncludes(
    styles,
    '.stat-card strong,\n.report-card strong {\n  display: block;\n  font-size: clamp(0.85rem, 12cqw, 2.05rem);',
    'The shared base .stat-card strong font-size (used by the top KPI strips) must be untouched.',
  );
});

test('card size, spacing, icons, and labels inside DNA Results are untouched — only the value font-size changed', () => {
  assertIncludes(styles, '.dashboard-card-row .stat-card {\n  background:', 'DNA Results card background/sizing rule is untouched.');
  assertIncludes(styles, 'min-height: 9rem;', 'DNA Results card min-height is untouched.');
  assertIncludes(styles, '.dashboard-card-row .stat-icon {\n  border-radius: 18px;\n  margin-bottom: 0.7rem;\n  padding: 0.6rem;\n}', 'DNA Results icon sizing is untouched.');
  assertIncludes(styles, '.dashboard-card-row .stat-card span {\n  color: #768397;\n  font-size: 0.73rem;', 'DNA Results label font-size is untouched — only the value size changed.');
  assertIncludes(styles, '.dashboard-card-row {\n  gap: clamp(0.75rem, 1.3vw, 1rem);\n}', 'DNA Results card spacing/gap is untouched.');
});
