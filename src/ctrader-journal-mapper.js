import { randomBytes } from 'node:crypto';

export const CTRADER_JOURNAL_MAPPER_TRACE_VERSION = 'symbol-metadata-by-id-v6-order-sl-tp';

const BROKER_SYMBOL_FALLBACKS_BY_ID = {
  41: 'XAUUSD',
  10026: 'BTCUSD',
};

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
  const positionId = deal.positionId ?? openingDeal?.positionId;
  const stopLoss = getCtraderStopLoss(deal, openingDeal, options, positionId);
  const takeProfit = getCtraderTakeProfit(deal, openingDeal, options, positionId);
  const symbolMetadata = options.symbolMetadata || getCtraderSymbolMetadataForDeal(deal, openingDeal, options);
  const symbol = getCtraderDealSymbol(deal, openingDeal, symbolMetadata);
  const symbolId = getCtraderDealSymbolId(deal, openingDeal);
  const hasNumericSourceSymbol = isNumericIdentifier(deal?.symbol)
    || isNumericIdentifier(deal?.closePositionDetail?.symbol)
    || isNumericIdentifier(openingDeal?.symbol);
  const volume = mapCtraderVolumeToJournalSize(rawVolume, symbolMetadata);
  const contractSize = getCtraderLotSizeInUnits(symbolMetadata);
  const netProfitLoss = getNetProfitLoss(closePositionDetail);
  logCtraderVolumeMapping(options, {
    dealId: deal.dealId ?? null,
    positionId: deal.positionId ?? null,
    symbol,
    symbolId,
    rawVolume,
    stopLoss,
    volumeInUnits: getCtraderVolumeInUnits(rawVolume),
    volumeInUnitsStep: getCtraderVolumeInUnits(symbolMetadata?.stepVolume ?? symbolMetadata?.volumeInUnitsStep),
    minVolume: getCtraderVolumeInUnits(symbolMetadata?.minVolume),
    maxVolume: getCtraderVolumeInUnits(symbolMetadata?.maxVolume),
    lotSize: toFiniteNumber(symbolMetadata?.lotSize),
    convertedLotSize: contractSize,
    finalStoredSize: volume,
    finalStoredStopLoss: stopLoss,
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
    ...(stopLoss !== null ? { stopLoss } : {}),
    ...(takeProfit !== null ? { takeProfit } : {}),
    size: volume,
    volume,
    ...(contractSize !== null && contractSize > 0 ? { contractSize } : {}),
    openTime,
    closeTime,
    date: closeTime ? closeTime.slice(0, 10) : null,
    netProfitLoss,
    fees: Math.abs(commission) + Math.abs(swap) + Math.abs(pnlConversionFee),
    setup: 'cTrader import preview',
    emotion: '',
    tags: '',
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

function getCtraderTakeProfit(deal, openingDeal = null, options = {}, positionId = deal?.positionId ?? openingDeal?.positionId) {
  const sourceTakeProfit = toFiniteNumber(firstDefined(
    ...getCtraderTakeProfitCandidates(deal),
    ...getCtraderTakeProfitCandidates(openingDeal),
  ));
  if (sourceTakeProfit !== null) {
    return sourceTakeProfit;
  }

  const selectedOrder = getCtraderOrdersForPosition(options.ordersByPositionId, positionId)
    .find((order) => getCtraderOrderTakeProfit(order) !== null);
  return selectedOrder ? getCtraderOrderTakeProfit(selectedOrder) : null;
}

function getCtraderStopLoss(deal, openingDeal = null, options = {}, positionId = deal?.positionId ?? openingDeal?.positionId) {
  const sourceStopLoss = toFiniteNumber(firstDefined(
    ...getCtraderStopLossCandidates(deal),
    ...getCtraderStopLossCandidates(openingDeal),
  ));
  if (sourceStopLoss !== null) {
    return sourceStopLoss;
  }

  const selectedOrder = getCtraderOrdersForPosition(options.ordersByPositionId, positionId)
    .find((order) => getCtraderOrderStopLoss(order) !== null);
  return selectedOrder ? getCtraderOrderStopLoss(selectedOrder) : null;
}

function getCtraderStopLossCandidates(source) {
  return [
    source?.stopLoss,
    source?.stopLossPrice,
    source?.slPrice,
    source?.sl,
    source?.order?.stopLoss,
    source?.order?.stopLossPrice,
    source?.position?.stopLoss,
    source?.position?.stopLossPrice,
    source?.closePositionDetail?.stopLoss,
    source?.closePositionDetail?.stopLossPrice,
    source?.closePositionDetail?.slPrice,
    source?.closePositionDetail?.sl,
    source?.closePositionDetail?.order?.stopLoss,
    source?.closePositionDetail?.order?.stopLossPrice,
    source?.closePositionDetail?.position?.stopLoss,
    source?.closePositionDetail?.position?.stopLossPrice,
  ];
}

function getCtraderTakeProfitCandidates(source) {
  return [
    source?.takeProfit,
    source?.takeProfitPrice,
    source?.tpPrice,
    source?.tp,
    source?.order?.takeProfit,
    source?.order?.takeProfitPrice,
    source?.position?.takeProfit,
    source?.position?.takeProfitPrice,
    source?.closePositionDetail?.takeProfit,
    source?.closePositionDetail?.takeProfitPrice,
    source?.closePositionDetail?.tpPrice,
    source?.closePositionDetail?.tp,
    source?.closePositionDetail?.order?.takeProfit,
    source?.closePositionDetail?.order?.takeProfitPrice,
    source?.closePositionDetail?.position?.takeProfit,
    source?.closePositionDetail?.position?.takeProfitPrice,
  ];
}

function getCtraderOrdersForPosition(ordersByPositionId, positionId) {
  if (positionId === undefined || positionId === null || positionId === '' || !ordersByPositionId) {
    return [];
  }

  if (ordersByPositionId instanceof Map) {
    return normalizeCtraderOrdersForPosition(ordersByPositionId.get(String(positionId)) ?? ordersByPositionId.get(positionId));
  }

  if (Array.isArray(ordersByPositionId)) {
    return ordersByPositionId
      .filter((entry) => String(entry?.positionId) === String(positionId))
      .flatMap((entry) => normalizeCtraderOrdersForPosition(entry));
  }

  return normalizeCtraderOrdersForPosition(ordersByPositionId[String(positionId)] ?? ordersByPositionId[positionId]);
}

function normalizeCtraderOrdersForPosition(orders) {
  if (Array.isArray(orders)) {
    return orders;
  }
  if (Array.isArray(orders?.order)) {
    return orders.order;
  }
  return orders ? [orders] : [];
}

function getCtraderOrderStopLoss(order) {
  return toFiniteNumber(firstDefined(
    order?.stopLoss,
    order?.stopLossPrice,
    order?.slPrice,
    order?.sl,
    order?.position?.stopLoss,
    order?.position?.stopLossPrice,
  ));
}

function getCtraderOrderTakeProfit(order) {
  return toFiniteNumber(firstDefined(
    order?.takeProfit,
    order?.takeProfitPrice,
    order?.tpPrice,
    order?.tp,
    order?.position?.takeProfit,
    order?.position?.takeProfitPrice,
  ));
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
    symbolMetadata?.baseAssetName,
    symbolMetadata?.quoteAssetName,
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
  const fallbackSymbol = BROKER_SYMBOL_FALLBACKS_BY_ID[String(symbolId)];
  if (fallbackSymbol) {
    return fallbackSymbol;
  }

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
