import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCTraderSyncPlan,
  convertCTraderPreviewTradeToJournalEntry,
  getImportedTradeSourceKey,
  hasSourceTradeAlreadyBeenImported,
  shouldImportCTraderTrade,
} from '../src/ctrader-sync.js';

const closedPreviewTrade = {
  id: 'ctrader-501',
  provider: 'ctrader',
  accountId: 12345,
  sourceDealId: 501,
  sourcePositionId: 9001,
  symbol: 'EURUSD',
  direction: 'Long',
  entry: 1.1,
  exit: 1.105,
  size: 100000,
  closeTime: '2026-06-12T14:30:00.000Z',
  date: '2026-06-12',
  fees: 7,
  setup: 'cTrader import preview',
  emotion: '',
  tags: 'ctrader, import-preview',
  notes: 'Preview only. Not saved to the journal.',
};

test('cTrader sync converts preview trades into journal entries', () => {
  const journalTrade = convertCTraderPreviewTradeToJournalEntry(closedPreviewTrade, {
    now: () => Date.parse('2026-06-12T15:00:00.000Z'),
  });

  assert.equal(journalTrade.id, 'ctrader-501');
  assert.equal(journalTrade.provider, 'ctrader');
  assert.equal(journalTrade.sourceTradeId, '501');
  assert.equal(journalTrade.setup, 'cTrader import');
  assert.equal(journalTrade.emotion, 'Imported');
  assert.equal(journalTrade.tags, 'ctrader, imported');
  assert.equal(journalTrade.notes, 'Imported from cTrader source trade 501.');
  assert.equal(journalTrade.importedAt, '2026-06-12T15:00:00.000Z');
});

test('cTrader sync imports only trades not already in the journal', () => {
  const existingTrades = [
    {
      id: 'ctrader-501',
      provider: 'ctrader',
      sourceTradeId: '501',
      symbol: 'EURUSD',
    },
  ];
  const previewTrades = [
    closedPreviewTrade,
    {
      ...closedPreviewTrade,
      id: 'ctrader-502',
      sourceDealId: 502,
      symbol: 'GBPUSD',
    },
    {
      ...closedPreviewTrade,
      id: 'ctrader-502-duplicate',
      sourceDealId: 502,
      symbol: 'GBPUSD',
    },
  ];

  const syncPlan = buildCTraderSyncPlan(previewTrades, existingTrades, {
    now: () => Date.parse('2026-06-12T15:00:00.000Z'),
  });

  assert.equal(syncPlan.fetchedCount, 3);
  assert.equal(syncPlan.importedCount, 1);
  assert.equal(syncPlan.skippedCount, 2);
  assert.deepEqual(syncPlan.importedTrades.map((trade) => trade.sourceTradeId), ['502']);
  assert.deepEqual(syncPlan.skippedTrades.map(({ reason }) => reason), [
    'already in journal',
    'duplicate in cTrader response',
  ]);
});

test('existing duplicate protection still keys cTrader trades by source trade ID', () => {
  const candidateTrade = {
    provider: 'ctrader',
    sourceTradeId: '777',
  };
  const existingTrades = [
    { provider: 'ctrader', sourceDealId: 777 },
  ];
  const seenSourceKeys = new Set();

  assert.equal(getImportedTradeSourceKey(candidateTrade), 'ctrader:777');
  assert.equal(hasSourceTradeAlreadyBeenImported(candidateTrade, existingTrades), true);
  assert.equal(shouldImportCTraderTrade(candidateTrade, existingTrades, seenSourceKeys), false);
});
