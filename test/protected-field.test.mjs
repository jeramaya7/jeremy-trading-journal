import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Guards the Protected field (src/main.js): originally an independent
// Yes/No dropdown, now "Smart Protected" — a read-only value calculated
// automatically from Trade Management (see TRADE_MANAGEMENT_PROTECTED_MAP /
// getSmartProtectedValue / renderProtectedDisplay). Extracts the real
// constants and functions from the shipped source (rather than
// reimplementing them) so the tests exercise the actual code the app
// renders, saves, and calculates from.

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

function assertIncludes(text, expected, message) {
  assert.ok(text.includes(expected), `${message}\nExpected to find: ${expected}`);
}

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
    extractConst('TRADE_MANAGEMENT_PROTECTED_MAP'),
    extractFunction('escapeHtml'),
    extractFunction('getSmartProtectedValue'),
    extractFunction('renderProtectedDisplay'),
    'module.exports = { TRADE_PROTECTED_OPTIONS, TRADE_MANAGEMENT_PROTECTED_MAP, getSmartProtectedValue, renderProtectedDisplay };',
  ].join('\n\n');

  const context = { module: { exports: {} } };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'main.js (extracted protected options)' });
  return context.module.exports;
}

test('Protected values are still exactly Yes/No', () => {
  const { TRADE_PROTECTED_OPTIONS } = loadProtectedModule();

  // Array.from() rebuilds the array using this realm's Array constructor:
  // the extracted value was built inside a separate vm context, so a plain
  // deepEqual would otherwise fail on cross-realm prototype identity even
  // though the contents are identical.
  assert.deepEqual(Array.from(TRADE_PROTECTED_OPTIONS), ['Yes', 'No']);
});

test('getSmartProtectedValue maps every Trade Management option to the requested Protected value', () => {
  const { getSmartProtectedValue } = loadProtectedModule();

  const expected = {
    'Trail Stop': 'Yes',
    'Break Even': 'Yes', // "Moved to Breakeven" in the request, existing option name kept
    'Partial Profit': 'Yes',
    'Scale Out': 'Yes',
    'Hit Take Profit': 'Yes',
    'Set & Forget': 'No',
    'Hit Stop Loss': 'No',
    'Early Exit': 'No',
    'Add to Position': 'No',
    'Reverse Position': 'No',
    'Other': 'No',
  };

  for (const [tradeManagement, protectedValue] of Object.entries(expected)) {
    assert.equal(getSmartProtectedValue(tradeManagement), protectedValue, `${tradeManagement} should map to Protected = ${protectedValue}.`);
  }
});

test('getSmartProtectedValue defaults to No for blank/None or any unrecognized value', () => {
  const { getSmartProtectedValue } = loadProtectedModule();

  assert.equal(getSmartProtectedValue(''), 'No');
  assert.equal(getSmartProtectedValue(undefined), 'No');
  assert.equal(getSmartProtectedValue(null), 'No');
  assert.equal(getSmartProtectedValue('Some Unlisted Value'), 'No');
});

test('Scale Out is a real, selectable Trade Management option', () => {
  assertIncludes(source, "'Scale Out',", 'Scale Out should be added to TRADE_MANAGEMENT_OPTIONS.');
});

test('renderProtectedDisplay renders a read-only input (not a select) so Protected can no longer be set independently', () => {
  const { renderProtectedDisplay } = loadProtectedModule();

  const markupTrailStop = renderProtectedDisplay({ tradeManagement: 'Trail Stop' });
  assertIncludes(markupTrailStop, 'name="protected"', 'Protected must still submit as "protected" so saving is unaffected.');
  assertIncludes(markupTrailStop, 'readonly', 'Protected must be read-only, not an editable dropdown.');
  assertIncludes(markupTrailStop, 'value="Yes"', 'Trail Stop should calculate Protected = Yes.');
  assert.equal(markupTrailStop.includes('<select'), false, 'Protected should no longer render as a <select>.');

  const markupSetForget = renderProtectedDisplay({ tradeManagement: 'Set & Forget' });
  assertIncludes(markupSetForget, 'value="No"', 'Set & Forget should calculate Protected = No.');

  // A trade with no Trade Management chosen at all (blank/undefined) must
  // still calculate a value (No), never render blank or throw.
  const markupNoManagement = renderProtectedDisplay({});
  assertIncludes(markupNoManagement, 'value="No"', 'No Trade Management chosen should calculate Protected = No.');
});

test('Protected is calculated from the trade\'s current Trade Management, not from any independently-saved protected value', () => {
  const { renderProtectedDisplay } = loadProtectedModule();

  // Even if a trade has an old, independently-set `protected` value from
  // before Smart Protected existed, the read-only display must show the
  // value calculated from Trade Management — this is what "read-only
  // because it's automatically calculated" means. The stale stored value is
  // only ever overwritten once the trade is actually saved (see
  // buildTradeEditUpdate, unchanged), not merely by opening the edit form.
  const markup = renderProtectedDisplay({ tradeManagement: 'Trail Stop', protected: 'No' });
  assertIncludes(markup, 'value="Yes"', 'Protected should reflect Trade Management (Yes for Trail Stop), ignoring a stale saved protected value.');
});

test('Protected is wired into both edit forms via renderProtectedDisplay, and still saves through the existing Supabase whitelist', () => {
  assertIncludes(source, "${field('Protected', renderProtectedDisplay(trade))}", 'The edit form should render the read-only Protected value alongside Trade Management/Grade.');
  assert.ok(
    source.includes("protected: String(formData.get('protected')).trim(),"),
    'Saving an edited trade should still read the Protected field like the other journal fields — unchanged, since the input keeps the same name="protected".',
  );

  const mainWhitelistMatch = source.match(/const JOURNAL_ANNOTATION_FIELDS = \[[^\]]*\];/);
  assert.ok(mainWhitelistMatch, 'JOURNAL_ANNOTATION_FIELDS should exist in main.js.');
  assert.ok(
    mainWhitelistMatch[0].includes("'protected'"),
    "protected must be in the Supabase annotation whitelist (main.js), or edits will be silently stripped before syncing.",
  );
});

test('Trade Management changes update the Protected input immediately, scoped to that trade card only', () => {
  assertIncludes(
    source,
    'tradeCardElement.querySelectorAll(\'select[name="tradeManagement"]\').forEach((select) => {',
    'A change listener on the Trade Management select should exist, scoped per trade card (so multi-card editing is unaffected).',
  );
  assertIncludes(
    source,
    'protectedInput.value = getSmartProtectedValue(select.value);',
    'Changing Trade Management should immediately recalculate the Protected input\'s value using the same shared mapping function used at render time.',
  );
});

test('Protected displays on the trade card journal panel', () => {
  assert.ok(
    source.includes("tradeMetric('Protected', trade.protected)"),
    'The trade card Journal panel should display the Protected value.',
  );
});

// --- Protected % dashboard metric -----------------------------------------
// Unaffected by Smart Protected: this reads trade.protected as saved,
// regardless of how that value was produced.

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

test('Protected % renders on the dashboard top KPI row, fourth, after Net P/L / Trades / Win Rate', () => {
  assert.ok(
    source.includes("statCard('chart', 'Protected %', formatPercent(stats.protectedPercent))"),
    'Protected % should render using the shared formatPercent() helper (one decimal place, em dash when null).',
  );
});
