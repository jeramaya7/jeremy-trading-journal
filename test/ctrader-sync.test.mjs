import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCTraderImportedTradeUpdates,
  buildCTraderSyncPlan,
  convertCTraderPreviewTradeToJournalEntry,
  getImportedTradeSourceKey,
  normalizeCTraderDeletedSourceKey,
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

test('cTrader sync stores selected account balance on imported trades for Risk % calculations', () => {
  const journalTrade = convertCTraderPreviewTradeToJournalEntry({
    ...closedPreviewTrade,
    stopLoss: 1.095,
    entry: 1.1,
    size: 10000,
  }, {
    now: () => Date.parse('2026-06-12T15:00:00.000Z'),
    accountBalance: { balance: 25000, fetchedAt: '2026-06-12T14:59:00.000Z' },
  });

  assert.equal(journalTrade.accountSize, 25000);
  assert.equal(journalTrade.accountBalance, 25000);
  assert.equal(journalTrade.accountBalanceFetchedAt, '2026-06-12T14:59:00.000Z');
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

test('cTrader sync updates stale local cTrader symbols from skipped preview trades', () => {
  const existingTrades = [
    {
      id: 'ctrader-906',
      provider: 'ctrader',
      sourceTradeId: '906',
      sourceSymbolId: 41,
      symbol: '41',
      openTime: null,
      closeTime: null,
    },
  ];
  const previewTrades = [
    {
      ...closedPreviewTrade,
      id: 'ctrader-906',
      sourceDealId: 906,
      sourceSymbolId: 41,
      symbol: 'XAUUSD',
      brokerSymbol: 'XAUUSD',
      openTime: '2026-06-12T13:15:00.000Z',
      closeTime: '2026-06-12T14:30:00.000Z',
    },
  ];

  const syncPlan = buildCTraderSyncPlan(previewTrades, existingTrades, {
    now: () => Date.parse('2026-06-12T15:00:00.000Z'),
  });
  const updatedExistingTrades = applyCTraderImportedTradeUpdates(existingTrades, syncPlan.skippedTrades);

  assert.equal(syncPlan.importedCount, 0);
  assert.equal(syncPlan.skippedCount, 1);
  assert.equal(updatedExistingTrades.updatedCount, 1);
  assert.equal(updatedExistingTrades.trades[0].symbol, 'XAUUSD');
  assert.equal(updatedExistingTrades.trades[0].brokerSymbol, 'XAUUSD');
  assert.equal(updatedExistingTrades.trades[0].sourceSymbolId, 41);
  assert.equal(updatedExistingTrades.trades[0].openTime, '2026-06-12T13:15:00.000Z');
  assert.equal(updatedExistingTrades.trades[0].closeTime, '2026-06-12T14:30:00.000Z');
});


test('cTrader sync refreshes account balance fields on existing imported trades', () => {
  const existingTrades = [
    {
      id: 'ctrader-501',
      provider: 'ctrader',
      sourceTradeId: '501',
      symbol: 'EURUSD',
      brokerSymbol: 'EURUSD',
    },
  ];

  const syncPlan = buildCTraderSyncPlan([{ ...closedPreviewTrade, stopLoss: 1.095 }], existingTrades, {
    now: () => Date.parse('2026-06-12T15:00:00.000Z'),
    accountBalance: { balance: 25000, fetchedAt: '2026-06-12T14:59:00.000Z' },
  });
  const updatedExistingTrades = applyCTraderImportedTradeUpdates(existingTrades, syncPlan.skippedTrades);

  assert.equal(syncPlan.importedCount, 0);
  assert.equal(syncPlan.skippedCount, 1);
  assert.equal(updatedExistingTrades.updatedCount, 1);
  assert.equal(updatedExistingTrades.trades[0].accountSize, 25000);
  assert.equal(updatedExistingTrades.trades[0].accountBalance, 25000);
  assert.equal(updatedExistingTrades.trades[0].accountBalanceFetchedAt, '2026-06-12T14:59:00.000Z');
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


test('cTrader sync does not re-import trades deleted from the journal', () => {
  const firstSyncPlan = buildCTraderSyncPlan([closedPreviewTrade], [], {
    now: () => Date.parse('2026-06-12T15:00:00.000Z'),
  });
  assert.equal(firstSyncPlan.importedCount, 1);

  const importedTrade = firstSyncPlan.importedTrades[0];
  const deletedSourceKeys = new Set([getImportedTradeSourceKey(importedTrade)]);
  const journalAfterDelete = [];

  const secondSyncPlan = buildCTraderSyncPlan([closedPreviewTrade], journalAfterDelete, {
    deletedSourceKeys,
    now: () => Date.parse('2026-06-12T15:05:00.000Z'),
  });

  assert.equal(secondSyncPlan.importedCount, 0);
  assert.equal(secondSyncPlan.skippedCount, 1);
  assert.deepEqual(secondSyncPlan.skippedTrades.map(({ reason }) => reason), ['deleted from journal']);
});

test('deleted cTrader source keys are normalized for legacy source trade IDs', () => {
  assert.equal(normalizeCTraderDeletedSourceKey('501'), 'ctrader:501');
  assert.equal(normalizeCTraderDeletedSourceKey('ctrader:501'), 'ctrader:501');
});
