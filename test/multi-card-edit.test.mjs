import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Guards "multiple trade cards open in Edit mode at once" (src/main.js).
//
// Before this change, editingTradeId was a single scalar: opening a second
// card's edit form did not close the first one visually, but it silently
// stopped being tracked as "the" open card, so Cancel/Save/the edit lock
// could behave inconsistently once more than one card was open.
//
// Fix: editingTradeId -> editingTradeIds (a Set, one entry per open card)
// and editingTradeMode -> editingTradeModeByTradeId (a Map, so two open
// cards can independently be in 'full' or 'quick' mode). A new dirtyTradeIds
// Set tracks which open cards actually have unsaved changes (a card can be
// open but untouched), driving a "Save All Changes" button and a
// beforeunload warning. Individual Save/Cancel and the cTrader Auto Sync
// edit lock all continue to funnel through the same isTradeEditLocked()
// choke point, now sized to the whole Set instead of a single id.

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

function assertIncludes(text, expected, message) {
  assert.ok(text.includes(expected), `${message}\nExpected to find: ${expected}`);
}

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

// Loads the real openTradeEdit/closeTradeEdit/isTradeEditLocked/
// markTradeEditDirty function bodies (extracted verbatim from src/main.js)
// into a sandbox, with their DOM/network side effects (renderTradeCardInPlace,
// scheduleCTraderAutoSync, updateSaveAllButtonVisibility) replaced by
// call-counting stubs. This tests the real Set/Map state-transition logic
// without needing a browser DOM.
function loadEditStateModule() {
  const code = [
    'let editingTradeIds = new Set();',
    'let editingTradeModeByTradeId = new Map();',
    'let dirtyTradeIds = new Set();',
    'let isManualTradeFormOpen = false;',
    'const calls = { scheduleCTraderAutoSync: 0, renderTradeCardInPlace: [], updateSaveAllButtonVisibility: 0 };',
    'function scheduleCTraderAutoSync() { calls.scheduleCTraderAutoSync += 1; }',
    'function renderTradeCardInPlace(tradeId) { calls.renderTradeCardInPlace.push(tradeId); }',
    'function updateSaveAllButtonVisibility() { calls.updateSaveAllButtonVisibility += 1; }',
    extractFunction('isTradeEditLocked'),
    extractFunction('openTradeEdit'),
    extractFunction('closeTradeEdit'),
    extractFunction('markTradeEditDirty'),
    'module.exports = { editingTradeIds, editingTradeModeByTradeId, dirtyTradeIds, isTradeEditLocked, openTradeEdit, closeTradeEdit, markTradeEditDirty, calls };',
  ].join('\n\n');

  const context = { module: { exports: {} } };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'main.js (extracted multi-card edit state)' });
  return context.module.exports;
}

test('opening a second card does not close the first — both stay in editingTradeIds with independent modes', () => {
  const m = loadEditStateModule();

  m.openTradeEdit('trade-1', 'full');
  m.openTradeEdit('trade-2', 'quick');

  assert.equal(m.editingTradeIds.size, 2, 'Both cards should be tracked as open at once.');
  assert.ok(m.editingTradeIds.has('trade-1'), 'The first card should still be open.');
  assert.ok(m.editingTradeIds.has('trade-2'), 'The second card should also be open.');
  assert.equal(m.editingTradeModeByTradeId.get('trade-1'), 'full', 'The first card keeps its own mode (full).');
  assert.equal(m.editingTradeModeByTradeId.get('trade-2'), 'quick', 'The second card keeps its own mode (quick), independent of the first.');
  // Compared as JSON rather than assert.deepEqual: the array was built
  // inside a separate vm context (a different realm), so its Array
  // prototype differs from this file's even when the contents match —
  // JSON.stringify sidesteps that and compares the actual values.
  assert.equal(JSON.stringify(m.calls.renderTradeCardInPlace), JSON.stringify(['trade-1', 'trade-2']), 'Opening a card only ever re-renders that one card in place, never the whole list.');
});

