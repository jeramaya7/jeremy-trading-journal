import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

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

const TRADING_DAY_FUNCTIONS = [
  'getTradingDayDateKey',
  'getReportPeriodStart',
  'getTradeReportDate',
  'getTradeTradingDayDateKey',
  'formatDateKey',
  'filterTradesForPeriod',
  'getMonthlyCalendarMonthKey',
  'getMonthlyTradingCalendarNavigationState',
  'getMonthlyTradingCalendarDays',
  'getSessionNotesForDay',
];

function loadTradingDayModule(sessionNotesByDay = {}) {
  const code = [
    extractConst('TRADING_DAY_TIME_ZONE'),
    extractConst('TRADING_DAY_RESET_HOUR'),
    ...TRADING_DAY_FUNCTIONS.map(extractFunction),
    `module.exports = { ${TRADING_DAY_FUNCTIONS.join(', ')} };`,
  ].join('\n\n');

  const context = {
    module: { exports: {} },
    sessionNotesByDay,
    trades: [],
    calculatePnl: (trade) => Number(trade.netProfitLoss) || 0,
    getTradeStartingBalance: (trade) => trade.accountSize ?? null,
  };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'main.js (extracted trading-day helpers)' });
  return context.module.exports;
}

test('5 PM New York cutoff labels the trading day by the date it ends in EST and EDT', () => {
  const { getTradingDayDateKey } = loadTradingDayModule();

  assert.equal(getTradingDayDateKey(new Date('2026-01-15T21:59:59.999Z')), '2026-01-15', '4:59:59 PM EST should remain in the Jan 15 trading day.');
  assert.equal(getTradingDayDateKey(new Date('2026-01-15T22:00:00.000Z')), '2026-01-16', '5:00 PM EST should begin the Jan 16 trading day.');
  assert.equal(getTradingDayDateKey(new Date('2026-08-20T20:59:59.999Z')), '2026-08-20', '4:59:59 PM EDT should remain in the Aug 20 trading day.');
  assert.equal(getTradingDayDateKey(new Date('2026-08-20T21:00:00.000Z')), '2026-08-21', '5:00 PM EDT should begin the Aug 21 trading day.');
});

test('day filtering includes the full 5 PM-to-4:59:59 New York session', () => {
  const { filterTradesForPeriod } = loadTradingDayModule();
  const trades = [
    { id: 'before', closeTime: '2026-08-20T20:59:59.999Z' },
    { id: 'open', closeTime: '2026-08-20T21:00:00.000Z' },
    { id: 'close', closeTime: '2026-08-21T20:59:59.999Z' },
    { id: 'next', closeTime: '2026-08-21T21:00:00.000Z' },
  ];

  const selected = filterTradesForPeriod(trades, 'day', new Date('2026-08-21T20:59:59.999Z'));
  assert.deepEqual(Array.from(selected, (trade) => trade.id), ['open', 'close']);
});

test('week, month, and year labels keep their calendar definitions at the trading-day boundary', () => {
  const { getReportPeriodStart, formatDateKey, getTradingDayDateKey } = loadTradingDayModule();

  assert.equal(formatDateKey(getReportPeriodStart(new Date('2026-08-23T20:59:59.999Z'), 'week')), '2026-08-17', 'Before Sunday 5 PM EDT, WTD should still use the prior Monday.');
  assert.equal(formatDateKey(getReportPeriodStart(new Date('2026-08-23T21:00:00.000Z'), 'week')), '2026-08-24', 'Sunday 5 PM EDT should begin Monday\'s new trading week.');
  assert.equal(getTradingDayDateKey(new Date('2026-08-31T21:00:00.000Z')), '2026-09-01', 'The Sep 1 trading day should begin Aug 31 at 5 PM EDT.');
  assert.equal(formatDateKey(getReportPeriodStart(new Date('2026-08-31T21:00:00.000Z'), 'month')), '2026-09-01', 'MTD should reset with the Sep 1 trading day.');
  assert.equal(formatDateKey(getReportPeriodStart(new Date('2026-12-31T22:00:00.000Z'), 'year')), '2027-01-01', 'YTD should reset with the Jan 1 trading day at 5 PM EST.');
});

test('date-only manual trades keep their stored date as their trading-day date', () => {
  const { getTradeTradingDayDateKey, filterTradesForPeriod } = loadTradingDayModule();
  const manualTrade = { id: 'manual', date: '2026-08-21' };

  assert.equal(getTradeTradingDayDateKey(manualTrade), '2026-08-21');
  assert.equal(filterTradesForPeriod([manualTrade], 'day', new Date('2026-08-20T21:00:00.000Z')).length, 1);
  assert.equal(manualTrade.date, '2026-08-21', 'Grouping must not modify the stored manual-trade date.');
});

test('monthly calendar groups imported trades under the trading-day label and rolls months correctly', () => {
  const { getMonthlyTradingCalendarDays, getMonthlyTradingCalendarNavigationState } = loadTradingDayModule();
  const trades = [
    { id: 'aug', closeTime: '2026-08-31T20:59:59.999Z', netProfitLoss: 10 },
    { id: 'sep', closeTime: '2026-08-31T21:00:00.000Z', netProfitLoss: 20 },
  ];
  const augustDays = getMonthlyTradingCalendarDays(new Date(2026, 7, 1), trades).filter(Boolean);
  const septemberDays = getMonthlyTradingCalendarDays(new Date(2026, 8, 1), trades).filter(Boolean);

  assert.equal(augustDays.find((day) => day.dateKey === '2026-08-31').report.tradeCount, 1);
  assert.equal(septemberDays.find((day) => day.dateKey === '2026-09-01').report.tradeCount, 1);
  assert.deepEqual(
    { ...getMonthlyTradingCalendarNavigationState(new Date(2026, 7, 1), trades) },
    { canGoPrevious: false, canGoNext: true },
  );
});

test('existing session notes are read by their created timestamp without rewriting storage', () => {
  const sessionNotesByDay = {
    '2026-08-20': [
      { id: 'before', createdAt: '2026-08-20T20:59:59.999Z', text: 'Before reset' },
      { id: 'after', createdAt: '2026-08-20T21:00:00.000Z', text: 'After reset' },
    ],
  };
  const { getSessionNotesForDay } = loadTradingDayModule(sessionNotesByDay);

  assert.deepEqual(Array.from(getSessionNotesForDay('2026-08-20'), (note) => note.id), ['before']);
  assert.deepEqual(Array.from(getSessionNotesForDay('2026-08-21'), (note) => note.id), ['after']);
  assert.equal(sessionNotesByDay['2026-08-20'].length, 2, 'Reading notes must not rewrite existing storage.');
});

test('all identified Today and Daily paths use the shared New York trading-day key', () => {
  for (const expected of [
    'let manualTradeDateKey = getTradingDayDateKey(new Date());',
    'const todayKey = getTradingDayDateKey(now);',
    'function monthlyCalendarDayCell(calendarDay, todayKey = getTradingDayDateKey(new Date()))',
    'const matchesCalendarDate = !selectedCalendarDateKey || getTradeTradingDayDateKey(trade) === selectedCalendarDateKey;',
    'const today = getTradingDayDateKey(dnaReferenceDate);',
    'manualTradeDateKey = selectedCalendarDateKey || getTradingDayDateKey(new Date());',
    'const dateKey = getTradingDayDateKey(referenceDate);',
  ]) {
    assert.ok(source.includes(expected), `Expected shared trading-day wiring: ${expected}`);
  }
});
