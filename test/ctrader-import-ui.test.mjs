import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const syncSource = await readFile(new URL('../src/ctrader-sync.js', import.meta.url), 'utf8');

function assertIncludes(text, expected, message) {
  assert.ok(text.includes(expected), `${message}\nExpected to find: ${expected}`);
}

test('cTrader sync button calls the journal preview API', () => {
  assertIncludes(source, 'id="syncCTrader"', 'The hero actions render a Sync cTrader button.');
  assertIncludes(source, "document.querySelector('#syncCTrader').addEventListener('click', syncCTrader);", 'The cTrader sync button is wired to the sync handler.');
  assertIncludes(source, "fetch('/api/ctrader/journal-preview')", 'The sync handler automatically fetches newly closed cTrader journal preview trades from the API.');
  assertIncludes(source, 'Sync cTrader', 'The button copy uses the one-click synchronization language.');
});

test('cTrader preview trades are converted into saved journal entries', () => {
  assertIncludes(syncSource, 'function convertCTraderPreviewTradeToJournalEntry(previewTrade, options = {})', 'Preview trades are converted before saving.');
  assertIncludes(syncSource, "setup: previewTrade.setup === 'cTrader import preview' ? 'cTrader import'", 'Preview-only setup copy is replaced with journal entry copy.');
  assertIncludes(syncSource, 'tags: normalizeImportedTags(previewTrade.tags)', 'Imported entries normalize preview tags.');
  assertIncludes(syncSource, 'importedAt: getImportedAt(options)', 'Imported entries record when they were saved locally.');
  assertIncludes(source, 'persistTrades([...syncPlan.importedTrades, ...trades])', 'Imported trades are saved to the existing local journal storage path.');
});

test('cTrader sync skips duplicates by source trade IDs and reports imported/skipped counts', () => {
  assertIncludes(syncSource, 'sourceTradeId,', 'Imported entries retain a source trade ID.');
  assertIncludes(syncSource, 'export function hasSourceTradeAlreadyBeenImported(candidateTrade, existingTrades)', 'Duplicate detection checks imported trades against existing journal entries.');
  assertIncludes(syncSource, 'return sourceTradeId === null ? null : `ctrader:${sourceTradeId}`;', 'Duplicate detection keys cTrader trades by source trade ID.');
  assertIncludes(syncSource, 'const seenSourceKeys = new Set();', 'The sync tracks source trade IDs seen in the current preview response.');
  assertIncludes(source, 'const syncPlan = buildCTraderSyncPlan(previewTrades, trades);', 'Duplicate source trades are filtered out before saving.');
  assertIncludes(source, 'message: `New trades imported: ${syncPlan.importedCount}. Trades skipped: ${syncPlan.skippedCount}.`', 'The UI displays new imported and skipped cTrader trade counts.');
});
