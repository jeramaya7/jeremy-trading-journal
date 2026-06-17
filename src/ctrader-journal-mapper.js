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
  const commission = toFiniteNumber(closePositionDetail.commission, 0);
  const swap = toFiniteNumber(closePositionDetail.swap, 0);
  const pnlConversionFee = toFiniteNumber(closePositionDetail.pnlConversionFee, 0);
  const entry = toFiniteNumber(closePositionDetail.entryPrice ?? openingDeal?.executionPrice);
  const exit = toFiniteNumber(deal.executionPrice ?? closePositionDetail.exitPrice);
  const volumeSource = getCtraderVolumeSource(deal, openingDeal, closePositionDetail);
  const rawVolume = toFiniteNumber(volumeSource?.value);
  const symbolMetadata = options.symbolMetadata || getCtraderSymbolMetadataForDeal(deal, openingDeal, options);
  const symbol = getCtraderDealSymbol(deal, openingDeal, symbolMetadata);
  const volume = mapCtraderVolumeToJournalSize(rawVolume, symbolMetadata, volumeSource?.unit);
  const netProfitLoss = getNetProfitLoss(closePositionDetail);
  logCtraderVolumeMapping(options, {
    dealId: deal.dealId ?? null,
    positionId: deal.positionId ?? null,
    symbol,
    symbolId: deal.symbolId ?? openingDeal?.symbolId ?? null,
    rawSide: deal.tradeSide ?? null,
    rawProfit: getRawProfitLoss(closePositionDetail),
    rawVolume,
    rawVolumeSource: volumeSource?.field ?? null,
    rawVolumeUnit: volumeSource?.unit ?? null,
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

export function mapCtraderVolumeToJournalSize(rawVolume, symbolMetadata, volumeUnit = 'cent-units') {
  const parsedVolume = toFiniteNumber(rawVolume);
  if (parsedVolume === null) {
    return null;
  }

  if (volumeUnit === 'lots') {
    return roundJournalSize(parsedVolume);
  }

  const lotSizeInUnits = getCtraderLotSizeInUnits(symbolMetadata);
  if (lotSizeInUnits === null || lotSizeInUnits <= 0) {
    return null;
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

function getCtraderSymbolMetadataForDeal(deal, openingDeal = null, options = {}) {
  const symbolId = deal?.symbolId ?? openingDeal?.symbolId;
  const metadataById = options.symbolMetadataById || {};
  return metadataById[String(symbolId)] || options.symbolMetadata || null;
}

function getCtraderVolumeSource(deal, openingDeal, closePositionDetail) {
  if (closePositionDetail.closedVolume !== undefined && closePositionDetail.closedVolume !== null && closePositionDetail.closedVolume !== '') {
    return { field: 'closePositionDetail.closedVolume', value: closePositionDetail.closedVolume, unit: 'lots' };
  }
  if (closePositionDetail.volume !== undefined && closePositionDetail.volume !== null && closePositionDetail.volume !== '') {
    return { field: 'closePositionDetail.volume', value: closePositionDetail.volume, unit: 'lots' };
  }
  if (deal.filledVolume !== undefined && deal.filledVolume !== null && deal.filledVolume !== '') {
    return { field: 'deal.filledVolume', value: deal.filledVolume, unit: 'cent-units' };
  }
  if (deal.volume !== undefined && deal.volume !== null && deal.volume !== '') {
    return { field: 'deal.volume', value: deal.volume, unit: 'cent-units' };
  }
  if (openingDeal?.filledVolume !== undefined && openingDeal.filledVolume !== null && openingDeal.filledVolume !== '') {
    return { field: 'openingDeal.filledVolume', value: openingDeal.filledVolume, unit: 'cent-units' };
  }
  if (openingDeal?.volume !== undefined && openingDeal.volume !== null && openingDeal.volume !== '') {
    return { field: 'openingDeal.volume', value: openingDeal.volume, unit: 'cent-units' };
  }
  return null;
}

function roundJournalSize(value) {
  return Number(value.toFixed(8));
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
  return deal.symbolName
    || deal.symbol
    || openingDeal?.symbolName
    || openingDeal?.symbol
    || symbolMetadata?.symbolName
    || symbolMetadata?.symbol
    || (deal.symbolId !== undefined ? String(deal.symbolId) : null)
    || (openingDeal?.symbolId !== undefined ? String(openingDeal.symbolId) : null)
    || 'Unknown';
}

function getNetProfitLoss(closePositionDetail) {
  const explicitNetProfitLoss = toFiniteNumber(
    closePositionDetail.netProfitLoss
      ?? closePositionDetail.netProfit
      ?? closePositionDetail.realizedNetProfit,
  );
  if (explicitNetProfitLoss !== null) {
    return mapCtraderMoneyToCurrency(explicitNetProfitLoss);
  }

  const grossProfit = toFiniteNumber(closePositionDetail.grossProfit, 0);
  const swap = toFiniteNumber(closePositionDetail.swap, 0);
  const commission = toFiniteNumber(closePositionDetail.commission, 0);
  const pnlConversionFee = toFiniteNumber(closePositionDetail.pnlConversionFee, 0);
  return mapCtraderMoneyToCurrency(grossProfit + swap + commission + pnlConversionFee);
}

function getRawProfitLoss(closePositionDetail) {
  return toFiniteNumber(
    closePositionDetail.netProfitLoss
      ?? closePositionDetail.netProfit
      ?? closePositionDetail.realizedNetProfit
      ?? closePositionDetail.grossProfit,
  );
}

function mapCtraderMoneyToCurrency(valueInCents) {
  const parsedValue = toFiniteNumber(valueInCents);
  return parsedValue === null ? null : roundCurrency(parsedValue / 100);
}

function roundCurrency(value) {
  return Number(value.toFixed(2));
}

function toIsoTimestamp(timestamp) {
  const parsed = toFiniteNumber(timestamp);
  if (parsed === null) {
    return null;
  }
  return new Date(parsed).toISOString();
}

function toFiniteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cryptoSafeId(options = {}) {
  if (typeof options.idFactory === 'function') {
    return options.idFactory();
  }
  return base64Url(randomBytes(9));
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}
