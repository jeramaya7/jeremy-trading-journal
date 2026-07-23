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
  assert.equal(journalTrade.setup, '');
  assert.equal(journalTrade.emotion, 'Imported');
  assert.equal(journalTrade.tags, '');
  assert.equal(journalTrade.notes, '');
  assert.equal(journalTrade.importedAt, '2026-06-12T15:00:00.000Z');
});


test('cTrader imports leave cTrader-provided setup, notes, and tags blank by default', () => {
  const journalTrade = convertCTraderPreviewTradeToJournalEntry({
    ...closedPreviewTrade,
    setup: 'Broker setup',
    tags: 'ctrader, imported, import-preview, broker-tag, momentum',
    notes: 'Broker-provided import note',
  }, {
    now: () => Date.parse('2026-06-12T15:00:00.000Z'),
  });

  assert.equal(journalTrade.sourceTradeId, '501');
  assert.equal(journalTrade.setup, '');
  assert.equal(journalTrade.tags, '');
  assert.equal(journalTrade.notes, '');
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
  assert.equal(journalTrade.stopLoss, 1.095);
  // Final Stop Loss defaults to the initial Stop Loss on import (still
  // manually editable afterward) so the journal never shows a blank
  // "Final" value for a trade that hasn't actually been adjusted yet.
  assert.equal(journalTrade.adjustedStopLoss, 1.095);
});

test('cTrader sync leaves Final SL/TP blank on import when no initial SL/TP is known', () => {
  const journalTrade = convertCTraderPreviewTradeToJournalEntry(closedPreviewTrade, {
    now: () => Date.parse('2026-06-12T15:00:00.000Z'),
  });

  assert.equal(journalTrade.stopLoss, undefined);
  assert.equal(journalTrade.adjustedStopLoss, undefined);
  assert.equal(journalTrade.takeProfit, undefined);
  assert.equal(journalTrade.adjustedTakeProfit, undefined);
});

test('cTrader sync does not override a Final SL/TP that was already set', () => {
  const journalTrade = convertCTraderPreviewTradeToJournalEntry({
    ...closedPreviewTrade,
    stopLoss: 1.095,
    adjustedStopLoss: 1.09,
    takeProfit: 1.15,
    adjustedTakeProfit: 1.16,
  }, {
    now: () => Date.parse('2026-06-12T15:00:00.000Z'),
  });

  assert.equal(journalTrade.stopLoss, 1.095);
  assert.equal(journalTrade.adjustedStopLoss, 1.09);
  assert.equal(journalTrade.takeProfit, 1.15);
  assert.equal(journalTrade.adjustedTakeProfit, 1.16);
});

test('cTrader sync defaults a newly-imported trade\'s Timeframe to 1m when the preview has none', () => {
  // cTrader never reports a chart timeframe, so a fresh preview trade always
  // has no `timeframe` field at all — this is the normal case for every
  // real import.
  const journalTrade = convertCTraderPreviewTradeToJournalEntry(closedPreviewTrade, {
    now: () => Date.parse('2026-06-12T15:00:00.000Z'),
  });

  assert.equal(journalTrade.timeframe, '1m', 'A newly imported trade with no Timeframe should default to 1m, so it doesn\'t have to be picked manually in Edit Mode.');
});

test('cTrader sync does not override a Timeframe that already exists on the preview trade', () => {
  const journalTrade = convertCTraderPreviewTradeToJournalEntry({
    ...closedPreviewTrade,
    timeframe: '15m',
  }, {
    now: () => Date.parse('2026-06-12T15:00:00.000Z'),
  });

  assert.equal(journalTrade.timeframe, '15m', 'An existing Timeframe value must never be overwritten by the 1m default.');
});

