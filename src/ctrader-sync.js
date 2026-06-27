export function buildCTraderSyncPlan(previewTrades, existingTrades, options = {}) {
  const seenSourceKeys = new Set();
  const journalTrades = Array.isArray(previewTrades)
    ? previewTrades.map((previewTrade) => convertCTraderPreviewTradeToJournalEntry(previewTrade, options))
    : [];
  const deletedSourceKeys = normalizeDeletedCTraderSourceKeys(options.deletedSourceKeys);
  const importedTrades = [];
  const skippedTrades = [];

  for (const trade of journalTrades) {
    const skipReason = getCTraderTradeSkipReason(trade, existingTrades, seenSourceKeys, deletedSourceKeys);
    if (skipReason) {
      skippedTrades.push({ trade, reason: skipReason });
      continue;
    }

    importedTrades.push(trade);
    const sourceKey = getImportedTradeSourceKey(trade);
    if (sourceKey) {
      seenSourceKeys.add(sourceKey);
    }
  }

  return {
    fetchedCount: journalTrades.length,
    importedTrades,
    skippedTrades,
    importedCount: importedTrades.length,
    skippedCount: skippedTrades.length,
  };
}

export function applyCTraderImportedTradeUpdates(existingTrades, skippedTrades) {
  const sourceUpdates = new Map();
  for (const skippedTrade of Array.isArray(skippedTrades) ? skippedTrades : []) {
    if (skippedTrade?.reason !== 'already in journal') {
      continue;
    }

    const sourceKey = getImportedTradeSourceKey(skippedTrade.trade);
    const readableSymbol = getReadableImportedSymbol(
      skippedTrade.trade?.brokerSymbol,
      skippedTrade.trade?.symbolName,
      skippedTrade.trade?.displaySymbol,
      skippedTrade.trade?.symbol,
    );
    if (!sourceKey || !readableSymbol) {
      continue;
    }

    sourceUpdates.set(sourceKey, {
      symbol: readableSymbol,
      brokerSymbol: readableSymbol,
      sourceSymbolId: skippedTrade.trade?.sourceSymbolId,
      openTime: skippedTrade.trade?.openTime,
      closeTime: skippedTrade.trade?.closeTime,
      accountSize: skippedTrade.trade?.accountSize,
      accountBalance: skippedTrade.trade?.accountBalance,
      accountBalanceFetchedAt: skippedTrade.trade?.accountBalanceFetchedAt,
      contractSize: skippedTrade.trade?.contractSize,
      stopLoss: skippedTrade.trade?.stopLoss,
      takeProfit: skippedTrade.trade?.takeProfit,
    });
  }

  let updatedCount = 0;
  let stopLossUpdatedCount = 0;
  const trades = (Array.isArray(existingTrades) ? existingTrades : []).map((trade) => {
    const update = sourceUpdates.get(getImportedTradeSourceKey(trade));
    if (!update) {
      return trade;
    }

    const nextTrade = {
      ...trade,
      symbol: update.symbol,
      brokerSymbol: update.brokerSymbol,
      ...(update.sourceSymbolId !== undefined ? { sourceSymbolId: update.sourceSymbolId } : {}),
      ...(update.openTime ? { openTime: update.openTime } : {}),
      ...(update.closeTime ? { closeTime: update.closeTime } : {}),
      ...(update.accountSize !== undefined ? { accountSize: update.accountSize } : {}),
      ...(update.accountBalance !== undefined ? { accountBalance: update.accountBalance } : {}),
      ...(update.accountBalanceFetchedAt !== undefined ? { accountBalanceFetchedAt: update.accountBalanceFetchedAt } : {}),
      ...(update.contractSize !== undefined ? { contractSize: update.contractSize } : {}),
      ...(update.stopLoss !== undefined && isBlankTradeValue(trade.stopLoss) ? { stopLoss: update.stopLoss } : {}),
      ...(update.takeProfit !== undefined && isBlankTradeValue(trade.takeProfit) ? { takeProfit: update.takeProfit } : {}),
    };
    const didChange = nextTrade.symbol !== trade.symbol
      || nextTrade.brokerSymbol !== trade.brokerSymbol
      || nextTrade.sourceSymbolId !== trade.sourceSymbolId
      || nextTrade.openTime !== trade.openTime
      || nextTrade.closeTime !== trade.closeTime
      || nextTrade.accountSize !== trade.accountSize
      || nextTrade.accountBalance !== trade.accountBalance
      || nextTrade.accountBalanceFetchedAt !== trade.accountBalanceFetchedAt
      || nextTrade.contractSize !== trade.contractSize
      || nextTrade.stopLoss !== trade.stopLoss
      || nextTrade.takeProfit !== trade.takeProfit;
    if (didChange) {
      updatedCount += 1;
      if (nextTrade.stopLoss !== trade.stopLoss) {
        stopLossUpdatedCount += 1;
      }
      return nextTrade;
    }

    return trade;
  });

  return { trades, updatedCount, stopLossUpdatedCount };
}

