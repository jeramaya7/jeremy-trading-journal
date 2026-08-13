import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

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

function loadExitReasonModule() {
  const code = [
    extractConst('CLOSE_REASON_OPTIONS'),
    extractConst('LEGACY_TRADE_MANAGEMENT_MAP'),
    extractConst('TRADE_MANAGEMENT_CLOSE_REASON_MAP'),
    extractConst('LEGACY_SMART_CLOSE_REASON_MAP'),
    extractFunction('escapeHtml'),
    extractFunction('renderSelectOption'),
    extractFunction('normalizeTradeManagement'),
    extractFunction('getSmartCloseReasonValue'),
    extractFunction('isSmartCloseReasonValue'),
    extractFunction('renderCloseReasonSelect'),
    'module.exports = { CLOSE_REASON_OPTIONS, getSmartCloseReasonValue, isSmartCloseReasonValue, renderCloseReasonSelect };',
  ].join('\n\n');

  const context = { module: { exports: {} } };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'main.js (extracted exit reason default)' });
  return context.module.exports;
}

test('Trade Management maps to the matching smart Exit Reason default', () => {
  const { getSmartCloseReasonValue } = loadExitReasonModule();

  assert.equal(getSmartCloseReasonValue('Trail Stop'), 'Trail Stop');
  assert.equal(getSmartCloseReasonValue('Stop Loss'), 'Stop Loss');
  assert.equal(getSmartCloseReasonValue('Manual Exit'), 'Manual Exit');
  assert.equal(getSmartCloseReasonValue('Other'), 'Other');
  assert.equal(getSmartCloseReasonValue('Break Even'), '');
  assert.equal(getSmartCloseReasonValue('Set & Let'), '');
  assert.equal(getSmartCloseReasonValue('Set & Forget'), '');
});

test('smart Exit Reason only updates blank, matching, or legacy-auto values', () => {
  const { isSmartCloseReasonValue } = loadExitReasonModule();

  assert.equal(isSmartCloseReasonValue('', 'Trail Stop'), true, 'Blank Exit Reason has not been manually changed.');
  assert.equal(isSmartCloseReasonValue('Trail Stop', 'Trail Stop'), true, 'Matching Exit Reason can follow the next Trade Management change.');
  assert.equal(isSmartCloseReasonValue('Trailed Stop', 'Trail Stop'), true, 'Legacy auto Trail Stop wording can follow the next Trade Management change.');
  assert.equal(isSmartCloseReasonValue('Manual Exit', 'Trail Stop'), false, 'A different saved Exit Reason is treated as manual and must not be overwritten.');
});

test('Exit Reason dropdown preserves legacy saved values without changing analytics data', () => {
  const { CLOSE_REASON_OPTIONS, renderCloseReasonSelect } = loadExitReasonModule();

  assert.deepEqual(Array.from(CLOSE_REASON_OPTIONS), ['Take Profit', 'Stop Loss', 'Trail Stop', 'Manual Exit', 'Other']);

  const markup = renderCloseReasonSelect({ closeReason: 'Trailed Stop' });
  assertIncludes(markup, '<option value="Trailed Stop" selected>Trailed Stop</option>', 'Existing Trailed Stop data should still round-trip through the edit form.');
});

test('Full Edit and Quick Edit share the smart Exit Reason listener', () => {
  assertIncludes(source, "${field('Exit Reason', renderCloseReasonSelect(trade))}", 'Both edit forms render Exit Reason through the shared renderer.');
  assertIncludes(source, "closeReasonSelect.dataset.manuallyChanged !== 'true'", 'The smart default must stop once the user manually changes Exit Reason.');
  assertIncludes(source, 'closeReasonSelect.value = getSmartCloseReasonValue(select.value);', 'Changing Trade Management should update Exit Reason through the shared per-card listener.');
  assertIncludes(source, 'select.addEventListener(\'change\', () => {\n      select.dataset.manuallyChanged = \'true\';', 'Exit Reason changes should be tracked as manual user choices.');
});
