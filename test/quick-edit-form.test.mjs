import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Guards DNA 23 Quick Edit v1 (src/main.js): a separate, compact
// single-column layout for split-screen journaling that reuses the same
// trade data, field components, and submitTradeEdit save logic as the
// existing Review edit form. Follows the same "assert source contains"
// convention as test/screenshot-support.test.mjs.

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

function assertIncludes(text, expected, message) {
  assert.ok(text.includes(expected), `${message}\nExpected to find: ${expected}`);
}

test('Quick Edit renders as a separate layout from Review, not a redesign of it', () => {
  assertIncludes(source, 'function editTradeFormQuickEdit(trade)', 'A dedicated Quick Edit form renderer exists, separate from editTradeForm().');
  assertIncludes(source, 'function editTradeForm(trade)', 'The original Review edit form renderer is unchanged and still present.');
  assertIncludes(source, "editingTradeModeByTradeId.get(String(trade.id)) === 'quick' ? editTradeFormQuickEdit(trade) : editTradeForm(trade)", 'The trade card picks Quick Edit vs. Review based on which mode that specific card was opened in (each open card tracks its own mode independently).');
});

test('Quick Edit reuses the same form contract as Review so submitTradeEdit needs no changes', () => {
  assertIncludes(source, 'class="edit-trade-form quick-edit-form" data-edit-trade-form="${escapeHtml(trade.id)}"', 'Quick Edit uses the same data-edit-trade-form attribute the submit handler binds to.');

  // Every field name submitTradeEdit() reads from FormData must exist in the
  // Quick Edit form too, otherwise formData.get() returns null and saving
  // silently overwrites that trade field with the literal string "null".
  // Fields rendered directly as <input> literals check the exact name=
  // attribute; fields rendered through a shared select-renderer (also used
  // by editTradeForm) check that the same renderer function is called,
  // since the literal name="..." attribute lives inside that renderer's own
  // function body, not inside editTradeFormQuickEdit's template string.
  const requiredInputNames = [
    'name="entry"',
    'name="exit"',
    'name="stopLoss"',
    'name="adjustedStopLoss"',
    'name="takeProfit"',
    'name="adjustedTakeProfit"',
    'name="notes"',
    'name="editScreenshot"',
  ];
  const requiredSharedSelectCalls = [
    'renderPlayBookSetupSelect(trade)', // name="setupChoice" / name="setup"
    'renderMarketStateSelect(trade)', // name="state"
    'renderTimeframeSelect(trade)', // name="timeframe"
    'renderTradeManagementSelect(trade)', // name="tradeManagement"
    'renderProtectedDisplay(trade)', // name="protected" (read-only, calculated)
    'renderCloseReasonSelect(trade)', // name="closeReason"
    'renderGradeSelect(trade)', // name="grade"
    'renderOutcomeOverrideSelect(trade)', // name="outcomeOverride"
  ];

  const quickEditStart = source.indexOf('function editTradeFormQuickEdit(trade)');
  const quickEditEnd = source.indexOf('\nfunction getEditScreenshotDraft(tradeId)');
  assert.notEqual(quickEditStart, -1, 'editTradeFormQuickEdit should exist.');
  assert.notEqual(quickEditEnd, -1, 'The function following editTradeFormQuickEdit should exist.');
  const quickEditSource = source.slice(quickEditStart, quickEditEnd);

  for (const fieldName of requiredInputNames) {
    assertIncludes(quickEditSource, fieldName, `Quick Edit must include ${fieldName} so submitTradeEdit() reads the real saved value instead of "null".`);
  }
  for (const rendererCall of requiredSharedSelectCalls) {
    assertIncludes(quickEditSource, rendererCall, `Quick Edit must render its dropdown via ${rendererCall}, the same shared component Review uses, so the field name and options stay in sync.`);
  }

  // Loss Reason is submitTradeEdit()-critical for the same reason and stays
  // conditionally hidden for non-loss trades, matching Review's behavior.
  assertIncludes(quickEditSource, "renderLossReasonSelect(trade)", 'Quick Edit keeps the Loss Reason field so its saved value round-trips.');
  assertIncludes(quickEditSource, "isLossOutcome ? '' : ' hidden'", 'Loss Reason stays hidden for non-loss trades in Quick Edit, same as Review.');
});

test('Quick Edit opens through its own trigger and defaults back to Review afterward', () => {
  assertIncludes(source, "data-quick-edit-trade=\"${escapeHtml(trade.id)}\"", 'A Quick Edit button exists on the trade card alongside the existing Edit button.');
  assertIncludes(source, "openTradeEdit(button.dataset.quickEditTrade, 'quick')", 'The Quick Edit button opens the trade in quick mode.');
  assertIncludes(source, "function openTradeEdit(tradeId, mode = 'full')", 'openTradeEdit defaults to the existing Review layout when no mode is given.');
});

