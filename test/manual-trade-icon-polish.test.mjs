import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// UI polish only (src/main.js): the Manual Trade button's closed-state icon
// was swapped from a generic "+" to the notebook/journal icon ('book',
// already used for Journal entries and Notes) to better match DNA's
// journaling theme. No form, save, sync, Trash, or dashboard behavior
// changed — this only touches the icon and confirms both buttons stay
// byte-for-byte identical, since Journal Entries and Trading Mode both
// render through the same renderJournalWorkspace() template.

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

function assertIncludes(text, expected, message) {
  assert.ok(text.includes(expected), `${message}\nExpected to find: ${expected}`);
}

test('the Manual Trade button uses the notebook/journal icon, not a plus, when closed', () => {
  assertIncludes(source, "${icon(isManualTradeFormOpen ? 'minus' : 'book')}", 'The closed-state icon is the notebook/journal icon.');
  assert.equal(source.includes("id=\"toggleManualTrade\""), true, 'The button id is unchanged.');
});

test('Journal Entries and Trading Mode render the exact same button — same icon, text, size, spacing, and hover state, by construction', () => {
  // There is only one manual-trade-toggle button template in the whole
  // file. Both Dashboard Mode's journalWorkspaceSection and Trading Mode's
  // tradingModeSections call the same renderJournalWorkspace(), so this one
  // occurrence *is* both buttons — they cannot drift apart in markup, and
  // therefore cannot drift apart in the CSS that styles them.
  const occurrences = (source.match(/class="secondary-button manual-trade-toggle"/g) ?? []).length;
  assert.equal(occurrences, 1, 'Only one manual-trade-toggle button template should exist in the source.');

  const journalCallIndex = source.indexOf('const journalWorkspaceSection = renderJournalWorkspace(filteredTrades, today);');
  const tradingCallIndex = source.indexOf("renderJournalWorkspace(filteredTrades, today, { isTradingMode: true })");
  assert.notEqual(journalCallIndex, -1, 'Dashboard Mode should render the journal workspace.');
  assert.notEqual(tradingCallIndex, -1, 'Trading Mode should render the journal workspace.');

  // Only one CSS rule targets .manual-trade-toggle, and it is not scoped
  // under .trading-mode-journal-panel — so hover/size/spacing cannot differ
  // between the two contexts.
  const toggleRuleOccurrences = (styles.match(/\.manual-trade-toggle\s*\{/g) ?? []).length;
  assert.equal(toggleRuleOccurrences, 1, 'Only one CSS rule should target .manual-trade-toggle.');
  assert.equal(styles.includes('.trading-mode-journal-panel .manual-trade-toggle'), false, 'No Trading-Mode-specific override should exist for this button — it must look identical in both places.');
});

test('the button keeps its existing .secondary-button styling — no new button style was introduced', () => {
  assertIncludes(source, 'class="secondary-button manual-trade-toggle"', 'The button still uses the shared secondary-button base class alongside its own modifier class.');
});
