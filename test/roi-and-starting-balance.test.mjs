import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Guards the ROI % dashboard metric and its Starting Account Balance setting
// (src/main.js).
//
// ROI % now follows the same DNA Results period selector as the rest of the
// dashboard (Day / WTD / MTD / YTD / Beginning): each period's ROI is period
// P/L ÷ the account balance as of the *start* of that period, except
// Beginning, which uses the flat Starting Account Balance setting (there are
// no prior trades before "the beginning"). The Starting Account Balance
// itself (default $5,600) is configured from the Settings modal — not the
// ROI card, which shows only the label and value.
//
// Also guards the DNA Results 4x3 grid (ROI %, Biggest Winner, Biggest
// Loser, Profit Factor / Average Winner, Average Loser, Average Risk $,
// Average Risk % / Daily P/L, Weekly P/L, Monthly P/L, Yearly P/L) with
// Biggest Risk removed entirely and Profit Factor moved out of the top KPI
// row.

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

// The functions ROI depends on transitively (calculatePnl -> getTradeContractSize
// -> getTradeDisplaySymbol -> ...), extracted from the live source rather than
// reimplemented, so the tests exercise the actual shipped code.
const ROI_MATH_FUNCTIONS = [
  'toOptionalNumber',
  'isCTraderImportedTrade',
  'getTradeDisplaySymbol',
  'firstReadableTradeSymbol',
  'getTradeContractSize',
  'calculatePnl',
  'getTradeReportDate',
  'getReportPeriodStart',
  'calculateAccountBalanceAtPeriodStart',
  'calculateRoiPercent',
];

function loadRoiModule() {
  const code = [
    ...ROI_MATH_FUNCTIONS.map(extractFunction),
    'module.exports = { ' + ROI_MATH_FUNCTIONS.join(', ') + ' };',
  ].join('\n\n');

  const context = { module: { exports: {} } };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'main.js (extracted ROI math)' });
  return context.module.exports;
}

function trade({ closeTime, date, netProfitLoss, entry, exit, size = 1, direction = 'Long', provider = 'ctrader' }) {
  return { closeTime, date, netProfitLoss, entry, exit, size, direction, provider };
}

test('Starting Account Balance defaults to $5,600 and is a dedicated localStorage setting', () => {
  assert.ok(
    source.includes("const DEFAULT_STARTING_ACCOUNT_BALANCE = 5600;"),
    'Default starting account balance should be $5,600.',
  );
  assert.ok(
    source.includes("const STARTING_ACCOUNT_BALANCE_STORAGE_KEY = 'jeremy-trading-journal:starting-account-balance:v1';"),
    'Starting Account Balance should use its own dedicated localStorage key, following the same pattern as other settings (DNA timeframe, page mode, etc).',
  );
  assert.ok(
    source.includes('function loadStartingAccountBalance()'),
    'Starting Account Balance should be restored on load.',
  );
  assert.ok(
    source.includes('function setStartingAccountBalance(rawValue)'),
    'Starting Account Balance should be settable and persisted.',
  );
});

test('calculateRoiPercent = period P/L ÷ account balance at period start × 100', () => {
  const { calculateRoiPercent } = loadRoiModule();

  assert.equal(calculateRoiPercent(560, 5600), 10, '$560 P/L on a $5,600 balance should be 10% ROI.');
  assert.equal(calculateRoiPercent(-280, 5600), -5, '-$280 P/L on a $5,600 balance should be -5% ROI.');
  assert.equal(calculateRoiPercent(0, 5600), 0, '$0 P/L should be 0% ROI, not null.');
  assert.equal(calculateRoiPercent(1000, 0), null, 'A zero or invalid balance should return null, not divide by zero.');
  assert.equal(calculateRoiPercent(1000, -500), null, 'A negative balance should return null, not a negative-of-negative percent.');
});

test('Beginning ROI uses the flat Starting Account Balance — no prior trades to account for', () => {
  const { calculateAccountBalanceAtPeriodStart } = loadRoiModule();

  const allTrades = [
    trade({ closeTime: '2026-01-05T10:00:00Z', netProfitLoss: 200 }),
    trade({ closeTime: '2026-06-10T10:00:00Z', netProfitLoss: -50 }),
  ];

  assert.equal(
    calculateAccountBalanceAtPeriodStart('all', new Date('2026-07-16T12:00:00Z'), allTrades, 5600),
    5600,
    'Beginning (period "all") should return the Starting Account Balance itself, ignoring trade history.',
  );
});

