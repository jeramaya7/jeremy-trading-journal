import { randomBytes } from 'node:crypto';

export function mapCtraderDealsToJournalTrades(rawDeals, options = {}) {
  const deals = Array.isArray(rawDeals?.deal) ? rawDeals.deal : [];
  const openingDealsByPosition = new Map();

  for (const deal of deals) {
    if (!deal?.positionId || isClosingDeal(deal)) {
      continue;
    }

    const key = String(deal.positionId);
    const existingDeal = openingDealsByPosition.get(key);
    if (!existingDeal || Number(deal.executionTimestamp || 0) < Number(existingDeal.executionTimestamp || 0)) {
      openingDealsByPosition.set(key, deal);
    }
  }

  return deals
    .filter(isClosingDeal)
    .map((deal) => mapCtraderClosingDealToJournalTrade(
      deal,
      openingDealsByPosition.get(String(deal.positionId)),
      {
        ...options,
        symbolMetadata: getCtraderSymbolMetadataForDeal(deal, openingDealsByPosition.get(String(deal.positionId)), options),
      },
    ));
}

export function mapCtraderClosingDealToJournalTrade(deal, openingDeal = null, options = {}) {
  const closePositionDetail = deal.closePositionDetail || {};
  const direction = getJournalDirection(openingDeal?.tradeSide, deal.tradeSide);
  const closeTime = toIsoTimestamp(deal.executionTimestamp);
  const openTime = toIsoTimestamp(
    closePositionDetail.entryTimestamp
      ?? closePositionDetail.openTimestamp
      ?? openingDeal?.executionTimestamp,
  );
  const commission = mapCtraderMoneyToCurrency(closePositionDetail.commission, 0);
  const swap = mapCtraderMoneyToCurrency(closePositionDetail.swap, 0);
  const pnlConversionFee = mapCtraderMoneyToCurrency(closePositionDetail.pnlConversionFee, 0);
  const entry = toFiniteNumber(closePositionDetail.entryPrice ?? openingDeal?.executionPrice);
  const exit = toFiniteNumber(deal.executionPrice ?? closePositionDetail.exitPrice);
  const rawVolume = toFiniteNumber(
    closePositionDetail.closedVolume
      ?? closePositionDetail.volume
      ?? deal.filledVolume
      ?? deal.volume
      ?? openingDeal?.filledVolume
      ?? openingDeal?.volume,
  );
  const symbolMetadata = options.symbolMetadata || getCtraderSymbolMetadataForDeal(deal, openingDeal, options);
  const symbol = getCtraderDealSymbol(deal, openingDeal, symbolMetadata);
  const symbolId = getCtraderDealSymbolId(deal, openingDeal);
  const hasNumericSourceSymbol = isNumericIdentifier(deal?.symbol)
    || isNumericIdentifier(deal?.closePositionDetail?.symbol)
    || isNumericIdentifier(openingDeal?.symbol);
  const volume = mapCtraderVolumeToJournalSize(rawVolume, symbolMetadata);
  const netProfitLoss = getNetProfitLoss(closePositionDetail);
  logCtraderVolumeMapping(options, {
    dealId: deal.dealId ?? null,
    positionId: deal.positionId ?? null,
    symbol,
    symbolId,
    rawVolume,
    volumeInUnits: getCtraderVolumeInUnits(rawVolume),
    volumeInUnitsStep: getCtraderVolumeInUnits(symbolMetadata?.stepVolume ?? symbolMetadata?.volumeInUnitsStep),
    minVolume: getCtraderVolumeInUnits(symbolMetadata?.minVolume),
    maxVolume: getCtraderVolumeInUnits(symbolMetadata?.maxVolume),
    lotSize: toFiniteNumber(symbolMetadata?.lotSize),
    convertedLotSize: getCtraderLotSizeInUnits(symbolMetadata),
    finalStoredSize: volume,
    finalStoredProfitLoss: netProfitLoss,
  });

  return {
    id: `ctrader-${deal.dealId ?? deal.positionId ?? cryptoSafeId(options)}`,
    provider: 'ctrader',
    accountId: options.accountId ?? null,
    sourceDealId: deal.dealId ?? null,
    sourcePositionId: deal.positionId ?? null,
    ...(hasNumericSourceSymbol && symbolId !== null ? { sourceSymbolId: symbolId } : {}),
    ...(hasNumericSourceSymbol && symbol ? { brokerSymbol: symbol } : {}),
    symbol,
    direction,
    entry,
    exit,
    size: volume,
    volume,
    openTime,
    closeTime,
    date: closeTime ? closeTime.slice(0, 10) : null,
    netProfitLoss,
    fees: Math.abs(commission) + Math.abs(swap) + Math.abs(pnlConversionFee),
    setup: 'cTrader import preview',
    emotion: '',
    tags: 'ctrader, import-preview',
    notes: 'Preview only. Not saved to the journal.',
  };
}

export function mapCtraderVolumeToJournalSize(rawVolume, symbolMetadata) {
  const parsedVolume = toFiniteNumber(rawVolume);
  if (parsedVolume === null) {
    return null;
  }

  // cTrader can return XAUUSD volume already as lots (0.01) or as cent-units (100).
  // If it is already below 1, keep it as the lot size shown by cTrader.
  if (parsedVolume > 0 && parsedVolume < 1) {
    return roundJournalSize(parsedVolume);
  }

  const lotSizeInUnits = getCtraderLotSizeInUnits(symbolMetadata);
  if (lotSizeInUnits === null || lotSizeInUnits <= 0) {
    return roundJournalSize(parsedVolume);
  }

  return roundJournalSize(getCtraderVolumeInUnits(parsedVolume) / lotSizeInUnits);
}