test('closing one card (Cancel or Save) only affects that card, leaving other open cards and their dirty state untouched', () => {
  const m = loadEditStateModule();

  m.openTradeEdit('trade-1');
  m.openTradeEdit('trade-2');
  m.markTradeEditDirty('trade-1');
  m.markTradeEditDirty('trade-2');

  m.closeTradeEdit('trade-1');

  assert.equal(m.editingTradeIds.has('trade-1'), false, 'trade-1 should be closed.');
  assert.equal(m.editingTradeIds.has('trade-2'), true, 'trade-2 should remain open.');
  assert.equal(m.dirtyTradeIds.has('trade-1'), false, 'trade-1 should no longer be tracked as dirty once closed.');
  assert.equal(m.dirtyTradeIds.has('trade-2'), true, 'trade-2\'s unsaved-changes state must be untouched by closing a different card.');
  assert.equal(m.editingTradeModeByTradeId.has('trade-1'), false, 'trade-1\'s mode entry is cleared.');
  assert.equal(m.editingTradeModeByTradeId.has('trade-2'), true, 'trade-2\'s mode entry is untouched.');
});

test('closeTradeEdit is safe to call for a card that was never open (used defensively by the delete handler)', () => {
  const m = loadEditStateModule();
  assert.doesNotThrow(() => m.closeTradeEdit('never-opened'), 'Closing a card that was never open must be a safe no-op.');
  assert.equal(m.editingTradeIds.size, 0, 'Nothing should be added by closing a card that was not open.');
});

test('the edit lock (isTradeEditLocked) is true whenever any number of cards are open, and false only once every card is closed', () => {
  const m = loadEditStateModule();
  assert.equal(m.isTradeEditLocked(), false, 'Locked should start false.');

  m.openTradeEdit('trade-1');
  assert.equal(m.isTradeEditLocked(), true, 'One open card should lock.');

  m.openTradeEdit('trade-2');
  assert.equal(m.isTradeEditLocked(), true, 'Still locked with two cards open.');

  m.closeTradeEdit('trade-1');
  assert.equal(m.isTradeEditLocked(), true, 'Still locked while trade-2 remains open — Auto Sync must stay paused.');

  m.closeTradeEdit('trade-2');
  assert.equal(m.isTradeEditLocked(), false, 'Unlocked only once every open card has been closed.');
});

test('markTradeEditDirty only flags the button-visibility update once per card (no redundant DOM churn on every keystroke)', () => {
  const m = loadEditStateModule();
  m.openTradeEdit('trade-1');

  m.markTradeEditDirty('trade-1');
  m.markTradeEditDirty('trade-1');
  m.markTradeEditDirty('trade-1');

  assert.equal(m.dirtyTradeIds.size, 1, 'Marking the same card dirty repeatedly should not duplicate it.');
  assert.equal(m.calls.updateSaveAllButtonVisibility, 1, 'The lightweight visibility update should only fire on the first keystroke that made the card dirty, not every subsequent keystroke.');
});

test('opening/closing a card reschedules cTrader Auto Sync (so the interval timer is actually cleared/resumed, same as before this change)', () => {
  const m = loadEditStateModule();
  m.openTradeEdit('trade-1');
  m.closeTradeEdit('trade-1');
  assert.equal(m.calls.scheduleCTraderAutoSync, 2, 'Both opening and closing a card should reschedule Auto Sync.');
});

test('the trade card picks isEditing and its mode per-card from the Sets/Maps, not a shared scalar', () => {
  assertIncludes(source, 'const isEditing = editingTradeIds.has(String(trade.id));', 'Whether a specific card is in Edit mode is looked up per trade id.');
  assertIncludes(source, "editingTradeModeByTradeId.get(String(trade.id)) === 'quick' ? editTradeFormQuickEdit(trade) : editTradeForm(trade)", 'Each card independently picks Quick Edit vs Review based on its own mode entry.');
});

