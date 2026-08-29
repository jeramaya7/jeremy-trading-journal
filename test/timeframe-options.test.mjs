import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Guards the new Timeframe dropdown (src/main.js). Extracts the real
// TRADE_TIMEFRAME_OPTIONS array and renderTimeframeSelect/renderSelectOption
// functions from the shipped source (rather than reimplementing them) so the
// test exercises the actual code the app renders and saves from.

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

function loadTimeframeModule() {
  const code = [
    extractConst('TRADE_TIMEFRAME_OPTIONS'),
    extractFunction('escapeHtml'),
    extractFunction('renderSelectOption'),
    extractFunction('renderTimeframeSelect'),
    'module.exports = { TRADE_TIMEFRAME_OPTIONS, renderTimeframeSelect };',
  ].join('\n\n');

  const context = { module: { exports: {} } };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'main.js (extracted timeframe options)' });
  return context.module.exports;
}

test('the Timeframe dropdown list is exactly the 8 requested options, in order', () => {
  const { TRADE_TIMEFRAME_OPTIONS } = loadTimeframeModule();

  // Array.from() rebuilds the array using this realm's Array constructor:
  // the extracted value was built inside a separate vm context, so a plain
  // deepEqual would otherwise fail on cross-realm prototype identity even
  // though the contents are identical.
  assert.deepEqual(Array.from(TRADE_TIMEFRAME_OPTIONS), [
    '1m',
    '2m',
    '5m',
    '15m',
    '30m',
    '1H',
    '4H',
    'Daily',
  ]);
});

test('a chosen Timeframe renders as the selected option and every other option is still present', () => {
  const { renderTimeframeSelect } = loadTimeframeModule();

  const markup = renderTimeframeSelect({ timeframe: '5m' });

  assert.match(markup, /<option value="5m" selected>5m<\/option>/);
  for (const other of ['1m', '2m', '15m', '30m', '1H', '4H', 'Daily']) {
    assert.match(markup, new RegExp(`<option value="${other}">${other}</option>`));
  }
});

test('a trade with no Timeframe chosen defaults to the blank "None" option, never 2m or any other assumed value', () => {
  const { renderTimeframeSelect } = loadTimeframeModule();

  // Existing trades (saved before this field existed) have no `timeframe`
  // property at all — this must render as the blank default, not silently
  // assume 2m or any other option.
  const markupMissingField = renderTimeframeSelect({});
  assert.match(markupMissingField, /<option value="">None<\/option>/);
  assert.equal(markupMissingField.includes('selected>2m<'), false);

  const markupBlankField = renderTimeframeSelect({ timeframe: '' });
  assert.match(markupBlankField, /<option value="">None<\/option>/);
});

test('every Timeframe option round-trips through the select without corruption', () => {
  const { TRADE_TIMEFRAME_OPTIONS, renderTimeframeSelect } = loadTimeframeModule();

  for (const option of TRADE_TIMEFRAME_OPTIONS) {
    const markup = renderTimeframeSelect({ timeframe: option });
    assert.match(markup, new RegExp(`<option value="${option}" selected>${option}</option>`));
  }
});

test('Timeframe is wired into the edit form and the Supabase annotation sync whitelist', () => {
  assert.ok(
    source.includes("${field('Timeframe', renderTimeframeSelect(trade))}"),
    'The edit form should render the Timeframe dropdown alongside Setup/Position/State.',
  );
  assert.ok(
    source.includes("timeframe: String(formData.get('timeframe')).trim(),"),
    'Saving an edited trade should read the Timeframe field like the other journal fields.',
  );

  const mainWhitelistMatch = source.match(/const JOURNAL_ANNOTATION_FIELDS = \[[^\]]*\];/);
  assert.ok(mainWhitelistMatch, 'JOURNAL_ANNOTATION_FIELDS should exist in main.js.');
  assert.ok(
    mainWhitelistMatch[0].includes("'timeframe'"),
    'timeframe must be in the Supabase annotation whitelist (main.js), or edits will be silently stripped before syncing.',
  );
});

function getManualTradeFormBody() {
  const manualFormStart = source.indexOf('function renderManualTradeForm(today)');
  const manualFormEnd = source.indexOf('\nasync function openShareDashboardView', manualFormStart + 1);
  assert.notEqual(manualFormStart, -1, 'renderManualTradeForm should exist.');
  return source.slice(manualFormStart, manualFormEnd === -1 ? undefined : manualFormEnd);
}