export function convertCTraderPreviewTradeToJournalEntry(previewTrade, options = {}) {
  const sourceTradeId = getCTraderSourceTradeId(previewTrade);
  const brokerSymbol = getReadableImportedSymbol(
    previewTrade.brokerSymbol,
    previewTrade.symbolName,
    previewTrade.symbol,
  );

  return {
    ...previewTrade,
    id: sourceTradeId === null ? createFallbackId(options) : `ctrader-${sourceTradeId}`,
    provider: 'ctrader',
    sourceTradeId,
    brokerSymbol,
    symbol: brokerSymbol || previewTrade.symbol,
    setup: '',
    emotion: previewTrade.emotion || '',
    tags: '',
    notes: '',
    importedAt: getImportedAt(options),
    ...getImportedAccountBalanceFields(options.accountBalance),
  };
}

function isBlankTradeValue(value) {
  return value === undefined || value === null || value === '' || value === 0;
}

function getImportedAccountBalanceFields(accountBalance) {
  const balance = toFiniteNumber(accountBalance?.balance ?? accountBalance);
  if (balance === null || balance <= 0) {
    return {};
  }

  return {
    accountSize: balance,
    accountBalance: balance,
    accountBalanceFetchedAt: accountBalance?.fetchedAt || getImportedAt(),
  };
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getReadableImportedSymbol(...values) {
  return values
    .map((value) => (value === undefined || value === null ? '' : String(value).trim()))
    .find((value) => value && !/^\d+$/.test(value)) || null;
}


export function shouldImportCTraderTrade(candidateTrade, existingTrades, seenSourceKeys, deletedSourceKeys) {
  return getCTraderTradeSkipReason(candidateTrade, existingTrades, seenSourceKeys, normalizeDeletedCTraderSourceKeys(deletedSourceKeys)) === null;
}

export function hasSourceTradeAlreadyBeenImported(candidateTrade, existingTrades) {
  const candidateKey = getImportedTradeSourceKey(candidateTrade);
  if (!candidateKey) {
    return false;
  }

  return existingTrades.some((existingTrade) => getImportedTradeSourceKey(existingTrade) === candidateKey);
}

export function getImportedTradeSourceKey(trade) {
  const sourceTradeId = getCTraderSourceTradeId(trade);
  if (sourceTradeId === null) {
    return null;
  }

  return trade?.provider === 'ctrader' || isLegacyCTraderImportedTrade(trade)
    ? `ctrader:${sourceTradeId}`
    : null;
}

function isLegacyCTraderImportedTrade(trade) {
  return String(trade?.id || '').startsWith('ctrader-')
    || String(trade?.tags || '').toLowerCase().includes('ctrader');
}

export function normalizeDeletedCTraderSourceKeys(deletedSourceKeys) {
  if (!deletedSourceKeys) {
    return new Set();
  }

  const sourceKeys = deletedSourceKeys instanceof Set ? deletedSourceKeys : new Set(deletedSourceKeys);
  return new Set(
    [...sourceKeys]
      .map((sourceKey) => normalizeCTraderDeletedSourceKey(sourceKey))
      .filter(Boolean),
  );
}

export function normalizeCTraderDeletedSourceKey(sourceKey) {
  if (sourceKey === null || sourceKey === undefined || sourceKey === '') {
    return null;
  }

  const stringSourceKey = String(sourceKey);
  return stringSourceKey.startsWith('ctrader:') ? stringSourceKey : `ctrader:${stringSourceKey}`;
}

export function getCTraderSourceTradeId(trade) {
  const sourceTradeId = trade?.sourceTradeId ?? trade?.sourceDealId;
  if (sourceTradeId === null || sourceTradeId === undefined || sourceTradeId === '') {
    return null;
  }

  return String(sourceTradeId);
}

function getCTraderTradeSkipReason(candidateTrade, existingTrades, seenSourceKeys = new Set(), deletedSourceKeys = new Set()) {
  const candidateKey = getImportedTradeSourceKey(candidateTrade);
  if (!candidateKey) {
    return null;
  }
  if (deletedSourceKeys.has(candidateKey)) {
    return 'deleted from journal';
  }
  if (seenSourceKeys.has(candidateKey)) {
    return 'duplicate in cTrader response';
  }
  if (hasSourceTradeAlreadyBeenImported(candidateTrade, existingTrades)) {
    return 'already in journal';
  }

  return null;
}

function getImportedAt(options = {}) {
  if (typeof options.now === 'function') {
    return new Date(options.now()).toISOString();
  }

  return new Date().toISOString();
}

function createFallbackId(options = {}) {
  if (typeof options.idFactory === 'function') {
    return options.idFactory();
  }
  return crypto.randomUUID();
}
