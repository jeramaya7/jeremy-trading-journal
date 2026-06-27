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
