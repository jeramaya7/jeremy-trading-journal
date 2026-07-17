import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Guards the Manual Trade button's new position (src/main.js): moved to the
// top of the journal panel, above the trade list, instead of below the
// entire trade list. Same button id, same form, same save logic — only its
// position in renderJournalWorkspace() changed.

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

function assertIncludes(text, expected, message) {
  assert.ok(text.includes(expected), `${message}\nExpected to find: ${expected}`);
}

test('the Manual Trade panel renders before the trade list, inside the journal panel', () => {
  const fnStart = source.indexOf('function renderJournalWorkspace(filteredTrades, today, options = {}) {');
  const fnEnd = source.indexOf('\nfunction renderManualTradeForm(today) {');
  assert.notEqual(fnStart, -1, 'renderJournalWorkspace should exist.');
  assert.notEqual(fnEnd, -1, 'renderManualTradeForm should exist right after it.');
  const fnBody = source.slice(fnStart, fnEnd);

  const manualPanelIndex = fnBody.indexOf('class="manual-trade-panel"');
  const tradeListIndex = fnBody.indexOf('class="trade-list"');
  assert.notEqual(manualPanelIndex, -1, 'The manual-trade-panel section should still render.');
  assert.notEqual(tradeListIndex, -1, 'The trade-list should still render.');
  assert.ok(manualPanelIndex < tradeListIndex, 'The Manual Trade panel must render before (above) the trade list, not after it.');

  const journalHeaderIndex = fnBody.indexOf('class="journal-header"');
  assert.ok(journalHeaderIndex < manualPanelIndex, 'The Manual Trade panel should render right after the journal header, at the very top of the panel.');
});

test('there is still exactly one Manual Trade toggle button, unchanged form and save logic', () => {
  const occurrences = (source.match(/id="toggleManualTrade"/g) ?? []).length;
  assert.equal(occurrences, 1, 'Moving the button must not create a second one.');

  assertIncludes(source, "document.querySelector('#toggleManualTrade')?.addEventListener('click', toggleManualTradeForm", 'The button is still wired to the existing toggle handler.');
  assertIncludes(source, 'function renderManualTradeForm(today) {', 'The manual trade form renderer is untouched.');
  assertIncludes(source, 'async function submitTrade(event) {', 'The manual trade save handler is untouched.');
  assertIncludes(source, "tradeForm.addEventListener('submit', submitTrade", 'The manual trade form still saves through the existing submit handler.');
});

test('Trading Mode still hides the Manual Trade panel (unchanged gating, only position changed)', () => {
  assertIncludes(source, 'const showManualTradePanel = options.showManualTradePanel !== false;', 'The showManualTradePanel gate is unchanged.');
  assertIncludes(source, "renderJournalWorkspace(filteredTrades, today, { showManualTradePanel: false })", 'Trading Mode still opts out of the Manual Trade panel.');
});