test('re-syncing an already-imported trade never touches its saved Timeframe, blank or set', () => {
  // The 1m default only applies inside convertCTraderPreviewTradeToJournalEntry
  // (brand-new imports). applyCTraderImportedTradeUpdates is the function
  // that touches already-saved trades on every subsequent sync, and it must
  // never write a timeframe field at all — matching the same "never
  // touches Protected/Grade/Notes/Tags" guarantee already relied on for
  // manual journal fields.
  const existingTrades = [
    { id: 'ctrader-501', provider: 'ctrader', sourceTradeId: '501', symbol: 'EURUSD', brokerSymbol: 'EURUSD', timeframe: '' },
    { id: 'ctrader-906', provider: 'ctrader', sourceTradeId: '906', symbol: 'XAUUSD', brokerSymbol: 'XAUUSD', timeframe: '4H' },
  ];
  const previewTrades = [
    { ...closedPreviewTrade, id: 'ctrader-501', sourceDealId: 501, symbol: 'EURUSD', brokerSymbol: 'EURUSD', openTime: '2026-06-12T13:15:00.000Z' },
    { ...closedPreviewTrade, id: 'ctrader-906', sourceDealId: 906, symbol: 'XAUUSD', brokerSymbol: 'XAUUSD', openTime: '2026-06-12T13:15:00.000Z' },
  ];

  const syncPlan = buildCTraderSyncPlan(previewTrades, existingTrades, {
    now: () => Date.parse('2026-06-12T15:00:00.000Z'),
  });
  const updatedExistingTrades = applyCTraderImportedTradeUpdates(existingTrades, syncPlan.skippedTrades);

  assert.equal(syncPlan.importedCount, 0, 'Both trades are already in the journal, so nothing new should be imported.');
  assert.equal(updatedExistingTrades.trades[0].timeframe, '', 'A blank Timeframe on an existing trade must stay blank — re-sync must never apply the 1m default retroactively.');
  assert.equal(updatedExistingTrades.trades[1].timeframe, '4H', 'A Timeframe already set by the user on an existing trade must be completely unaffected by re-sync.');
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
      tags: 'ctrader, imported, import-preview',
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
  assert.equal(syncPlan.importedTrades[0].tags, '');
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
      contractSize: 100,
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
  assert.equal(updatedExistingTrades.trades[0].contractSize, 100);
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

test('cTrader sync fills original stop loss on matching imported trades only when blank', () => {
  const existingTrades = [
    {
      id: 'ctrader-501',
      provider: 'ctrader',
      sourceTradeId: '501',
      symbol: 'EURUSD',
      brokerSymbol: 'EURUSD',
      stopLoss: '',
      adjustedStopLoss: 1.095,
      notes: 'User journal notes',
      setup: 'Breakout',
      closeReason: 'Target hit',
      lossReason: 'Chased entry',
      screenshots: ['chart.png'],
      tags: 'ctrader, reviewed',
    },
  ];

  const syncPlan = buildCTraderSyncPlan([{ ...closedPreviewTrade, stopLoss: 1.0975 }], existingTrades, {
    now: () => Date.parse('2026-06-12T15:00:00.000Z'),
  });
  const updatedExistingTrades = applyCTraderImportedTradeUpdates(existingTrades, syncPlan.skippedTrades);

  assert.equal(syncPlan.importedCount, 0);
  assert.equal(syncPlan.skippedCount, 1);
  assert.equal(updatedExistingTrades.updatedCount, 1);
  assert.equal(updatedExistingTrades.stopLossUpdatedCount, 1);
  assert.equal(updatedExistingTrades.trades.length, 1);
  assert.equal(updatedExistingTrades.trades[0].stopLoss, 1.0975);
  assert.equal(updatedExistingTrades.trades[0].adjustedStopLoss, 1.095);
  assert.equal(updatedExistingTrades.trades[0].notes, 'User journal notes');
  assert.equal(updatedExistingTrades.trades[0].setup, 'Breakout');
  assert.equal(updatedExistingTrades.trades[0].closeReason, 'Target hit');
  assert.equal(updatedExistingTrades.trades[0].lossReason, 'Chased entry');
  assert.deepEqual(updatedExistingTrades.trades[0].screenshots, ['chart.png']);
  assert.equal(updatedExistingTrades.trades[0].tags, 'ctrader, reviewed');
});



test('cTrader sync fills original take profit on existing imported trades only when blank', () => {
  const existingTrades = [
    {
      id: 'ctrader-501',
      provider: 'ctrader',
      sourceTradeId: '501',
      symbol: 'EURUSD',
      brokerSymbol: 'EURUSD',
      takeProfit: '',
    },
    {
      id: 'ctrader-502',
      provider: 'ctrader',
      sourceTradeId: '502',
      symbol: 'GBPUSD',
      brokerSymbol: 'GBPUSD',
      takeProfit: 1.25,
    },
  ];

  const syncPlan = buildCTraderSyncPlan([
    { ...closedPreviewTrade, takeProfit: 1.11 },
    { ...closedPreviewTrade, id: 'ctrader-502', sourceDealId: 502, symbol: 'GBPUSD', takeProfit: 1.26 },
  ], existingTrades, {
    now: () => Date.parse('2026-06-12T15:00:00.000Z'),
  });
  const updatedExistingTrades = applyCTraderImportedTradeUpdates(existingTrades, syncPlan.skippedTrades);

  assert.equal(syncPlan.importedCount, 0);
  assert.equal(syncPlan.skippedCount, 2);
  assert.equal(updatedExistingTrades.trades[0].takeProfit, 1.11);
  // Final Take Profit defaults to the newly-backfilled initial Take Profit,
  // same as on first import, since it wasn't set yet.
  assert.equal(updatedExistingTrades.trades[0].adjustedTakeProfit, 1.11);
  assert.equal(updatedExistingTrades.trades[1].takeProfit, 1.25);
});

test('cTrader sync backfill does not override a Final SL/TP that was already set manually', () => {
  const existingTrades = [
    {
      id: 'ctrader-501',
      provider: 'ctrader',
      sourceTradeId: '501',
      symbol: 'EURUSD',
      brokerSymbol: 'EURUSD',
      takeProfit: '',
      adjustedTakeProfit: 1.2,
    },
  ];

  const syncPlan = buildCTraderSyncPlan([{ ...closedPreviewTrade, takeProfit: 1.11 }], existingTrades, {
    now: () => Date.parse('2026-06-12T15:00:00.000Z'),
  });
  const updatedExistingTrades = applyCTraderImportedTradeUpdates(existingTrades, syncPlan.skippedTrades);

  assert.equal(updatedExistingTrades.trades[0].takeProfit, 1.11);
  assert.equal(updatedExistingTrades.trades[0].adjustedTakeProfit, 1.2);
});

test('cTrader sync recognizes legacy imported trades without provider before importing duplicates', () => {
  const existingTrades = [
    {
      id: 'ctrader-501',
      sourceTradeId: '501',
      symbol: 'EURUSD',
      setup: 'Breakout Review',
      notes: 'Saved journal notes',
      tags: 'reviewed',
      closeReason: 'Take Profit',
      lossReason: 'Good Trade, Normal Loss',
      screenshot: { dataUrl: 'data:image/png;base64,abc123', name: 'chart.png' },
    },
  ];

  const syncPlan = buildCTraderSyncPlan([closedPreviewTrade], existingTrades, {
    now: () => Date.parse('2026-06-12T15:00:00.000Z'),
  });

  assert.equal(syncPlan.importedCount, 0);
  assert.equal(syncPlan.skippedCount, 1);
  assert.equal(syncPlan.skippedTrades[0].reason, 'already in journal');
  assert.equal(existingTrades[0].setup, 'Breakout Review');
  assert.equal(existingTrades[0].notes, 'Saved journal notes');
  assert.equal(existingTrades[0].tags, 'reviewed');
  assert.equal(existingTrades[0].closeReason, 'Take Profit');
  assert.equal(existingTrades[0].lossReason, 'Good Trade, Normal Loss');
  assert.deepEqual(existingTrades[0].screenshot, { dataUrl: 'data:image/png;base64,abc123', name: 'chart.png' });
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
