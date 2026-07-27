import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Guards the Manual Trade data-loss fix (src/main.js).
//
// Root cause: isTradeEditLocked() only ever checked editingTradeId (the
// trade-card edit form). render() rebuilds the entire DOM from scratch
// (app.innerHTML = ...) every time it runs, and the Manual Trade form's
// Entry/Exit/Symbol/etc. fields are plain uncontrolled <input> elements —
// their typed values live only in the DOM, never in JS state — so any
// render() while the form was open silently wiped whatever the user had
// typed. This was never specific to the cTrader Auto Sync interval:
// syncCTrader() used to call render() at the start and end of every sync, and
// persistTrades()/cloud annotation merges can still redraw changed trades, so the
// exact same data loss could already happen at the old 60s interval, from a
// cloud-annotation refresh, or on a slow connection. A shorter interval
// only raised how often a render landed while someone was mid-form.
//
// Fix: isTradeEditLocked() now also covers isManualTradeFormOpen. Every
// render() call already funnels through this one check, and
// syncCTraderOnStartup() already skips syncing entirely while locked — so
// this one change also stops Auto Sync from even attempting a background
// sync while the form is open, regardless of the polling interval.

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

function assertIncludes(text, expected, message) {
  assert.ok(text.includes(expected), `${message}\nExpected to find: ${expected}`);
}

test('isTradeEditLocked() covers the Manual Trade form, not just the trade-card edit form', () => {
  // editingTradeId became editingTradeIds (a Set) so multiple trade cards
  // can be open in Edit mode at once, but the lock semantics are unchanged:
  // it is true whenever any card is open OR the Manual Trade form is open.
  assertIncludes(source, 'function isTradeEditLocked() {\n  return editingTradeIds.size > 0 || isManualTradeFormOpen;\n}', 'The edit lock must also be true while the Manual Trade form is open.');
});

test('render() itself is the single choke point this protects — no separate guard was bolted on elsewhere', () => {
  assertIncludes(source, 'if (isTradeEditLocked() && !options.force) {\n    return;\n  }', 'render() still bails out entirely (no DOM rebuild at all) whenever the lock is on, whatever set it.');
});

test('cTrader Auto Sync checks the lock before doing any work, so background sync cannot touch an open form', () => {
  const fnStart = source.indexOf('async function syncCTraderOnStartup() {');
  const fnEnd = source.indexOf('\nfunction exportTrades(');
  assert.notEqual(fnStart, -1, 'syncCTraderOnStartup should exist.');
  const fnBody = source.slice(fnStart, fnEnd);

  // The lock check must be the very first thing in the function — before
  // checking the connection, before touching cTraderSyncStatus, before any
  // cTrader card UI update — so an open Manual Trade form blocks the network
  // request itself, not just the render.
  const lockCheckIndex = fnBody.indexOf('if (isTradeEditLocked()) {');
  const firstUiUpdateIndex = fnBody.indexOf('refreshCTraderConnectionCard();');
  const firstStatusIndex = fnBody.indexOf('cTraderSyncStatus =');
  assert.notEqual(lockCheckIndex, -1, 'syncCTraderOnStartup must check the edit lock.');
  assert.ok(lockCheckIndex < firstUiUpdateIndex, 'The lock check must come before any cTrader card UI update in this function.');
  assert.ok(lockCheckIndex < firstStatusIndex, 'The lock check must come before any status update, i.e. before any sync work starts at all.');
});