test('the live "Add manual trade" screen itself renders a Timeframe dropdown, pre-selected to 1m, before Save is ever clicked', () => {
  // This is the actual UI creation path (the form the user looks at while
  // typing in a new trade) — not just submitTrade()'s save-time object.
  // Regression: an earlier fix only set timeframe: '1m' inside submitTrade's
  // saved object; this form had no Timeframe field at all, so nothing was
  // ever visibly "1m" until after Save, via a separate Edit/Quick Edit form.
  const manualFormBody = getManualTradeFormBody();
  assertIncludes(manualFormBody, "${field('Timeframe', renderTimeframeSelect({ timeframe: '1m' }))}", 'The Add Trade form should render the shared Timeframe dropdown, defaulted to 1m.');

  // Execute the real renderManualTradeForm() and confirm the rendered
  // <select> actually shows 1m as the selected option, not just present in
  // the source as a call — this is what "1m immediately before saving"
  // requires.
  const code = [
    extractConst('TRADE_TIMEFRAME_OPTIONS'),
    extractConst('MARKET_STATE_OPTIONS'),
    extractConst('DEFAULT_MARKET_STATE'),
    extractConst('LEGACY_MARKET_STATE_MAP'),
    extractConst('LEGACY_SETUP_NAME_MAP'),
    extractConst('PLAY_BOOK_SETUP_OPTIONS'),
    extractConst('DEFAULT_SETUP'),
    extractConst('CUSTOM_SETUP_OPTION'),
    extractConst('TRADE_TYPE_OPTIONS'),
    extractConst('DEFAULT_TRADE_TYPE'),
    extractFunction('escapeHtml'),
    extractFunction('renderSelectOption'),
    extractFunction('normalizeMarketState'),
    extractFunction('renderMarketStateSelect'),
    extractFunction('renderSetupOption'),
    extractFunction('normalizeSetupName'),
    extractFunction('isPlayBookSetup'),
    extractFunction('renderPlayBookSetupSelect'),
    extractFunction('renderTimeframeSelect'),
    extractFunction('renderTradeTypeSelect'),
    extractFunction('icon'),
    "function field(label, control) { return `<label class=\"field\"><span>${label}</span>${control}</label>`; }",
    extractFunction('renderManualTradeForm'),
    'module.exports = { renderManualTradeForm };',
  ].join('\n\n');
  const context = { module: { exports: {} } };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'main.js (extracted manual trade form)' });
  const formMarkup = context.module.exports.renderManualTradeForm('2026-01-01');

  assert.match(formMarkup, /<option value="1m" selected>1m<\/option>/, 'The rendered Add Trade form must show 1m already selected in the Timeframe dropdown.');
  assert.equal(formMarkup.includes('<option value="" selected>'), false, 'The blank "None" option must not be the one selected on a brand-new trade.');
  assert.match(formMarkup, /<option value="Retrace \/ Bounce" selected>Retrace \/ Bounce<\/option>/, 'The rendered Add Trade form must show Retrace / Bounce selected in the Setup dropdown.');
});

test('submitTrade saves whatever the Add Trade form\'s own Timeframe dropdown is set to (not a value disconnected from the visible UI)', () => {
  // Fixes the actual bug: the object saved by submitTrade() must come from
  // the same form field the user sees and can change, not a hardcoded
  // literal that happens to also say '1m' but is wired to nothing.
  const submitTradeStart = source.indexOf('async function submitTrade(event)');
  const submitTradeEnd = source.indexOf('\nasync function ', submitTradeStart + 1);
  assert.notEqual(submitTradeStart, -1, 'submitTrade should exist.');
  const submitTradeBody = source.slice(submitTradeStart, submitTradeEnd === -1 ? undefined : submitTradeEnd);

  assertIncludes(submitTradeBody, "timeframe: String(formData.get('timeframe') || '1m').trim(),", "submitTrade should read timeframe from the form's own Timeframe field (falling back to 1m only if it were somehow blank), not a disconnected hardcoded value.");
});

test('existing trades are not affected by the new-trade Timeframe default', () => {
  // normalizeTradeSetups / loadTrades (the localStorage load path) must not
  // touch timeframe at all — only submitTrade (brand-new trades) sets it.
  assert.equal(source.includes("trade.timeframe = trade.timeframe || '1m'"), false, 'Existing trades must not be retroactively defaulted to 1m on load.');
});