test('Day ROI uses the balance as of the start of today, excluding trades already counted today', () => {
  const { calculateAccountBalanceAtPeriodStart } = loadRoiModule();

  // Timestamps sit well clear of the day boundary (not near midnight) so the
  // test is stable regardless of which timezone it runs in.
  const referenceDate = new Date('2026-07-16T15:00:00Z');
  const allTrades = [
    trade({ closeTime: '2026-07-14T12:00:00Z', netProfitLoss: 300 }), // before today
    trade({ closeTime: '2026-07-15T12:00:00Z', netProfitLoss: 100 }), // before today
    trade({ closeTime: '2026-07-16T09:00:00Z', netProfitLoss: 999 }), // today — must be excluded
  ];

  const balance = calculateAccountBalanceAtPeriodStart('day', referenceDate, allTrades, 5000);
  assert.equal(balance, 5000 + 300 + 100, 'Balance at start of today = Starting Balance + P/L of every trade closed strictly before today.');
});

test('WTD ROI uses the balance as of the start of the week (Monday)', () => {
  const { calculateAccountBalanceAtPeriodStart } = loadRoiModule();

  // 2026-07-16 is a Thursday, so the week starts Monday 2026-07-13.
  // Timestamps sit well clear of the week boundary (not near midnight) so
  // the test is stable regardless of which timezone it runs in.
  const referenceDate = new Date('2026-07-16T15:00:00Z');
  const allTrades = [
    trade({ closeTime: '2026-07-10T12:00:00Z', netProfitLoss: 400 }), // before this week (prior Friday)
    trade({ closeTime: '2026-07-13T12:00:00Z', netProfitLoss: 50 }), // this Monday — inside the week, must be excluded
    trade({ closeTime: '2026-07-15T12:00:00Z', netProfitLoss: 20 }), // this week — must be excluded
  ];

  const balance = calculateAccountBalanceAtPeriodStart('week', referenceDate, allTrades, 5000);
  assert.equal(balance, 5000 + 400, 'Balance at start of week should only include trades closed before this Monday.');
});

test('MTD ROI uses the balance as of the start of the month', () => {
  const { calculateAccountBalanceAtPeriodStart } = loadRoiModule();

  // Timestamps sit well clear of the month boundary (not near midnight) so
  // the test is stable regardless of which timezone it runs in.
  const referenceDate = new Date('2026-07-16T15:00:00Z');
  const allTrades = [
    trade({ closeTime: '2026-06-29T12:00:00Z', netProfitLoss: 700 }), // before this month
    trade({ closeTime: '2026-07-01T12:00:00Z', netProfitLoss: 15 }), // this month — must be excluded
    trade({ closeTime: '2026-07-10T09:00:00Z', netProfitLoss: 25 }), // this month — must be excluded
  ];

  const balance = calculateAccountBalanceAtPeriodStart('month', referenceDate, allTrades, 5000);
  assert.equal(balance, 5000 + 700, 'Balance at start of month should only include trades closed before the 1st of this month.');
});

test('YTD ROI uses the balance as of the start of the year', () => {
  const { calculateAccountBalanceAtPeriodStart } = loadRoiModule();

  // Timestamps sit well clear of the year boundary (not near midnight) so
  // the test is stable regardless of which timezone it runs in.
  const referenceDate = new Date('2026-07-16T15:00:00Z');
  const allTrades = [
    trade({ closeTime: '2025-12-30T12:00:00Z', netProfitLoss: 1200 }), // last year
    trade({ closeTime: '2026-01-02T12:00:00Z', netProfitLoss: 40 }), // this year — must be excluded
    trade({ closeTime: '2026-05-10T09:00:00Z', netProfitLoss: 60 }), // this year — must be excluded
  ];

  const balance = calculateAccountBalanceAtPeriodStart('year', referenceDate, allTrades, 5000);
  assert.equal(balance, 5000 + 1200, 'Balance at start of year should only include trades closed before January 1st of this year.');
});