test('Cancel always scopes to the clicked card only — no equality guard against a single shared editing id', () => {
  const fnStart = source.indexOf("tradeCardElement.querySelectorAll('[data-cancel-edit-trade]')");
  const fnEnd = source.indexOf("tradeCardElement.querySelectorAll('[data-edit-trade-form]')");
  const body = source.slice(fnStart, fnEnd);
  assertIncludes(body, 'closeTradeEdit(tradeId);', 'Cancel closes exactly the clicked card.');
  assertIncludes(body, 'renderTradeCardInPlace(tradeId);', 'Cancel only re-renders the clicked card, leaving every other open card\'s DOM (and unsaved values) untouched.');
});

test('Delete closes that card\'s own edit state defensively before soft-deleting it', () => {
  const fnStart = source.indexOf("tradeCardElement.querySelectorAll('[data-delete-trade]')");
  const body = source.slice(fnStart, fnStart + 400);
  assertIncludes(body, 'closeTradeEdit(button.dataset.deleteTrade);', 'Deleting a trade clears its own edit/dirty state.');
  assertIncludes(body, 'softDeleteTrade(button.dataset.deleteTrade);', 'Delete still calls the existing soft-delete function, unchanged.');
});

test('each open card tracks its own unsaved-changes state via input/change listeners on that card\'s own form', () => {
  const fnStart = source.indexOf("tradeCardElement.querySelectorAll('[data-edit-trade-form]')");
  const fnEnd = source.indexOf("tradeCardElement.querySelectorAll('[data-edit-screenshot-input]')");
  const body = source.slice(fnStart, fnEnd);
  assertIncludes(body, "form.addEventListener('submit', submitTradeEdit);", 'The existing per-card Save (submit) handler is unchanged.');
  assertIncludes(body, "const tradeId = form.dataset.editTradeForm;", 'Dirty tracking is scoped to this exact card\'s own tradeId.');
  assertIncludes(body, "form.addEventListener('input', () => markTradeEditDirty(tradeId));", 'Typing in a card marks only that card dirty.');
  assertIncludes(body, "form.addEventListener('change', () => markTradeEditDirty(tradeId));", 'Selecting/choosing a value (change-only inputs like <select>) also marks that card dirty.');
});

test('submitTradeEdit (individual Save) and saveAllEditedTrades share one extraction function, so they cannot drift apart', () => {
  assertIncludes(source, 'async function buildTradeEditUpdate(form) {', 'A single shared function reads one form into { tradeId, journalingUpdates, screenshotUpdate }.');
  assertIncludes(source, 'const { tradeId, journalingUpdates, screenshotUpdate } = await buildTradeEditUpdate(form);', 'submitTradeEdit (individual Save) uses the shared extraction.');
  assertIncludes(source, 'updates.push(await buildTradeEditUpdate(form));', 'saveAllEditedTrades uses the exact same shared extraction, field for field, as the individual Save button.');
});

test('individual Save (submitTradeEdit) is otherwise unchanged: closes only its own card, persists, and pushes its own annotation', () => {
  const fnStart = source.indexOf('async function submitTradeEdit(event) {');
  const fnEnd = source.indexOf('\n// "Save All Changes"', fnStart);
  const body = source.slice(fnStart, fnEnd);
  assertIncludes(body, 'closeTradeEdit(tradeId);', 'Saving closes exactly the card that was saved.');
  assertIncludes(body, "{ preserveTradeId: tradeId, renderOptions: { force: true } }", 'Saving still preserves scroll position on the saved card.');
  assertIncludes(body, 'pushTradeAnnotationToCloud(tradeId, extractAnnotationFields(journalingUpdates));', 'Saving still pushes only that trade\'s annotation to the cloud.');
});

