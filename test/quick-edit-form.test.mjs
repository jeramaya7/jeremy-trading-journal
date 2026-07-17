import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Guards DNA 23 Quick Edit v1 (src/main.js): a separate, compact
// single-column layout for split-screen journaling that reuses the same
// trade data, field components, and submitTradeEdit save logic as the
// existing Review edit form. Follows the same "assert source contains"
// convention as test/screenshot-support.test.mjs.

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

function assertIncludes(text, expected, message) {
  assert.ok(text.includes(expected), `${message}\nExpected to find: ${expected}`);
}

test('Quick Edit renders as a separate layout from Review, not a redesign of it', () => {
  assertIncludes(source, 'function editTradeFormQuickEdit(trade)', 'A dedicated Quick Edit form renderer exists, separate from editTradeForm().');
  assertIncludes(source, 'function editTradeForm(trade)', 'The original Review edit form renderer is unchanged and still present.');
  assertIncludes(source, "editingTradeMode === 'quick' ? editTradeFormQuickEdit(trade) : editTradeForm(trade)", 'The trade card picks Quick Edit vs. Review based on which mode was opened.');
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
    'renderPositionTypeSelect(trade)', // name="position"
    'renderMarketStateSelect(trade)', // name="state"
    'renderTimeframeSelect(trade)', // name="timeframe"
    'renderTradeManagementSelect(trade)', // name="tradeManagement"
    'renderProtectedSelect(trade)', // name="protected"
    'renderCloseReasonSelect(trade)', // name="closeReason"
    'renderGradeSelect(trade)', // name="grade"
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
  assertIncludes(source, "function closeTradeEdit() {\n  editingTradeId = null;\n  editingTradeMode = 'full';", 'closeTradeEdit() resets editingTradeMode back to full/Review.');
});