export function getCtraderVolumeInUnits(volumeInCents) {
  const parsedVolume = toFiniteNumber(volumeInCents);
  return parsedVolume === null ? null : parsedVolume / 100;
}

export function getCtraderLotSizeInUnits(symbolMetadata) {
  const parsedLotSize = toFiniteNumber(symbolMetadata?.lotSize);
  return parsedLotSize === null ? null : getCtraderVolumeInUnits(parsedLotSize);
}

export function mapCtraderMoneyToCurrency(value, fallback = null) {
  const parsedValue = toFiniteNumber(value);
  if (parsedValue === null) {
    return fallback;
  }

  return roundCurrency(parsedValue / 100);
}

function getCtraderSymbolMetadataForDeal(deal, openingDeal = null, options = {}) {
  const metadataById = options.symbolMetadataById || {};
  const symbolId = getCtraderDealSymbolId(deal, openingDeal);
  return metadataById[String(symbolId)] || options.symbolMetadata || null;
}

function getCtraderDealSymbolId(deal, openingDeal = null) {
  return firstDefined(
    deal?.symbolId,
    deal?.closePositionDetail?.symbolId,
    isNumericIdentifier(deal?.closePositionDetail?.symbol) ? deal.closePositionDetail.symbol : null,
    isNumericIdentifier(deal?.symbol) ? deal.symbol : null,
    openingDeal?.symbolId,
    isNumericIdentifier(openingDeal?.symbol) ? openingDeal.symbol : null,
  );
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '') ?? null;
}

function roundJournalSize(value) {
  return Number(value.toFixed(8));
}

function roundCurrency(value) {
  return Number(value.toFixed(2));
}

function logCtraderVolumeMapping(options, mapping) {
  const logger = options.logger || console;
  if (typeof logger.info !== 'function') {
    return;
  }

  logger.info('[cTrader journal mapper] Volume mapped to journal size', mapping);
}

function isClosingDeal(deal) {
  return Boolean(deal?.closePositionDetail);
}

function getJournalDirection(openingTradeSide, closingTradeSide) {
  const normalizedOpeningSide = normalizeTradeSide(openingTradeSide);
  if (normalizedOpeningSide === 'BUY') {
    return 'Long';
  }
  if (normalizedOpeningSide === 'SELL') {
    return 'Short';
  }

  const normalizedClosingSide = normalizeTradeSide(closingTradeSide);
  if (normalizedClosingSide === 'SELL') {
    return 'Long';
  }
  if (normalizedClosingSide === 'BUY') {
    return 'Short';
  }

  return 'Long';
}

function normalizeTradeSide(tradeSide) {
  if (tradeSide === undefined || tradeSide === null) {
    return null;
  }
  if (typeof tradeSide === 'number') {
    if (tradeSide === 1) {
      return 'BUY';
    }
    if (tradeSide === 2) {
      return 'SELL';
    }
  }

  const normalized = String(tradeSide).toUpperCase();
  if (normalized.includes('BUY')) {
    return 'BUY';
  }
  if (normalized.includes('SELL')) {
    return 'SELL';
  }
  return null;
}

function getCtraderDealSymbol(deal, openingDeal = null, symbolMetadata = null) {
  const readableSymbol = firstReadableSymbol(
    symbolMetadata?.symbolName,
    symbolMetadata?.symbol,
    symbolMetadata?.name,
    symbolMetadata?.displayName,
    deal.symbolName,
    deal.closePositionDetail?.symbolName,
    deal.closePositionDetail?.symbol,
    deal.symbol,
    openingDeal?.symbolName,
    openingDeal?.closePositionDetail?.symbolName,
    openingDeal?.closePositionDetail?.symbol,
    openingDeal?.symbol,
  );
  if (readableSymbol) {
    return readableSymbol;
  }

  const symbolId = getCtraderDealSymbolId(deal, openingDeal);
  return symbolId !== null ? String(symbolId) : 'Unknown';
}

function firstReadableSymbol(...values) {
  return values
    .map((value) => (value === undefined || value === null ? '' : String(value).trim()))
    .find((value) => value && !isNumericIdentifier(value)) || null;
}

function isNumericIdentifier(value) {
  if (value === undefined || value === null || value === '') {
    return false;
  }
  return /^\d+$/.test(String(value).trim());
}

function getNetProfitLoss(closePositionDetail) {
  const explicitNetProfitLoss = mapCtraderMoneyToCurrency(
    closePositionDetail.netProfitLoss
      ?? closePositionDetail.netProfit
      ?? closePositionDetail.realizedNetProfit,
  );
  if (explicitNetProfitLoss !== null) {
    return explicitNetProfitLoss;
  }

  const grossProfit = mapCtraderMoneyToCurrency(closePositionDetail.grossProfit, 0);
  const swap = mapCtraderMoneyToCurrency(closePositionDetail.swap, 0);
  const commission = mapCtraderMoneyToCurrency(closePositionDetail.commission, 0);
  const pnlConversionFee = mapCtraderMoneyToCurrency(closePositionDetail.pnlConversionFee, 0);
  return roundCurrency(grossProfit + swap + commission + pnlConversionFee);
}

function toIsoTimestamp(timestamp) {
  const parsed = toFiniteNumber(timestamp);
  if (parsed === null) {
    return null;
  }

  return new Date(parsed).toISOString();
}

function toFiniteNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cryptoSafeId(options = {}) {
  if (typeof options.idFactory === 'function') {
    return options.idFactory();
  }
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return randomBytes(16).toString('hex');
}
