import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// This file actually executes the trade math from src/main.js (rather than
// just grepping the source, as most other tests here do) because the bug
// this guards against is purely numeric: a real trade's R multiple silently
// came back `null`, which skipped the ±0.1R Breakeven Buffer band entirely.
// A string-match test can't catch that; only running the real functions
// with the real numbers can.
//
// The functions under test are pure (no window/document/localStorage), so
// they're extracted from the live source file and evaluated in isolation.
// This exercises the actual shipped code, not a reimplementation of it.

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

function extractFunction(name) {
  const marker = `\nfunction ${name}(`;
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Expected to find function ${name} in src/main.js`);
  const start = markerIndex + 1;
  const braceStart = source.indexOf('{', markerIndex);
  let depth = 0;
  let cursor = braceStart;
  while (true) {
    if (source[cursor] === '{') depth += 1;
    else if (source[cursor] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
    cursor += 1;
  }
  return source.slice(start, cursor + 1);
}

const PURE_TRADE_MATH_FUNCTIONS = [
  'toOptionalNumber',
  'isCTraderImportedTrade',
  'getTradeDisplaySymbol',
  'firstReadableTradeSymbol',
  'getTradeContractSize',
  'isStopLossCloseReason',
  'getStopLossHitPrice',
  'getActiveStopLoss',
  'calculateOriginalRiskDollars',
  'calculateRiskDollars',
  'calculatePnl',
  'calculateProtectedProfitRMultiple',
  'calculateRMultiple',
  'classifyTradeOutcome',
];

function loadTradeMathModule() {
  const code = [
    // classifyTradeOutcome references this module-level constant.
    "const BREAKEVEN_R_THRESHOLD = 0.1;",
    ...PURE_TRADE_MATH_FUNCTIONS.map(extractFunction),
    'module.exports = { ' + PURE_TRADE_MATH_FUNCTIONS.join(', ') + ' };',
  ].join('\n\n');

  const context = { module: { exports: {} } };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'main.js (extracted trade math)' });
  return context.module.exports;
}

test('regression: a trade stopped out at a trailed (breakeven+) stop classifies as Breakeven, not Win', () => {
  // Real-world case: Long XAUUSD, entered 4066.39, stop trailed up to
  // 4066.67 (above entry, locking in a sliver of profit), then price
  // reversed and hit that trailed stop. Net P/L: +$0.42.
  //
  // Root cause: calculateOriginalRiskDollars/calculateRiskDollars computed
  // entry-to-stop distance as a *signed* value and returned null whenever
  // it wasn't positive. A stop trailed above entry on a Long makes that
  // distance negative, so both functions returned null, calculateRMultiple
  // fell through to null, and classifyTradeOutcome's fallback (raw P/L
  // sign, with no breakeven band) called this a Win.
  const { calculateRMultiple, calculatePnl, classifyTradeOutcome, calculateRiskDollars, calculateOriginalRiskDollars } = loadTradeMathModule();

  const trade = {
    provider: 'ctrader',
    direction: 'Long',
    symbol: 'XAUUSD',
    entry: 4066.39,
    exit: 4066.67,
    stopLoss: 4066.67,
    size: 1,
    netProfitLoss: 0.42,
  };

  assert.equal(calculatePnl(trade), 0.42);
  assert.notEqual(calculateOriginalRiskDollars(trade), null, 'Original risk $ should be computable from the entry-to-stop distance, even when the stop sits above entry.');
  assert.notEqual(calculateRiskDollars(trade), null, 'Risk $ should be computable from the entry-to-stop distance, even when the stop sits above entry.');

  const rMultiple = calculateRMultiple(trade);
  assert.notEqual(rMultiple, null, 'R multiple should be computable for this trade.');
  assert.ok(Math.abs(rMultiple) <= 0.1, `Expected R multiple within the ±0.1R breakeven band, got ${rMultiple}.`);

  assert.equal(classifyTradeOutcome(calculatePnl(trade), rMultiple), 'breakeven');
});

test('sanity: well-formed trades with a normal stop still classify as Win/Loss/Breakeven correctly', () => {
  const { calculateRMultiple, calculatePnl, classifyTradeOutcome } = loadTradeMathModule();

  const bigWinner = {
    direction: 'Long', entry: 100, exit: 110, stopLoss: 95, size: 1, contractSize: 1,
  };
  const bigLoser = {
    direction: 'Long', entry: 100, exit: 90, stopLoss: 95, size: 1, contractSize: 1,
  };
  const nearFlatWinner = {
    direction: 'Long', entry: 100, exit: 100.2, stopLoss: 95, size: 1, contractSize: 1,
  };
  const shortBigWinner = {
    direction: 'Short', entry: 100, exit: 90, stopLoss: 105, size: 1, contractSize: 1,
  };

  for (const trade of [bigWinner, bigLoser, nearFlatWinner, shortBigWinner]) {
    const rMultiple = calculateRMultiple(trade);
    assert.notEqual(rMultiple, null, `R multiple should still be computable for ${JSON.stringify(trade)}`);
  }

  assert.equal(classifyTradeOutcome(calculatePnl(bigWinner), calculateRMultiple(bigWinner)), 'win');
  assert.equal(classifyTradeOutcome(calculatePnl(bigLoser), calculateRMultiple(bigLoser)), 'loss');
  assert.equal(classifyTradeOutcome(calculatePnl(nearFlatWinner), calculateRMultiple(nearFlatWinner)), 'breakeven');
  assert.equal(classifyTradeOutcome(calculatePnl(shortBigWinner), calculateRMultiple(shortBigWinner)), 'win');
});

test('every breakeven-count call site shares the same classifyTradeOutcome + calculateRMultiple pipeline', () => {
  // The dashboard stats, setup analytics, asset analytics, session stats,
  // and calendar day review summary must all route through the same
  // classifier so this fix (and any future one) applies everywhere at
  // once, instead of needing five separate patches.
  const sharedCallSites = source.match(/classifyTradeOutcome\((?:pnl(?:Values\[index\])?|tradePnls\[index\]), (?:rMultiple|calculateRMultiple\(trade\))\)/g) ?? [];
  assert.ok(sharedCallSites.length >= 5, `Expected at least 5 shared classifyTradeOutcome call sites, found ${sharedCallSites.length}.`);
});
