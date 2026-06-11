export function optionalNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function calculatePnl(trade) {
  const entry = Number(trade.entry) || 0;
  const exit = Number(trade.exit) || 0;
  const size = Number(trade.size) || 0;
  const fees = Number(trade.fees) || 0;
  const gross = trade.direction === 'Short' ? (entry - exit) * size : (exit - entry) * size;
  return gross - fees;
}

export function calculateRiskDollars(trade) {
  const entry = optionalNumber(trade.entry);
  const stopLoss = optionalNumber(trade.stopLoss);
  const size = optionalNumber(trade.size);

  if (entry === null || stopLoss === null || size === null) {
    return null;
  }

  return Math.abs(entry - stopLoss) * size;
}

export function calculateRiskPercent(trade) {
  const riskDollars = calculateRiskDollars(trade);
  const accountSize = optionalNumber(trade.accountSize);

  if (riskDollars === null || accountSize === null || accountSize <= 0) {
    return null;
  }

  return (riskDollars / accountSize) * 100;
}

export function calculateRMultiple(trade) {
  const riskDollars = calculateRiskDollars(trade);

  if (riskDollars === null || riskDollars <= 0) {
    return null;
  }

  return calculatePnl(trade) / riskDollars;
}