test('end-to-end: Day/WTD/MTD/YTD/Beginning ROI all compute correctly together', () => {
  const { calculateAccountBalanceAtPeriodStart, calculateRoiPercent } = loadRoiModule();

  // Thursday 2026-07-16. Week starts Monday 2026-07-13. Month starts
  // 2026-07-01. Year starts 2026-01-01.
  const referenceDate = new Date('2026-07-16T18:00:00Z');
  const startingBalance = 5600;
  const allTrades = [
    trade({ closeTime: '2025-03-01T10:00:00Z', netProfitLoss: 400 }), // before the year
    trade({ closeTime: '2026-01-15T10:00:00Z', netProfitLoss: 200 }), // this year, before the month
    trade({ closeTime: '2026-07-02T10:00:00Z', netProfitLoss: 100 }), // this month, before the week
    trade({ closeTime: '2026-07-14T10:00:00Z', netProfitLoss: 50 }), // this week, before today
    trade({ closeTime: '2026-07-16T09:00:00Z', netProfitLoss: 30 }), // today
  ];

  // Beginning: total P/L is the sum of every trade, over the flat starting balance.
  const totalPnl = 400 + 200 + 100 + 50 + 30;
  const beginningBalance = calculateAccountBalanceAtPeriodStart('all', referenceDate, allTrades, startingBalance);
  assert.equal(beginningBalance, startingBalance);
  assert.equal(calculateRoiPercent(totalPnl, beginningBalance), (totalPnl / startingBalance) * 100);

  // Day: only today's trade counts as P/L; balance = starting + everything before today.
  const dayBalance = calculateAccountBalanceAtPeriodStart('day', referenceDate, allTrades, startingBalance);
  assert.equal(dayBalance, startingBalance + 400 + 200 + 100 + 50);
  assert.equal(calculateRoiPercent(30, dayBalance), (30 / dayBalance) * 100);

  // WTD: this week's trades (Mon 07-14 through today) count as P/L.
  const weekPnl = 50 + 30;
  const weekBalance = calculateAccountBalanceAtPeriodStart('week', referenceDate, allTrades, startingBalance);
  assert.equal(weekBalance, startingBalance + 400 + 200 + 100);
  assert.equal(calculateRoiPercent(weekPnl, weekBalance), (weekPnl / weekBalance) * 100);

  // MTD: this month's trades (07-02 onward) count as P/L.
  const monthPnl = 100 + 50 + 30;
  const monthBalance = calculateAccountBalanceAtPeriodStart('month', referenceDate, allTrades, startingBalance);
  assert.equal(monthBalance, startingBalance + 400 + 200);
  assert.equal(calculateRoiPercent(monthPnl, monthBalance), (monthPnl / monthBalance) * 100);

  // YTD: this year's trades (2026-01-15 onward) count as P/L.
  const yearPnl = 200 + 100 + 50 + 30;
  const yearBalance = calculateAccountBalanceAtPeriodStart('year', referenceDate, allTrades, startingBalance);
  assert.equal(yearBalance, startingBalance + 400);
  assert.equal(calculateRoiPercent(yearPnl, yearBalance), (yearPnl / yearBalance) * 100);
});

test('the ROI % card follows the shared DNA Results period selector and shows only the label and value', () => {
  assert.ok(
    source.includes('function renderRoiCard(roiPercent)'),
    'renderRoiCard should take only roiPercent — the account balance is no longer displayed on the card.',
  );
  assert.ok(
    source.includes("<span>ROI %</span>"),
    'The ROI % card should show the ROI % label.',
  );
  assert.equal(source.includes('roi-starting-balance-note'), false, 'The "Based on $X starting balance" note should be fully removed from the card.');
  assert.equal(source.includes('Based on $'), false, 'No starting-balance text should remain anywhere in the ROI card markup.');
  assert.equal(source.includes('data-starting-account-balance'), false, 'The ROI % card should not render an editable Starting Account Balance input.');
  assert.equal(source.includes('roi-starting-balance-edit'), false, 'The old inline-edit markup/styling should be fully removed.');

  // ROI must be wired to the same dnaResultsTimeframe/dnaReferenceDate the
  // rest of DNA Results uses, so it updates automatically when the period
  // toggle changes.
  assert.ok(
    source.includes('const roiAccountBalance = calculateAccountBalanceAtPeriodStart(dnaResultsTimeframe, dnaReferenceDate, trades, startingAccountBalance);'),
    'ROI\'s account balance should be derived from the current DNA Results period (dnaResultsTimeframe) and reference date.',
  );
  assert.ok(
    source.includes('const roiPercent = calculateRoiPercent(stats.totalPnl, roiAccountBalance);'),
    'ROI % should use the period-filtered stats.totalPnl over the period-start account balance.',
  );
});

test('Starting Account Balance is editable from the Settings modal, and is only used for the Beginning calculation', () => {
  assert.ok(
    source.includes('function renderSettingsModal()'),
    'A dedicated Settings modal renderer should exist.',
  );
  assert.ok(
    source.includes('isSettingsModalOpen'),
    'Settings modal visibility should be tracked in state, like the Session Notes modal.',
  );
  assert.ok(
    source.includes('data-settings-open'),
    'A Settings button should open the modal.',
  );
  assert.ok(
    source.includes('name="startingAccountBalance"'),
    'The Settings modal should contain the Starting Account Balance field.',
  );
  assert.ok(
    source.includes("document.querySelector('#settingsForm')?.addEventListener('submit'"),
    'Saving the Settings form should be wired to a submit handler.',
  );
  assert.ok(
    source.includes("setStartingAccountBalance(new FormData(event.currentTarget).get('startingAccountBalance'));"),
    'Saving Settings should persist the new Starting Account Balance.',
  );
  assert.ok(
    source.includes('data-settings-cancel'),
    'The Settings modal should be cancelable without saving.',
  );

  // The raw setting is only fed into calculateAccountBalanceAtPeriodStart,
  // which uses it directly for "all" and as the base for every other
  // period's derived balance.
  assert.ok(
    source.includes("if (period === 'all') {\n    return startingBalance;\n  }"),
    'The Starting Account Balance should be used directly (unmodified) for the Beginning period.',
  );
});

