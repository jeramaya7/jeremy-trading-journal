import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// This file actually executes the trade math from src/main.js (rather than
// just grepping the source, as most other tests here do) because Outcome
// classification is purely numeric. A string-match test can't catch a wrong
// boundary comparison; only running the real function with real numbers can.
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

function extractConst(name) {
  const marker = `const ${name} = `;
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Expected to find const ${name} in src/main.js`);
  const semicolonIndex = source.indexOf(';', markerIndex);
  return source.slice(markerIndex, semicolonIndex + 1);
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
  'calculateWinRate',
];

function loadTradeMathModule() {
  const code = [
    // classifyTradeOutcome references this module-level constant; extracted
    // from the real source rather than hardcoded so the test can't drift
    // out of sync with the shipped threshold.
    extractConst('OUTCOME_DOLLAR_THRESHOLD'),
    ...PURE_TRADE_MATH_FUNCTIONS.map(extractFunction),
    'module.exports = { ' + PURE_TRADE_MATH_FUNCTIONS.join(', ') + ' };',
  ].join('\n\n');

  const context = { module: { exports: {} } };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'main.js (extracted trade math)' });
  return context.module.exports;
}

test('the old ±0.1R breakeven rule is fully removed, not just unused', () => {
  assert.equal(source.includes('BREAKEVEN_R_THRESHOLD'), false, 'BREAKEVEN_R_THRESHOLD should no longer exist anywhere in main.js.');
  assert.equal(/function classifyTradeOutcome\(pnl, rMultiple\)/.test(source), false, 'classifyTradeOutcome should take only pnl, not pnl + rMultiple.');
});

test('Outcome boundary values classify exactly as specified: $1.00 and beyond is decided, inside that is Breakeven', () => {
  const { classifyTradeOutcome } = loadTradeMathModule();

  assert.equal(classifyTradeOutcome(0.99), 'breakeven', '+$0.99 should be Breakeven.');
  assert.equal(classifyTradeOutcome(-0.99), 'breakeven', '-$0.99 should be Breakeven.');
  assert.equal(classifyTradeOutcome(1.00), 'win', '+$1.00 should be a Win.');
  assert.equal(classifyTradeOutcome(-1.00), 'loss', '-$1.00 should be a Loss.');
  assert.equal(classifyTradeOutcome(1.01), 'win', '+$1.01 should be a Win.');
  assert.equal(classifyTradeOutcome(-1.01), 'loss', '-$1.01 should be a Loss.');
  assert.equal(classifyTradeOutcome(0), 'breakeven', 'Exactly $0.00 should be Breakeven.');
});

test('regression: a trade stopped out at a trailed (breakeven+) stop still classifies as Breakeven under the dollar rule', () => {
  // Real-world case: Long XAUUSD, entered 4066.39, stop trailed up to
  // 4066.67 (above entry, locking in a sliver of profit), then price
  // reversed and hit that trailed stop. Net P/L: +$0.42 — inside the
  // Breakeven dollar band regardless of how the R multiple computes.
  //
  // calculateOriginalRiskDollars/calculateRiskDollars must still compute the
  // entry-to-stop distance as a magnitude (not a signed value that returns
  // null when the stop sits above entry on a Long) — that fix is unrelated
  // to Outcome classification and still backs the Risk $ and R displays.
  const { calculatePnl, classifyTradeOutcome, calculateRiskDollars, calculateOriginalRiskDollars } = loadTradeMathModule();

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

  assert.equal(classifyTradeOutcome(calculatePnl(trade)), 'breakeven');
});

test('sanity: well-formed trades with a normal stop still classify as Win/Loss/Breakeven correctly', () => {
  const { calculatePnl, classifyTradeOutcome } = loadTradeMathModule();

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

  assert.equal(classifyTradeOutcome(calculatePnl(bigWinner)), 'win');
  assert.equal(classifyTradeOutcome(calculatePnl(bigLoser)), 'loss');
  assert.equal(classifyTradeOutcome(calculatePnl(nearFlatWinner)), 'breakeven', 'A $0.20 winner is inside the $1.00 Breakeven band.');
  assert.equal(classifyTradeOutcome(calculatePnl(shortBigWinner)), 'win');
});

test('every breakeven-count call site shares the same single-argument classifyTradeOutcome(pnl) pipeline', () => {
  // The dashboard stats, setup analytics, asset analytics, session stats,
  // trade card, and calendar day review summary must all route through the
  // same classifier so this rule (and any future one) applies everywhere at
  // once, instead of needing six separate patches.
  const sharedCallSites = source.match(/classifyTradeOutcome\((?:pnl(?:Values\[index\])?|tradePnls\[index\])\)/g) ?? [];
  assert.ok(sharedCallSites.length >= 5, `Expected at least 5 shared classifyTradeOutcome call sites, found ${sharedCallSites.length}.`);
});

test('calculateWinRate excludes Breakeven trades from both the numerator and the denominator', () => {
  // Win Rate = Wins / (Wins + Losses). Breakevens must not count as a win,
  // and must not water down the denominator either.
  const { calculateWinRate } = loadTradeMathModule();

  assert.equal(calculateWinRate(7, 3), 70, '7 wins, 3 losses, 0 breakeven -> 70%.');
  // 6 wins, 3 losses, 5 breakeven: breakevens must be excluded from the
  // denominator entirely, so this is 6/9, not 6/14.
  assert.equal(calculateWinRate(6, 3), (6 / 9) * 100);
  assert.equal(calculateWinRate(0, 0), null, 'No decided trades (e.g. all Breakeven) -> Win Rate is undefined, not 0%.');
  assert.equal(calculateWinRate(0, 4), 0, 'All losses, no wins -> 0%.');
  assert.equal(calculateWinRate(4, 0), 100, 'All wins, no losses -> 100%.');
});

test('every Win Rate call site uses the shared calculateWinRate() formula, not its own math', () => {
  const winRateCallSites = source.match(/winRate:\s*calculateWinRate\([^)]*\)/g) ?? [];
  const winRateAssignments = source.match(/const winRate = calculateWinRate\([^)]*\);/g) ?? [];
  const totalSharedCallSites = winRateCallSites.length + winRateAssignments.length;
  assert.ok(
    totalSharedCallSites >= 5,
    `Expected at least 5 places computing Win Rate via calculateWinRate(), found ${totalSharedCallSites}.`,
  );

  // Guard against a stray tradeCount- or dayTrades.length-denominated win
  // rate calculation being reintroduced anywhere.
  assert.equal(/winCount \/ .*tradeCount/.test(source), false, 'No Win Rate calculation should divide by total trade count (that would include Breakeven trades in the denominator).');
  assert.equal(/wins(?:\.length)? \/ (?:tradeList\.length|dayTrades\.length)/.test(source), false, 'No Win Rate calculation should divide wins by total trade count.');
});

test('trade card Outcome badge reuses the shared classifier and the existing DNA pill style', () => {
  // Display-only requirement: the card must show Win/Loss/Breakeven by
  // calling the same classifyTradeOutcome() used everywhere else, not by
  // re-deriving it from pnl/R with its own ad-hoc check, and it must reuse
  // the existing gold/navy analysis pill styling rather than introducing a
  // new win/loss color scheme.
  assert.ok(
    source.includes("const tradeOutcomeLabel = TRADE_OUTCOME_LABELS[classifyTradeOutcome(pnl)] || '';"),
    'tradeCard() should derive its Outcome label from the shared classifyTradeOutcome(pnl), not a separate calculation.',
  );
  assert.ok(
    source.includes("const TRADE_OUTCOME_LABELS = { win: 'Win', loss: 'Loss', breakeven: 'Breakeven' };"),
    'Outcome labels should be a plain Win/Loss/Breakeven lookup next to the classifier, not styled per outcome.',
  );

  const tradeCardStart = source.indexOf('function tradeCard(trade) {');
  assert.notEqual(tradeCardStart, -1, 'tradeCard() should exist.');
  const tradeCardEnd = source.indexOf('\nfunction ', tradeCardStart + 1);
  const tradeCardBody = source.slice(tradeCardStart, tradeCardEnd === -1 ? undefined : tradeCardEnd);

  assert.ok(tradeCardBody.includes('tradeOutcomeLabel,'), 'The Analysis pill row should include the Outcome label.');
  assert.ok(
    tradeCardBody.includes('<span class="tc-pill tc-pill--analysis">'),
    'The Outcome pill should render with the same tc-pill--analysis class as the other Analysis badges, not a new class.',
  );

  // Guard against a new win/red/loss-green color scheme creeping in later:
  // no outcome-specific CSS class or inline color should be introduced.
  assert.equal(/tc-pill--(win|loss|breakeven)/.test(source), false, 'The Outcome badge must not introduce its own color-coded pill class.');
});
