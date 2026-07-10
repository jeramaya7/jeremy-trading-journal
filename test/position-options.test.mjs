import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Guards the Position dropdown list (src/main.js). Extracts the real
// POSITION_TYPE_OPTIONS array and renderPositionTypeSelect/renderSelectOption
// functions from the shipped source (rather than reimplementing them) so the
// test exercises the actual code the app renders and saves from.

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

function loadPositionModule() {
  const code = [
    extractConst('POSITION_TYPE_OPTIONS'),
    extractFunction('escapeHtml'),
    extractFunction('renderSelectOption'),
    extractFunction('renderPositionTypeSelect'),
    'module.exports = { POSITION_TYPE_OPTIONS, renderPositionTypeSelect };',
  ].join('\n\n');

  const context = { module: { exports: {} } };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'main.js (extracted position options)' });
  return context.module.exports;
}

test('the Position dropdown list includes Position 0 alongside the existing Position 1-4 options, unchanged', () => {
  const { POSITION_TYPE_OPTIONS } = loadPositionModule();

  // Array.from() rebuilds the array using this realm's Array constructor:
  // the extracted value was built inside a separate vm context, so a plain
  // deepEqual would otherwise fail on cross-realm prototype identity even
  // though the contents are identical.
  assert.deepEqual(Array.from(POSITION_TYPE_OPTIONS), [
    'Position 0',
    'Position 1',
    'Position 2',
    'Position 3',
    'Position 4',
  ]);
});

test('Position 0 renders as a selectable option and round-trips as the selected value', () => {
  const { renderPositionTypeSelect } = loadPositionModule();

  const markup = renderPositionTypeSelect({ position: 'Position 0' });

  assert.match(markup, /<option value="Position 0" selected>Position 0<\/option>/);
  // Existing options must still be present and unaffected.
  for (const existing of ['Position 1', 'Position 2', 'Position 3', 'Position 4']) {
    assert.match(markup, new RegExp(`<option value="${existing}">${existing}</option>`));
  }
});

test('a trade with no position chosen still falls back to the blank "None" option, not Position 0', () => {
  const { renderPositionTypeSelect } = loadPositionModule();

  const markup = renderPositionTypeSelect({ position: '' });

  assert.match(markup, /<option value="">None<\/option>/);
  assert.equal(markup.includes('<option value="Position 0" selected>'), false);
});
