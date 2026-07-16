import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// This file actually executes the setup-name migration logic from
// src/main.js (rather than just grepping the source) because the thing
// being guarded against is data loss / mislabeling: an existing trade's
// `setup` field silently keeping (or losing) the wrong value after the
// Play Book list changed. Only running the real functions against real
// trade objects can prove that.
//
// The functions under test are pure (no window/document/localStorage), so
// they're extracted from the live source file and evaluated in isolation,
// exercising the actual shipped code rather than a reimplementation of it.

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

// Extracts `const NAME = { ... };` or `const NAME = [ ... ];`, matching
// braces/brackets by depth rather than searching for a closing delimiter
// text pattern, so it can't accidentally grab content belonging to some
// unrelated later declaration in the file.
function extractConst(name) {
  const marker = `const ${name} = `;
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Expected to find const ${name} in src/main.js`);
  const openIndex = markerIndex + marker.length;
  const openChar = source[openIndex];
  if (openChar !== '{' && openChar !== '[') {
    // Simple literal (string/number) — just take through the semicolon.
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
  // Include the trailing semicolon.
  const semicolonIndex = source.indexOf(';', cursor);
  return source.slice(markerIndex, semicolonIndex + 1);
}

function loadSetupModule() {
  const code = [
    extractConst('LEGACY_SETUP_NAME_MAP'),
    extractConst('PLAY_BOOK_SETUP_OPTIONS'),
    extractConst('CUSTOM_SETUP_OPTION'),
    extractFunction('normalizeSetupName'),
    extractFunction('hasLegacySetupName'),
    extractFunction('normalizeTradeSetups'),
    extractFunction('isPlayBookSetup'),
    extractFunction('getSetupFormValue'),
    'module.exports = { LEGACY_SETUP_NAME_MAP, PLAY_BOOK_SETUP_OPTIONS, CUSTOM_SETUP_OPTION, normalizeSetupName, hasLegacySetupName, normalizeTradeSetups, isPlayBookSetup, getSetupFormValue };',
  ].join('\n\n');

  const context = { module: { exports: {} } };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'main.js (extracted setup migration)' });
  return context.module.exports;
}

test('the Play Book setup list is exactly the 13 requested options, Custom last', () => {
  const { PLAY_BOOK_SETUP_OPTIONS, CUSTOM_SETUP_OPTION } = loadSetupModule();

  // Array.from() rebuilds the array using this realm's Array constructor:
  // the extracted value was built inside a separate vm context, so a plain
  // deepEqual would otherwise fail on cross-realm prototype identity even
  // though the contents are identical.
  assert.deepEqual(Array.from(PLAY_BOOK_SETUP_OPTIONS), [
    'EMA Bounce',
    'EMA Continuation',
    'EMA Cross',
    'Enter Retrace',
    'Event Bar',
    'General Forecast',
    'Hedge',
    'RBI / GBI',
    'Scalping',
    'Support/Resistance',
    'Trendline Break',
    'Wide State Reversal',
  ]);
  assert.equal(CUSTOM_SETUP_OPTION, 'Custom', 'Custom is appended after the fixed list, so it always renders last.');
  assert.equal(PLAY_BOOK_SETUP_OPTIONS.includes('None'), false, 'None is not a Play Book option.');
  assert.equal(PLAY_BOOK_SETUP_OPTIONS.includes('Custom'), false, 'Custom lives outside the fixed list, appended separately.');
});

test('RBI / GBI is a real, selectable Play Book setup, added between Hedge and Scalping', () => {
  const { PLAY_BOOK_SETUP_OPTIONS, isPlayBookSetup } = loadSetupModule();

  assert.equal(isPlayBookSetup('RBI / GBI'), true, 'RBI / GBI should be recognized as a fixed Play Book option.');
  const hedgeIndex = PLAY_BOOK_SETUP_OPTIONS.indexOf('Hedge');
  const rbiIndex = PLAY_BOOK_SETUP_OPTIONS.indexOf('RBI / GBI');
  const scalpingIndex = PLAY_BOOK_SETUP_OPTIONS.indexOf('Scalping');
  assert.ok(hedgeIndex < rbiIndex && rbiIndex < scalpingIndex, 'RBI / GBI should sit alphabetically between Hedge and Scalping.');
});

test('every specified legacy setup name migrates to its new canonical name', () => {
  const { normalizeSetupName } = loadSetupModule();

  const expectedMigrations = {
    'Elephant Bar': 'Event Bar',
    'Buy the Retrace': 'Enter Retrace',
    'MATX': 'EMA Cross',
    'MAX': 'EMA Cross',
    'Return to 200': 'Wide State Reversal',
    'Trend Line Break': 'Trendline Break',
    'Trade Line Break': 'Trendline Break',
    'Support & Resistance': 'Support/Resistance',
    'The General Forecast': 'General Forecast',
  };

  for (const [oldName, newName] of Object.entries(expectedMigrations)) {
    assert.equal(normalizeSetupName(oldName), newName, `${oldName} should migrate to ${newName}.`);
  }
});

test('setups retired with no replacement (including Scalp) are left exactly as-is', () => {
  // Product decision: ORB, Ride the whale, Set & Forget, TB Retrace, and
  // Scalp have no direct replacement in the new list, so existing trades
  // keep their original text untouched and fall back to the Custom setup
  // input when edited (same as any value that was never on the list).
  const { normalizeSetupName, isPlayBookSetup } = loadSetupModule();

  for (const retiredName of ['ORB', 'Ride the 🐋', 'Set & Forget', 'TB Retrace', 'Scalp']) {
    assert.equal(normalizeSetupName(retiredName), retiredName, `${retiredName} should not be renamed.`);
    assert.equal(isPlayBookSetup(retiredName), false, `${retiredName} is no longer a fixed Play Book option (opens as Custom).`);
  }
});

test('normalizeSetupName leaves already-current and unrelated setup names untouched', () => {
  const { normalizeSetupName } = loadSetupModule();

  for (const currentName of ['EMA Bounce', 'EMA Continuation', 'Hedge', 'RBI / GBI', 'Wide State Reversal', 'Custom', '', 'Opening range breakout']) {
    assert.equal(normalizeSetupName(currentName), currentName);
  }
});

test('normalizeTradeSetups migrates legacy setup names across a full trade list without losing any other data', () => {
  const { normalizeTradeSetups, hasLegacySetupName } = loadSetupModule();

  const trades = [
    { id: 'a', setup: 'Elephant Bar', entry: 100, exit: 105, notes: 'kept' },
    { id: 'b', setup: 'MATX', entry: 50, exit: 48 },
    { id: 'c', setup: 'Scalp', entry: 10, exit: 11 },
    { id: 'd', setup: 'Wide State Reversal', entry: 1, exit: 2 },
  ];

  assert.equal(hasLegacySetupName(trades), true, 'A trade list containing Elephant Bar/MATX should be flagged for migration.');

  const migrated = normalizeTradeSetups(trades);
  assert.deepEqual(migrated.map((t) => t.setup), ['Event Bar', 'EMA Cross', 'Scalp', 'Wide State Reversal']);

  // Every other field on every trade must be untouched — no data loss.
  assert.equal(migrated[0].id, 'a');
  assert.equal(migrated[0].entry, 100);
  assert.equal(migrated[0].exit, 105);
  assert.equal(migrated[0].notes, 'kept');
  assert.equal(migrated[1].entry, 50);
  assert.equal(migrated[2].entry, 10);
  assert.equal(migrated[3].entry, 1);

  assert.equal(hasLegacySetupName(migrated), false, 'After migration, no trade should still be flagged as legacy.');
});

function makeFormData(fields) {
  return { get: (key) => (Object.prototype.hasOwnProperty.call(fields, key) ? fields[key] : null) };
}

test('regression: saving a trade with no setup chosen falls back to Uncategorized setup, never the first Play Book option', () => {
  // Root cause of the earlier bug: removing the None placeholder option
  // left nothing selected for a blank-setup trade, so the browser would
  // default the closed <select> to its first real option (EMA Bounce),
  // and saving without touching the dropdown would silently tag the trade
  // EMA Bounce instead of leaving it uncategorized.
  const { getSetupFormValue } = loadSetupModule();

  // setupChoice: '' is exactly what the hidden, unlabeled placeholder
  // option submits when nothing else has been chosen.
  assert.equal(getSetupFormValue(makeFormData({ setupChoice: '', setupCustom: '', setup: '' })), 'Uncategorized setup');
  assert.notEqual(getSetupFormValue(makeFormData({ setupChoice: '', setupCustom: '', setup: '' })), 'EMA Bounce');

  // A real, deliberate selection still saves normally.
  assert.equal(getSetupFormValue(makeFormData({ setupChoice: 'EMA Bounce', setupCustom: '', setup: '' })), 'EMA Bounce');
  assert.equal(getSetupFormValue(makeFormData({ setupChoice: 'Wide State Reversal', setupCustom: '', setup: '' })), 'Wide State Reversal');
  assert.equal(getSetupFormValue(makeFormData({ setupChoice: 'RBI / GBI', setupCustom: '', setup: '' })), 'RBI / GBI');

  // Custom behavior is unchanged.
  assert.equal(getSetupFormValue(makeFormData({ setupChoice: 'Custom', setupCustom: 'My own setup', setup: '' })), 'My own setup');
});

test('the blank setup placeholder option is hidden and disabled, and never labeled None', () => {
  const renderPlayBookSetupSelectSource = extractFunction('renderPlayBookSetupSelect');

  assert.ok(
    /<option value=""\$\{currentSetup === '' \? ' selected' : ''\} hidden disabled><\/option>/.test(renderPlayBookSetupSelectSource),
    'The blank placeholder option should be hidden and disabled, with no visible label.',
  );
  assert.equal(renderPlayBookSetupSelectSource.includes('>None<'), false, 'The word "None" must not appear anywhere in the Setup dropdown markup.');

  const { PLAY_BOOK_SETUP_OPTIONS } = loadSetupModule();
  assert.equal(PLAY_BOOK_SETUP_OPTIONS.includes('None'), false, 'None must never become a real, selectable Play Book/analytics setup value.');
});

test('the edit form no longer offers a free-text Setup Description / custom setup input — legacy setup names are preserved as their own option instead', () => {
  const renderPlayBookSetupSelectSource = extractFunction('renderPlayBookSetupSelect');

  assert.equal(renderPlayBookSetupSelectSource.includes('setupCustom'), false, 'The Setup dropdown should no longer render a free-text custom setup input.');
  assert.equal(renderPlayBookSetupSelectSource.includes('data-custom-setup'), false, 'The custom setup input hook should be fully removed.');
  assert.ok(renderPlayBookSetupSelectSource.includes('legacySetupOption'), 'A trade already saved with a non-Play-Book setup name should still render as its own selectable option, so its value is never silently lost or overwritten on save.');
});
