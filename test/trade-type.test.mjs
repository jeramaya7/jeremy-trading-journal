import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const serverSource = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');

function extractConst(name) {
  const marker = `const ${name} = `;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Expected to find const ${name}.`);
  return source.slice(start, source.indexOf(';', start) + 1);
}

function extractFunction(name) {
  const marker = `\nfunction ${name}(`;
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Expected to find function ${name}.`);
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

function loadTradeTypeModule() {
  const code = [
    extractConst('TRADE_TYPE_OPTIONS'),
    extractConst('DEFAULT_TRADE_TYPE'),
    extractFunction('escapeHtml'),
    extractFunction('renderSelectOption'),
    extractFunction('renderTradeTypeSelect'),
    'module.exports = { TRADE_TYPE_OPTIONS, DEFAULT_TRADE_TYPE, renderTradeTypeSelect };',
  ].join('\n\n');
  const context = { module: { exports: {} } };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'main.js (extracted trade type)' });
  return context.module.exports;
}

test('Trade Type has exactly Individual then Positioning', () => {
  const { TRADE_TYPE_OPTIONS, DEFAULT_TRADE_TYPE } = loadTradeTypeModule();
  assert.deepEqual(Array.from(TRADE_TYPE_OPTIONS), ['Individual', 'Positioning']);
  assert.equal(DEFAULT_TRADE_TYPE, 'Individual');
});

test('Individual is selected by default and Positioning remains selectable', () => {
  const { renderTradeTypeSelect } = loadTradeTypeModule();
  const historicalTrade = {};
  const defaultMarkup = renderTradeTypeSelect(historicalTrade);
  const positioningMarkup = renderTradeTypeSelect({ tradeType: 'Positioning' });

  assert.match(defaultMarkup, /<option value="Individual" selected>Individual<\/option>/);
  assert.match(defaultMarkup, /<option value="Positioning">Positioning<\/option>/);
  assert.match(positioningMarkup, /<option value="Positioning" selected>Positioning<\/option>/);
  assert.deepEqual(historicalTrade, {}, 'Rendering the default must not modify historical trade data.');
});

test('Trade Type is available and saved in Add Trade, Full Edit, and Quick Edit', () => {
  assert.ok(source.includes("${field('Trade Type', renderTradeTypeSelect({ tradeType: DEFAULT_TRADE_TYPE }))}"));
  assert.ok(source.includes("${field('Trade Type', renderTradeTypeSelect(trade))}"));
  assert.equal(source.match(/tradeType: String\(formData\.get\('tradeType'\) \|\| DEFAULT_TRADE_TYPE\)\.trim\(\),/g)?.length, 2);
});

test('Trade Type uses the existing annotation sync without affecting analytics', () => {
  for (const text of [source, serverSource]) {
    const fields = text.match(/const JOURNAL_ANNOTATION_FIELDS = \[[^\]]*\];/);
    assert.ok(fields?.[0].includes("'tradeType'"), 'Trade Type should be preserved by annotation sync.');
  }
  assert.equal(source.includes('tradeTypePercent'), false);
  assert.equal(source.includes('tradeTypeAnalytics'), false);
});