test('closing an edit resets back to Review mode so the next Edit click is unaffected', () => {
  // editingTradeMode became editingTradeModeByTradeId (a Map) so each open
  // card tracks its own mode independently; closing a card now deletes its
  // entry entirely, which has the same effect: the next Edit click on that
  // card gets a fresh mode lookup that misses the Map and falls back to the
  // Review layout (editTradeForm), exactly like the old 'full' default did.
  assertIncludes(source, 'function closeTradeEdit(tradeId) {\n  const key = String(tradeId);\n  editingTradeIds.delete(key);\n  editingTradeModeByTradeId.delete(key);', 'closeTradeEdit(tradeId) clears this card\'s mode so the next Edit click defaults back to Review.');
});

test('v1.1: related fields are paired into two-column rows to fit a 400-450px panel', () => {
  const quickEditStart = source.indexOf('function editTradeFormQuickEdit(trade)');
  const quickEditEnd = source.indexOf('\nfunction getEditScreenshotDraft(tradeId)');
  const quickEditSource = source.slice(quickEditStart, quickEditEnd);

  const pairedRows = [
    ["field('Entry Price'", "field('Exit Price'"],
    ["field('Initial Stop Loss'", "field('Final Stop Loss'"],
    ["field('Initial Take Profit'", "field('Final Take Profit'"],
    ["field('Setup'", "field('State'"],
    ["field('Trade Management'", "field('Protected'"],
    ["field('Exit Reason'", "field('Loss Reason'"],
  ];

  for (const [first, second] of pairedRows) {
    const rowStart = quickEditSource.indexOf('<div class="quick-edit-row">', quickEditSource.indexOf(first) - 60);
    assert.notEqual(rowStart, -1, `${first} should be wrapped in a quick-edit-row.`);
    const rowEnd = quickEditSource.indexOf('</div>', rowStart);
    const row = quickEditSource.slice(rowStart, rowEnd);
    assertIncludes(row, first, `${first} should be paired with ${second} in the same two-column row.`);
    assertIncludes(row, second, `${first} should be paired with ${second} in the same two-column row.`);
  }

  assertIncludes(cssSource, '.quick-edit-row {\n  display: grid;', 'The quick-edit-row class lays fields out as a two-column grid.');
  assertIncludes(cssSource.replace(/quick-edit-row \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/s, 'MATCHED'), 'MATCHED', 'quick-edit-row uses a 2-column grid template.');

  // Timeframe is on its own quick-edit-row, alone — Position was removed
  // from the Setup section (DNA 26), so Timeframe no longer has a partner.
  const timeframeIndex = quickEditSource.indexOf("field('Timeframe'");
  const timeframeRowStart = quickEditSource.lastIndexOf('<div class="quick-edit-row">', timeframeIndex);
  const timeframeRowEnd = quickEditSource.indexOf('</div>', timeframeRowStart);
  const timeframeRow = quickEditSource.slice(timeframeRowStart, timeframeRowEnd);
  assertIncludes(timeframeRow, "field('Timeframe'", 'Timeframe should be in its own quick-edit-row.');
  assert.equal(timeframeRow.includes("field('State'"), false, 'Timeframe should no longer be paired with State (State now pairs with Setup instead).');

  // Grade is the final evaluation step, on its own row beneath Management's
  // quick-edit-row pairs — not paired with anything else.
  const gradeIndex = quickEditSource.indexOf("field('Grade'");
  const nearestRowBeforeGrade = quickEditSource.lastIndexOf('<div class="quick-edit-row">', gradeIndex);
  const nearestRowCloseBeforeGrade = quickEditSource.lastIndexOf('</div>', gradeIndex);
  assert.ok(
    nearestRowCloseBeforeGrade > nearestRowBeforeGrade,
    "Grade should render after the preceding quick-edit-row has already closed — it is not inside any quick-edit-row.",
  );
});

test('v1.1: Notes stays at 3 rows and Screenshot is collapsed by default behind a Show/Hide toggle', () => {
  const quickEditStart = source.indexOf('function editTradeFormQuickEdit(trade)');
  const quickEditEnd = source.indexOf('\nfunction getEditScreenshotDraft(tradeId)');
  const quickEditSource = source.slice(quickEditStart, quickEditEnd);

  assertIncludes(quickEditSource, 'name="notes" rows="3"', 'Notes defaults to 3 rows in Quick Edit.');
  assertIncludes(quickEditSource, '<details class="edit-collapsible quick-edit-screenshot">', 'Screenshot is wrapped in a collapsed-by-default <details> toggle (no "open" attribute).');
  assert.ok(!quickEditSource.includes('quick-edit-screenshot" open'), 'The Screenshot <details> must not default to open.');
  assertIncludes(quickEditSource, 'quick-edit-toggle-label">Show/Hide', 'The Screenshot toggle is labeled Show/Hide.');
});
