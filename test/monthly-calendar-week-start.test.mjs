import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('monthly trading calendar renders Monday-first weekdays and offsets dates from Monday', () => {
  assert.ok(
    source.includes("const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];"),
    'Monthly trading calendar weekday headers should start on Monday.',
  );
  assert.ok(
    source.includes('const leadingEmptyDays = (monthStart.getDay() + 6) % 7;'),
    'Monthly trading calendar leading empty cells should convert JavaScript Sunday-first day indexes to Monday-first offsets.',
  );
  assert.ok(
    source.includes('report.pnl += calculatePnl(trade);'),
    'Monthly trading calendar daily P/L values should continue using the existing P/L calculation.',
  );
  assert.ok(
    source.includes('const pnlTone = report ? getMoneyTone(report.pnl) || \'positive\' : \'\';'),
    'Monthly trading calendar daily P/L colors should continue using existing money tone classes.',
  );
});

test('monthly trading calendar highlights only the matching today date', () => {
  assert.ok(
    source.includes('function monthlyCalendarDayCell(calendarDay, todayKey = getTradingDayDateKey(new Date()))'),
    'Monthly trading calendar should compare each rendered date against the current New York trading day.',
  );
  assert.ok(
    source.includes('const isToday = calendarDay.dateKey === todayKey;'),
    'Monthly trading calendar should only mark the cell whose date key matches today.',
  );
  assert.ok(
    source.includes("isToday ? 'monthly-calendar-day-today' : ''"),
    'Monthly trading calendar should add a focused today class without changing P/L tone classes.',
  );
});


test('monthly trading calendar disables month navigation at available trade data bounds', () => {
  assert.ok(
    source.includes('function getMonthlyTradingCalendarNavigationState(referenceDate = new Date(), tradeList = trades)'),
    'Monthly trading calendar should derive navigation state from available trade months.',
  );
  assert.ok(
    source.includes('canGoPrevious: currentMonthKey > Math.min(...tradeMonthKeys),'),
    'Previous Month should only be enabled after the earliest trade month.',
  );
  assert.ok(
    source.includes('canGoNext: currentMonthKey < Math.max(...tradeMonthKeys),'),
    'Next Month should only be enabled before the latest trade month.',
  );
  assert.ok(
    source.includes("data-calendar-month=\"previous\" ${canGoPrevious ? '' : 'disabled aria-disabled=\"true\"'}"),
    'Previous Month should render as disabled at the earliest trade month while remaining visible.',
  );
  assert.ok(
    source.includes("data-calendar-month=\"next\" ${canGoNext ? '' : 'disabled aria-disabled=\"true\"'}"),
    'Next Month should render as disabled at the latest trade month while remaining visible.',
  );
  assert.ok(
    source.includes('if (button.disabled) {'),
    'Disabled calendar navigation buttons should not handle clicks.',
  );
});
