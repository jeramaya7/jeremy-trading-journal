import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

function assertIncludes(text, expected, message) {
  assert.ok(text.includes(expected), `${message}\nExpected to find: ${expected}`);
}

test('cTrader import button calls the journal preview API', () => {
  assertIncludes(source, 'id="importCTrader"', 'The hero actions render an Import from cTrader button.');
  assertIncludes(source, "document.querySelector('#importCTrader').addEventListener('click', importFromCTrader);", 'The cTrader import button is wired to the import handler.');
  assertIncludes(source, "fetch('/api/ctrader/journal-preview')", 'The import handler loads cTrader journal preview trades from the API.');
});

test('cTrader preview trades are converted into saved journal entries', () => {
  assertIncludes(source, 'function convertCTraderPreviewTradeToJournalEntry(previewTrade)', 'Preview trades are converted before saving.');
  assertIncludes(source, "setup: previewTrade.setup === 'cTrader import preview' ? 'cTrader import'", 'Preview-only setup copy is replaced with journal entry copy.');
  assertIncludes(source, "tags: normalizeImportedTags(previewTrade.tags)", 'Imported entries normalize preview tags.');
  assertIncludes(source, 'importedAt: new Date().toISOString()', 'Imported entries record when they were saved locally.');
  assertIncludes(source, 'persistTrades([...importedTrades, ...trades])', 'Imported trades are saved to the existing local journal storage path.');
});

test('cTrader imports skip duplicates by source trade IDs and report success counts', () => {
  assertIncludes(source, 'sourceTradeId,', 'Imported entries retain a source trade ID.');
  assertIncludes(source, 'function hasSourceTradeAlreadyBeenImported(candidateTrade, existingTrades)', 'Duplicate detection checks imported trades against existing journal entries.');
  assertIncludes(source, 'return sourceTradeId === null ? null : `ctrader:${sourceTradeId}`;', 'Duplicate detection keys cTrader trades by source trade ID.');
  assertIncludes(source, 'const seenSourceKeys = new Set();', 'The import tracks source trade IDs seen in the current preview response.');
  assertIncludes(source, '.filter((trade) => shouldImportCTraderTrade(trade, trades, seenSourceKeys))', 'Duplicate source trades are filtered out before saving.');
  assertIncludes(source, 'message: `Imported ${importedTrades.length} cTrader ${importedTrades.length === 1 ? \'trade\' : \'trades\'}.${duplicateMessage}`', 'The UI displays the number of imported cTrader trades.');
});
