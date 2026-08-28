import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('Protected controls are absent from both trade edit forms', () => {
  const fullEditStart = source.indexOf('function editTradeForm(trade)');
  const quickEditStart = source.indexOf('function editTradeFormQuickEdit(trade)');
  const quickEditEnd = source.indexOf('\nfunction getEditScreenshotDraft(tradeId)', quickEditStart);
  assert.notEqual(fullEditStart, -1, 'The full edit form should exist.');
  assert.notEqual(quickEditStart, -1, 'The Quick Edit form should exist.');

  const fullEditSource = source.slice(fullEditStart, quickEditStart);
  const quickEditSource = source.slice(quickEditStart, quickEditEnd);
  assert.equal(fullEditSource.includes("field('Protected'"), false, 'Full Edit should not render a Protected field.');
  assert.equal(quickEditSource.includes("field('Protected'"), false, 'Quick Edit should not render a Protected field.');
  assert.equal(source.includes('name="protected"'), false, 'No Protected form control should remain in the trade entry UI.');
});

test('editing a trade does not overwrite its historical Protected value', () => {
  const updateStart = source.indexOf('async function buildTradeEditUpdate(form)');
  const updateEnd = source.indexOf('\nasync function submitTradeEdit(', updateStart);
  assert.notEqual(updateStart, -1, 'buildTradeEditUpdate should exist.');
  const updateSource = source.slice(updateStart, updateEnd);

  assert.equal(updateSource.includes("formData.get('protected')"), false, 'The edit save path should not read a removed Protected control.');
  assert.equal(updateSource.includes('protected:'), false, 'The edit update should omit Protected so the existing trade value survives the object spread.');
  assert.ok(source.includes('? { ...trade, ...journalingUpdates, ...screenshotUpdate }'), 'Edit updates should continue merging into the existing trade object.');
});

test('historical Protected data remains supported outside the removed control', () => {
  const annotationFields = source.match(/const JOURNAL_ANNOTATION_FIELDS = \[[^\]]*\];/);
  assert.ok(annotationFields, 'JOURNAL_ANNOTATION_FIELDS should exist.');
  assert.ok(annotationFields[0].includes("'protected'"), 'Protected must remain in the annotation whitelist for historical data.');
  assert.ok(source.includes("tradeMetric('Protected', trade.protected)"), 'Historical Protected values should remain visible on trade cards.');
});

test('historical Protected statistics remain unchanged', () => {
  assert.ok(
    source.includes("const protectedYesCount = tradeList.filter((trade) => String(trade.protected || '').trim() === 'Yes').length;"),
    'Protected statistics should still count historical Yes values.',
  );
  assert.ok(
    source.includes('const protectedPercent = tradeList.length ? (protectedYesCount / tradeList.length) * 100 : null;'),
    'Protected statistics should retain their existing formula.',
  );
  assert.ok(source.includes('protectedPercent,'), 'getStats should still return the historical Protected statistic.');
});

test('Protected percentage formula still handles historical values and missing data', () => {
  function protectedPercent(tradeList) {
    const protectedYesCount = tradeList.filter((trade) => String(trade.protected || '').trim() === 'Yes').length;
    return tradeList.length ? (protectedYesCount / tradeList.length) * 100 : null;
  }

  assert.equal(protectedPercent([]), null);
  assert.equal(protectedPercent([{ protected: 'No' }, { protected: 'No' }]), 0);
  assert.equal(protectedPercent([{ protected: 'Yes' }, { protected: 'Yes' }]), 100);
  assert.equal(protectedPercent([{ protected: 'Yes' }, {}, { protected: '' }, { protected: 'No' }]), 25);
});

test('Protected percentage remains absent from the headline dashboard cards', () => {
  assert.equal(
    source.includes("statCard('chart', 'Protected %', formatPercent(stats.protectedPercent))"),
    false,
    'Removing the trade-entry control should not change the dashboard layout.',
  );
});
