import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

function assertIncludes(text, expected, message) {
  assert.ok(text.includes(expected), `${message}\nExpected to find: ${expected}`);
}

test('Calendar Day Review filters cTrader import notes only in its notes rendering path', () => {
  assertIncludes(source, 'function getCalendarReviewUserNote(trade)', 'Calendar Day Review has a local display-only note helper.');
  assertIncludes(source, 'const notes = dayTrades.map(getCalendarReviewUserNote).filter(Boolean);', 'Calendar Day Review filters notes before rendering its notes list.');
  assertIncludes(source, 'if (/Imported from cTrader/i.test(note) || /Imported from cTrader source trade/i.test(note)) {', 'Calendar Day Review hides cTrader import/system notes.');
  assertIncludes(source, "title === 'Notes from journal entries' ? 'No journal notes for this day.' : 'None recorded.'", 'Calendar Day Review keeps the requested empty state copy for journal notes.');
});