test('Save All Changes only saves cards with actual unsaved edits, leaving merely-open (untouched) cards alone', () => {
  assertIncludes(source, 'async function saveAllEditedTrades() {', 'A dedicated Save All function exists.');
  const fnStart = source.indexOf('async function saveAllEditedTrades() {');
  const fnEnd = source.indexOf('\nfunction updateSaveAllButtonVisibility() {');
  const body = source.slice(fnStart, fnEnd);
  assertIncludes(body, 'const dirtyIds = [...dirtyTradeIds];', 'Save All only iterates cards flagged dirty, not every open card.');
  assertIncludes(body, 'if (!dirtyIds.length) {\n    return;\n  }', 'Save All is a no-op when nothing is dirty (the button is hidden in that case anyway).');
  assertIncludes(body, 'return update ? { ...trade, ...update.journalingUpdates, ...update.screenshotUpdate } : trade;', 'A trade with no matching dirty update passes through completely unchanged.');
  assertIncludes(body, 'closeTradeEdit(tradeId);', 'Each saved card is individually closed.');
  assertIncludes(body, 'render({ force: true });', 'Save All forces its own render, since other open-but-clean cards may still hold the edit lock.');
  assertIncludes(body, 'pushTradeAnnotationToCloud(tradeId, extractAnnotationFields(update.journalingUpdates));', 'Save All pushes a cloud annotation update for every saved card, same as individual Save.');
});

test('the Save All Changes button exists once in the journal header, hidden by default, and is wired to saveAllEditedTrades', () => {
  assertIncludes(source, 'data-save-all-trades', 'A dedicated Save All button element exists.');
  assertIncludes(source, "${dirtyTradeIds.size === 0 ? ' hidden' : ''}", 'The button starts hidden whenever nothing is dirty.');
  assertIncludes(source, "document.querySelector('[data-save-all-trades]')?.addEventListener('click', saveAllEditedTrades, { signal });", 'Clicking the button runs Save All.');
  const occurrences = (source.match(/data-save-all-trades/g) ?? []).length;
  assert.ok(occurrences >= 2, 'The button markup and its click binding should both reference the same data attribute.');
});

test('the Save All button visibility toggles via direct DOM update, never via a full render (so it cannot wipe other open cards)', () => {
  assertIncludes(source, 'function updateSaveAllButtonVisibility() {', 'A dedicated lightweight visibility updater exists.');
  const fnStart = source.indexOf('function updateSaveAllButtonVisibility() {');
  const fnEnd = source.indexOf('\nfunction markTradeEditDirty(tradeId) {');
  const body = source.slice(fnStart, fnEnd);
  assertIncludes(body, 'button.hidden = dirtyTradeIds.size === 0;', 'Visibility is toggled directly on the existing DOM element.');
  assert.equal(body.includes('render('), false, 'This function must never call render() — that would rebuild the whole page and wipe every open card\'s unsaved (uncontrolled) input values.');
});

test('a beforeunload warning is armed exactly while any card has unsaved changes, and disarmed once none do', () => {
  assertIncludes(source, 'function handleBeforeUnload(event) {', 'A dedicated beforeunload handler exists.');
  assertIncludes(source, 'event.preventDefault();\n  event.returnValue = \'\';', 'The handler triggers the browser\'s native "leave site?" confirmation.');
  assertIncludes(source, 'function updateUnsavedChangesWarning() {', 'A dedicated function keeps the listener in sync with dirty state.');
  const fnStart = source.indexOf('function updateUnsavedChangesWarning() {');
  const fnEnd = source.indexOf('\nfunction updateRiskPercentField(event) {');
  const body = source.slice(fnStart, fnEnd);
  assertIncludes(body, 'const shouldWarn = dirtyTradeIds.size > 0;', 'The warning is armed based on whether any card has unsaved edits.');
  assertIncludes(body, "window.addEventListener('beforeunload', handleBeforeUnload);", 'The listener is attached once a card becomes dirty.');
  assertIncludes(body, "window.removeEventListener('beforeunload', handleBeforeUnload);", 'The listener is removed once no card is dirty any more (e.g. after Save All, individual Save, or Cancel).');
});

test('cTrader Auto Sync protection is unchanged in shape: it still funnels through isTradeEditLocked(), now sized to every open card', () => {
  assertIncludes(source, 'if (!isCTraderAutoSyncEnabled || isTradeEditLocked()) {', 'scheduleCTraderAutoSync still refuses to schedule while any card (or the Manual Trade form) is open.');
  assertIncludes(source, `async function syncCTraderOnStartup() {\n  if (isTradeEditLocked()) {`, 'Background sync still bails out before doing any work while any card is open.');
});
