import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

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

function loadTradeManagementRenderer() {
  const code = [
    extractConst('TRADE_MANAGEMENT_OPTIONS'),
    extractConst('LEGACY_TRADE_MANAGEMENT_MAP'),
    extractConst('GRADE_OPTIONS'),
    extractFunction('escapeHtml'),
    extractFunction('renderSelectOption'),
    extractFunction('normalizeTradeManagement'),
    extractFunction('renderTradeManagementSelect'),
    extractFunction('renderGradeSelect'),
    'module.exports = { TRADE_MANAGEMENT_OPTIONS, GRADE_OPTIONS, renderTradeManagementSelect, renderGradeSelect };',
  ].join('\n\n');
  const context = { module: { exports: {} } };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'main.js (extracted Trade Management)' });
  return context.module.exports;
}

test('new manual trades use the three requested defaults without extra UI actions', () => {
  assert.ok(source.includes("import { DEFAULT_GRADE, DEFAULT_TRADE_MANAGEMENT,"));
  assert.ok(source.includes("const DEFAULT_SETUP = 'Retrace / Bounce';"));
  assert.ok(source.includes("renderPlayBookSetupSelect({ setup: DEFAULT_SETUP })"));
  assert.ok(source.includes('tradeManagement: DEFAULT_TRADE_MANAGEMENT,'));
  assert.ok(source.includes('grade: DEFAULT_GRADE,'));
});

test('Trade Management and Grade options remain unchanged', () => {
  const { TRADE_MANAGEMENT_OPTIONS, GRADE_OPTIONS } = loadTradeManagementRenderer();
  assert.deepEqual(Array.from(TRADE_MANAGEMENT_OPTIONS), [
    'Set & Let',
    'Trail Stop',
    'Break Even',
    'Stop Loss',
    'Manual Exit',
    'Other',
  ]);
  assert.deepEqual(Array.from(GRADE_OPTIONS), ['A+', 'A', 'B', 'C', 'D', 'F']);
});

test('editing existing trades preserves their saved Trade Management and Grade display', () => {
  const { renderTradeManagementSelect, renderGradeSelect } = loadTradeManagementRenderer();
  const blankHistoricalMarkup = renderTradeManagementSelect({ tradeManagement: '' });
  const savedMarkup = renderTradeManagementSelect({ tradeManagement: 'Manual Exit' });
  const blankHistoricalGradeMarkup = renderGradeSelect({ grade: '' });
  const savedGradeMarkup = renderGradeSelect({ grade: 'B' });

  assert.match(blankHistoricalMarkup, /<option value="">None<\/option>/);
  assert.equal(blankHistoricalMarkup.includes('value="Trail Stop" selected'), false, 'A blank historical value must stay blank in Edit.');
  assert.match(savedMarkup, /<option value="Manual Exit" selected>Manual Exit<\/option>/);
  assert.match(blankHistoricalGradeMarkup, /<option value="">Not Graded<\/option>/);
  assert.equal(blankHistoricalGradeMarkup.includes('value="A" selected'), false, 'A blank historical Grade must stay blank in Edit.');
  assert.match(savedGradeMarkup, /<option value="B" selected>B<\/option>/);
  assert.ok(source.includes("${field('Setup', renderPlayBookSetupSelect(trade))}"), 'Existing trades should render their saved Setup value.');
});
