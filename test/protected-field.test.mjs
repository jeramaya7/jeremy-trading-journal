import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Guards the new Protected field (src/main.js): the Yes/No dropdown, and the
// Protected % dashboard metric derived from it. Extracts the real
// TRADE_PROTECTED_OPTIONS array, renderProtectedSelect/renderSelectOption,
// and the getStats() Protected % calculation from the shipped source (rather
// than reimplementing them) so the tests exercise the actual code the app
// renders, saves, and calculates from.

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
  const openIndex = markerIndex + marker.length;
  const openChar = source[openIndex];
  if (openChar !== '{' && openChar !== '[') {
    const semicolonIndex = source.indexOf(';', openIndex);
    return source.slice(markerIndex, semicolonIndex + 1);
  }
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  let cursor = openIndex;
  while (true) {
    if (source[cursor] === openChar) depth += 1;
    else if (source[cursor] === closeChar) {
      depth -= 1;
      if (depth === 0) break;
    }
    cursor += 1;
  }
  const semicolonIndex = source.indexOf(';', cursor);
  return source.slice(markerIndex, semicolonIndex + 1);
}

function loadProtectedModule() {
  const code = [
    extractConst('TRADE_PROTECTED_OPTIONS'),
    extractFunction('escapeHtml'),
    extractFunction('renderSelectOption'),
    extractFunction('renderProtectedSelect'),
    'module.exports = { TRADE_PROTECTED_OPTIONS, renderProtectedSelect };',
  ].join('\n\n');

  const context = { module: { exports: {} } };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'main.js (extracted protected options)' });
  return context.module.exports;
}

test('the Protected dropdown list is exactly Yes/No, in order', () => {
  const { TRADE_PROTECTED_OPTIONS } = loadProtectedModule();

  // Array.from() rebuilds the array using this realm's Array constructor:
  // the extracted value was built inside a separate vm context, so a plain
  // deepEqual would otherwise fail on cross-realm prototype identity even
  // though the contents are identical.
  assert.deepEqual(Array.from(TRADE_PROTECTED_OPTIONS), ['Yes', 'No']);
});

test('a chosen Protected value renders as the selected option and the other option is still present', () => {
  const { renderProtectedSelect } = loadProtectedModule();

  const markupYes = renderProtectedSelect({ protected: 'Yes' });
  assert.match(markupYes, /<option value="Yes" selected>Yes<\/option>/);
  assert.match(markupYes, /<option value="No">No<\/option>/);

  const markupNo = renderProtectedSelect({ protected: 'No' });
  assert.match(markupNo, /<option value="No" selected>No<\/option>/);
  assert.match(markupNo, /<option value="Yes">Yes<\/option>/);
});

test('a trade with no Protected value chosen defaults to the blank "None" option, never Yes or No', () => {
  const { renderProtectedSelect } = loadProtectedModule();

  // Existing trades (saved before this field existed) have no `protected`
  // property at all — this must render as the blank default, not silently
  // assume Yes or No.
  const markupMissingField = renderProtectedSelect({});
  assert.match(markupMissingField, /<option value="">None<\/option>/);
  assert.equal(markupMissingField.includes('selected>Yes<'), false);
  assert.equal(markupMissingField.includes('selected>No<'), false);

  const markupBlankField = renderProtectedSelect({ protected: '' });
  assert.match(markupBlankField, /<option value="">None<\/option>/);
});

test('Protected is wired into the edit form and the Supabase annotation sync whitelist', () => {
  assert.ok(
    source.includes("${field('Protected', renderProtectedSelect(trade))}"),
    'The edit form should render the Protected dropdown alongside Trade Management/Grade.',
  );
  assert.ok(
    source.includes("protected: String(formData.get('protected')).trim(),"),
    'Saving an edited trade should read the Protected field like the other journal fields.',
  );

  const mainWhitelistMatch = source.match(/const JOURNAL_ANNOTATION_FIELDS = \[[^\]]*\];/);
  assert.ok(mainWhitelistMatch, 'JOURNAL_ANNOTATION_FIELDS should exist in main.js.');
  assert.ok(
    mainWhitelistMatch[0].includes("'protected'"),
    "protected must be in the Supabase annotation whitelist (main.js), or edits will be silently stripped before syncing.",
  );
});

test('Protected displays on the trade card journal panel', () => {
  assert.ok(
    source.includes("tradeMetric('Protected', trade.protected)"),
    'The trade card Journal panel should display the Protected value.',
  );
});

// --- Protected % dashboard metric -----------------------------------------

test('getStats computes Protected % as Yes-marked trades divided by all trades in the list, times 100', () => {
  assert.ok(
    source.includes("const protectedYesCount = tradeList.filter((trade) => String(trade.protected || '').trim() === 'Yes').length;"),
    'Protected % numerator should count trades explicitly marked Yes.',
  );
  assert.ok(
    source.includes('const protectedPercent = tradeList.length ? (protectedYesCount / tradeList.length) * 100 : null;'),
    'Protected % denominator should be every trade in the list (all completed trades), returning null when there are none.',
  );
  assert.ok(
    source.includes('protectedPercent,'),
    'getStats() should return protectedPercent on the stats object.',
  );
});

test('Protected % formula behaves correctly across edge cases (mirrors the shipped getStats formula)', () => {
  // This reimplements the two-line formula verified by source-inclusion
  // above, so edge cases (empty list, missing field, mixed values) are
  // actually exercised with numbers rather than just grepped for.
  function protectedPercent(tradeList) {
    const protectedYesCount = tradeList.filter((trade) => String(trade.protected || '').trim() === 'Yes').length;
    return tradeList.length ? (protectedYesCount / tradeList.length) * 100 : null;
  }

  assert.equal(protectedPercent([]), null, 'No completed trades should render as no data, not 0%.');
  assert.equal(protectedPercent([{ protected: 'No' }, { protected: 'No' }]), 0, 'No trades marked Yes should be 0%.');
  assert.equal(protectedPercent([{ protected: 'Yes' }, { protected: 'Yes' }]), 100, 'All trades marked Yes should be 100%.');
  assert.equal(protectedPercent([{ protected: 'Yes' }, { protected: 'No' }, { protected: 'No' }, { protected: 'No' }]), 25, '1 of 4 Yes should be 25%.');
  assert.equal(
    protectedPercent([{ protected: 'Yes' }, {}, { protected: '' }, { protected: 'No' }]),
    25,
    'Trades with no Protected value set (undefined or blank) should count toward the denominator but not the numerator.',
  );
});

test('Protected % renders on the dashboard top KPI row, fourth, after Net Profit / Win Rate / Profit Factor', () => {
  assert.ok(
    source.includes("statCard('chart', 'Protected %', formatPercent(stats.protectedPercent))"),
    'Protected % should render using the shared formatPercent() helper (one decimal place, em dash when null).',
  );
});
