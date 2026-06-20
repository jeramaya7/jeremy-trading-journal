import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

function assertIncludes(text, expected, message) {
  assert.ok(text.includes(expected), `${message}\nExpected to find: ${expected}`);
}

test('trade cards automatically display duration from open and close times', () => {
  assertIncludes(source, 'function formatTradeDuration(openTime, closeTime)', 'Trade duration formatting is centralized.');
  assertIncludes(source, 'const totalMinutes = Math.round((closeTimestamp - openTimestamp) / (60 * 1000));', 'Duration is calculated from the timestamp difference in minutes.');
  assertIncludes(source, 'return `${hours}h ${minutes}m`;', 'Durations of one hour or more use the requested compact hour/minute format.');
  assertIncludes(source, 'return `${minutes}m`;', 'Durations under one hour use the requested compact minute format.');
  assertIncludes(source, 'const tradeDuration = formatTradeDuration(trade.openTime, trade.closeTime);', 'Each card derives duration from saved open and close timestamps.');
  assertIncludes(source, '<span>Duration: ${escapeHtml(tradeDuration)}</span>', 'Each card visibly displays the calculated duration.');
});

test('starter trades include open and close timestamps for duration collection examples', () => {
  assertIncludes(source, "openTime: '2026-06-03T13:30:00.000Z'", 'Starter trades include an open time.');
  assertIncludes(source, "closeTime: '2026-06-03T13:35:00.000Z'", 'Starter trades include a close time.');
  assertIncludes(source, "openTime: '2026-06-05T14:00:00.000Z'", 'Starter trades include a one-hour-plus duration example.');
  assertIncludes(source, "closeTime: '2026-06-05T15:15:00.000Z'", 'Starter trades include a one-hour-plus duration example close time.');
});
