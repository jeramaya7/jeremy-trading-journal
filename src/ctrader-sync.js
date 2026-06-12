export function buildCTraderSyncPlan(previewTrades, existingTrades, options = {}) {
  const seenSourceKeys = new Set();
  const journalTrades = Array.isArray(previewTrades)
    ? previewTrades.map((previewTrade) => convertCTraderPreviewTradeToJournalEntry(previewTrade, options))
    : [];
  const importedTrades = [];
  const skippedTrades = [];

  for (const trade of journalTrades) {
    const skipReason = getCTraderTradeSkipReason(trade, existingTrades, seenSourceKeys);
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

export function convertCTraderPreviewTradeToJournalEntry(previewTrade, options = {}) {
  const sourceTradeId = getCTraderSourceTradeId(previewTrade);
  const sourceLabel = sourceTradeId === null ? 'unknown source trade' : `source trade ${sourceTradeId}`;
  const importedNotes = `Imported from cTrader ${sourceLabel}.`;
  const previewNotes = String(previewTrade.notes || '').trim();
  const notes = previewNotes && !previewNotes.toLowerCase().includes('preview only')
    ? `${importedNotes} ${previewNotes}`
    : importedNotes;

  return {
    ...previewTrade,
    id: sourceTradeId === null ? createFallbackId(options) : `ctrader-${sourceTradeId}`,
    provider: 'ctrader',
    sourceTradeId,
    setup: previewTrade.setup === 'cTrader import preview' ? 'cTrader import' : (previewTrade.setup || 'cTrader import'),
    emotion: previewTrade.emotion || 'Imported',
    tags: normalizeImportedTags(previewTrade.tags),
    notes,
    importedAt: getImportedAt(options),
  };
}

export function normalizeImportedTags(tags) {
  const normalizedTags = String(tags || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag && tag !== 'import-preview');

  if (!normalizedTags.includes('ctrader')) {
    normalizedTags.unshift('ctrader');
  }
  if (!normalizedTags.includes('imported')) {
    normalizedTags.push('imported');
  }

  return normalizedTags.join(', ');
}

export function shouldImportCTraderTrade(candidateTrade, existingTrades, seenSourceKeys) {
  return getCTraderTradeSkipReason(candidateTrade, existingTrades, seenSourceKeys) === null;
}

export function hasSourceTradeAlreadyBeenImported(candidateTrade, existingTrades) {
  const candidateKey = getImportedTradeSourceKey(candidateTrade);
  if (!candidateKey) {
    return false;
  }

  return existingTrades.some((existingTrade) => getImportedTradeSourceKey(existingTrade) === candidateKey);
}

export function getImportedTradeSourceKey(trade) {
  if (trade?.provider !== 'ctrader') {
    return null;
  }

  const sourceTradeId = getCTraderSourceTradeId(trade);
  return sourceTradeId === null ? null : `ctrader:${sourceTradeId}`;
}

export function getCTraderSourceTradeId(trade) {
  const sourceTradeId = trade?.sourceTradeId ?? trade?.sourceDealId;
  if (sourceTradeId === null || sourceTradeId === undefined || sourceTradeId === '') {
    return null;
  }

  return String(sourceTradeId);
}

function getCTraderTradeSkipReason(candidateTrade, existingTrades, seenSourceKeys) {
  const candidateKey = getImportedTradeSourceKey(candidateTrade);
  if (!candidateKey) {
    return null;
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