test('opening, closing, and saving the Manual Trade form force their own render through the lock they just changed', () => {
  // Opening/closing (toggleManualTradeForm): the very act of opening sets
  // isManualTradeFormOpen = true, which would make isTradeEditLocked()
  // true and silently block a plain render() from ever showing the form.
  assertIncludes(source, 'function toggleManualTradeForm() {', 'toggleManualTradeForm should exist.');
  const toggleStart = source.indexOf('function toggleManualTradeForm() {');
  const toggleEnd = source.indexOf('\nfunction deleteAllCTraderImports() {');
  const toggleBody = source.slice(toggleStart, toggleEnd);
  assertIncludes(toggleBody, 'scheduleCTraderAutoSync();', 'Opening/closing the form reschedules Auto Sync — same pattern as openTradeEdit()/closeTradeEdit() — so the interval timer is actually cleared while locked, not just skipped per-tick.');
  assertIncludes(toggleBody, 'render({ force: true });', 'toggleManualTradeForm forces its own render through the lock it just set/cleared.');

  // Saving (submitTrade): must release the lock *before* persisting, so
  // persistTrades()'s own render() call (not a forced one) is naturally
  // unlocked, and Auto Sync can resume immediately.
  assertIncludes(source, 'async function submitTrade(event) {', 'submitTrade should exist.');
  const submitStart = source.indexOf('async function submitTrade(event) {');
  const submitEnd = source.indexOf('\nasync function submitTradeEdit(event) {');
  const submitBody = source.slice(submitStart, submitEnd);
  const lockReleaseIndex = submitBody.indexOf('isManualTradeFormOpen = false;');
  const rescheduleIndex = submitBody.indexOf('scheduleCTraderAutoSync();');
  const persistIndex = submitBody.indexOf('persistTrades([nextTrade, ...trades]);');
  assert.notEqual(lockReleaseIndex, -1, 'submitTrade must release isManualTradeFormOpen.');
  assert.ok(lockReleaseIndex < persistIndex, 'The lock must be released before persisting, so the save is guaranteed to render and Auto Sync resumes right away — this also means Save works correctly even if a sync completes at the same moment.');
  assert.ok(rescheduleIndex !== -1 && rescheduleIndex < persistIndex, 'Auto Sync is rescheduled before persisting too.');

  // openJournalForCalendarDate can also set isManualTradeFormOpen and must
  // force its own render the same way.
  const calendarStart = source.indexOf('function openJournalForCalendarDate(dateKey) {');
  const calendarEnd = source.indexOf('\nfunction getFilteredTrades() {');
  const calendarBody = source.slice(calendarStart, calendarEnd);
  assertIncludes(calendarBody, 'scheduleCTraderAutoSync();', 'Jumping to a calendar date reschedules Auto Sync the same way.');
  assertIncludes(calendarBody, 'render({ force: true });', 'Jumping to a calendar date forces its own render through the lock it may have just set.');
});

test('the doubled "+" icon bug is fixed — no plus icon is paired with a literal "+" in the label', () => {
  assert.equal(source.includes("'+ Add Manual Trade'"), false, 'The button label must not include a redundant literal "+" alongside its icon.');
  // Follow-up UI polish: the closed-state icon was swapped from a generic
  // plus to the notebook/journal icon ('book', already used for Journal
  // entries and Notes) to better match DNA's journaling theme. The
  // open-state ('minus', Hide) icon is unchanged.
  assertIncludes(source, "${icon(isManualTradeFormOpen ? 'minus' : 'book')} ${isManualTradeFormOpen ? 'Hide Manual Trade Form' : 'Add Manual Trade'}", 'The button renders the notebook icon and a plain "Add Manual Trade" label when closed.');
});

test('the manual "Sync cTrader" button is unaffected — this fix only touches background Auto Sync gating', () => {
  assertIncludes(source, 'async function syncCTrader(options = {}) {', 'The underlying sync function is untouched.');
  const fnStart = source.indexOf('async function syncCTrader(options = {}) {');
  const fnEnd = source.indexOf('\nfunction buildCTraderSyncRequestPath(');
  const fnBody = source.slice(fnStart, fnEnd);
  assert.equal(fnBody.includes('isTradeEditLocked'), false, 'syncCTrader() itself still has no lock check — a manual Sync click still runs and updates data; only background Auto Sync is gated by the edit lock.');
  assertIncludes(fnBody, 'refreshCTraderConnectionCard();', 'Manual sync status updates only the cTrader card instead of rebuilding the full app.');
});