test('DNA Results first row renders ROI %, Biggest Winner, Biggest Loser, Profit Factor in that order', () => {
  const roiIndex = source.indexOf('renderRoiCard(roiPercent),');
  const biggestWinnerIndex = source.indexOf("statCard('trend', 'Biggest Winner'");
  const biggestLoserIndex = source.indexOf("statCard('trend', 'Biggest Loser'");
  const profitFactorIndex = source.indexOf("statCard('line', 'Profit Factor', formatProfitFactor(stats.profitFactor), getProfitFactorTone(stats.profitFactor))");

  assert.notEqual(roiIndex, -1, 'ROI % card should render in the DNA Results first row.');
  assert.notEqual(profitFactorIndex, -1, 'Profit Factor card should render in the DNA Results first row.');
  assert.ok(
    roiIndex < biggestWinnerIndex && biggestWinnerIndex < biggestLoserIndex && biggestLoserIndex < profitFactorIndex,
    'DNA Results first row order should be: ROI %, Biggest Winner, Biggest Loser, Profit Factor.',
  );
});

test('Profit Factor no longer renders in the top KPI row (it now lives under DNA Results)', () => {
  const heroRowStart = source.indexOf('function renderHeroStatsRow(stats)');
  const heroRowEnd = source.indexOf('\nfunction ', heroRowStart + 1);
  const heroRowBody = source.slice(heroRowStart, heroRowEnd);

  assert.equal(heroRowBody.includes('Profit Factor'), false, 'Profit Factor should not appear in renderHeroStatsRow.');
});

test('Biggest Risk is removed from the dashboard entirely (display only — the calculation itself is untouched)', () => {
  const dashboardCardRowsStart = source.indexOf('const dashboardCardRows = [');
  const dashboardCardRowsEnd = source.indexOf('\n  ];', dashboardCardRowsStart) + '\n  ];'.length;
  const dashboardCardRowsBody = source.slice(dashboardCardRowsStart, dashboardCardRowsEnd);

  assert.equal(dashboardCardRowsBody.includes('Biggest Risk'), false, 'Biggest Risk should not render as a dashboard card anywhere.');

  // The underlying calculation must remain untouched — only the display
  // changed, per "do not change any calculations except the display".
  assert.ok(source.includes('biggestRisk'), 'stats.biggestRisk should still be computed in getStats() even though it is no longer displayed.');
  assert.ok(source.includes('const biggestRisk = riskDollarValues.length ? Math.max(...riskDollarValues) : null;'), 'The Biggest Risk calculation itself should be unchanged.');
});

test('DNA Results is a consistent 4x3 grid — every row has exactly four cards', () => {
  const dashboardCardRowsStart = source.indexOf('const dashboardCardRows = [');
  const dashboardCardRowsEnd = source.indexOf('\n  ];', dashboardCardRowsStart) + '\n  ];'.length;
  const dashboardCardRowsBody = source.slice(dashboardCardRowsStart, dashboardCardRowsEnd);

  const rowLabels = ['R Metrics', 'Risk Metrics', 'Time Performance'];
  const rowBoundaries = rowLabels.map((label) => dashboardCardRowsBody.indexOf(`label: '${label}'`));
  rowBoundaries.forEach((index, i) => assert.notEqual(index, -1, `${rowLabels[i]} row should exist.`));

  const rowBodies = rowBoundaries.map((start, i) => {
    const end = i + 1 < rowBoundaries.length ? rowBoundaries[i + 1] : dashboardCardRowsBody.length;
    return dashboardCardRowsBody.slice(start, end);
  });

  // Each row's card list is a `cards: [ ... ]` array — count top-level
  // entries by counting statCard(/renderRoiCard( calls between its `cards: [`
  // and the matching closing `],`.
  rowBodies.forEach((rowBody, i) => {
    const cardsStart = rowBody.indexOf('cards: [');
    const cardsEnd = rowBody.indexOf('\n      ],', cardsStart);
    const cardsBody = rowBody.slice(cardsStart, cardsEnd);
    const cardCount = (cardsBody.match(/(?:statCard|renderRoiCard)\(/g) ?? []).length;
    assert.equal(cardCount, 4, `${rowLabels[i]} row should have exactly 4 cards, found ${cardCount}.`);
  });

  // No row-level five-card modifier should remain now that every row is 4.
  assert.equal(source.includes('dashboard-card-row--five'), false, 'The five-card grid modifier should be removed now that every DNA Results row has exactly 4 cards.');
});
