import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Guards the "Delete All Screenshots" feature (src/main.js): a button that
// clears every trade's `screenshot` field to reclaim browser storage space,
// without touching trades, Notes, Grade, Protected, Trade Management,
// Setup, State, Tags, or any other journal data — and without touching
// Auto Sync or Supabase sync (screenshot is never in the sync whitelist).

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

test('Delete All Screenshots button exists in the data actions row, with the requested label', () => {
  assertIncludes(source, 'id="deleteAllScreenshots"', 'A Delete All Screenshots button should be rendered.');
  assertIncludes(source, 'Delete All Screenshots', 'The button should use the requested label.');
  assertIncludes(
    source,
    "document.querySelector('#deleteAllScreenshots').addEventListener('click', deleteAllScreenshots, { signal });",
    'The button should be wired to the deleteAllScreenshots handler.',
  );
});

test('deleteAllScreenshots asks for confirmation with the exact requested copy, and bails out if declined', () => {
  const fn = extractFunction('deleteAllScreenshots');
  assertIncludes(fn, "window.confirm('Delete all screenshots? This cannot be undone.')", 'The confirmation dialog must use the exact requested text.');

  const context = {
    window: { confirm: () => false, alert: () => { throw new Error('alert should not be called when the user declines'); } },
    trades: [{ id: 'a', screenshot: { dataUrl: 'data:image/png;base64,xxx' } }],
    persistTrades: () => { throw new Error('persistTrades should not be called when the user declines'); },
  };
  vm.createContext(context);
  vm.runInContext(`${fn}\ndeleteAllScreenshots();`, context);
  // No assertion needed beyond "did not throw" — the stubs above throw if
  // the function proceeds past the declined confirmation.
});

test('deleteAllScreenshots clears only the screenshot field, leaves every other field and every trade intact, and reports an accurate count', () => {
  const fn = extractFunction('deleteAllScreenshots');

  let persistedTrades = null;
  let alertMessage = null;
  const context = {
    window: { confirm: () => true, alert: (message) => { alertMessage = message; } },
    trades: [
      { id: 'a', screenshot: { dataUrl: 'data:image/png;base64,aaa', name: 'a.png' }, notes: 'kept a', grade: 'A', protected: 'Yes', tradeManagement: 'Trailed', setup: 'Hedge', state: 'Trending', tags: 'gold' },
      { id: 'b', screenshot: null, notes: 'kept b' },
      { id: 'c', screenshot: { dataUrl: 'data:image/png;base64,ccc' }, notes: 'kept c', grade: 'B' },
      { id: 'd', notes: 'kept d' }, // no screenshot field at all
    ],
    persistTrades: (nextTrades) => { persistedTrades = nextTrades; },
  };
  vm.createContext(context);
  vm.runInContext(`${fn}\ndeleteAllScreenshots();`, context);

  assert.ok(persistedTrades, 'persistTrades should be called so the change is saved and the UI re-rendered.');
  assert.equal(persistedTrades.length, 4, 'No trade should be added or removed.');

  const byId = Object.fromEntries(persistedTrades.map((t) => [t.id, t]));
  assert.equal(byId.a.screenshot, null, 'Trade a\'s screenshot should be cleared.');
  assert.equal(byId.c.screenshot, null, 'Trade c\'s screenshot should be cleared.');
  assert.equal(byId.b.screenshot, null, 'Trade b (already no screenshot) stays null.');
  assert.equal(byId.d.screenshot, undefined, 'Trade d (no screenshot field) is not given a new field.');

  // Every non-screenshot field must be untouched.
  assert.equal(byId.a.notes, 'kept a');
  assert.equal(byId.a.grade, 'A');
  assert.equal(byId.a.protected, 'Yes');
  assert.equal(byId.a.tradeManagement, 'Trailed');
  assert.equal(byId.a.setup, 'Hedge');
  assert.equal(byId.a.state, 'Trending');
  assert.equal(byId.a.tags, 'gold');
  assert.equal(byId.b.notes, 'kept b');
  assert.equal(byId.c.notes, 'kept c');
  assert.equal(byId.c.grade, 'B');
  assert.equal(byId.d.notes, 'kept d');

  assert.equal(alertMessage, 'Deleted 2 screenshots.', 'The count shown should match the number of trades that actually had a screenshot (a and c, not b or d).');
});

test('deleteAllScreenshots reports singular "screenshot" when exactly one is deleted', () => {
  const fn = extractFunction('deleteAllScreenshots');

  let alertMessage = null;
  const context = {
    window: { confirm: () => true, alert: (message) => { alertMessage = message; } },
    trades: [{ id: 'a', screenshot: { dataUrl: 'data:image/png;base64,aaa' } }],
    persistTrades: () => {},
  };
  vm.createContext(context);
  vm.runInContext(`${fn}\ndeleteAllScreenshots();`, context);

  assert.equal(alertMessage, 'Deleted 1 screenshot.');
});

test('deleteAllScreenshots does not touch Auto Sync or the Supabase annotation whitelist', () => {
  const fn = extractFunction('deleteAllScreenshots');
  assert.equal(/autoSync|AutoSync/i.test(fn), false, 'deleteAllScreenshots should not reference Auto Sync at all.');

  const mainWhitelistMatch = source.match(/const JOURNAL_ANNOTATION_FIELDS = \[[^\]]*\];/);
  assert.ok(mainWhitelistMatch, 'JOURNAL_ANNOTATION_FIELDS should exist in main.js.');
  assert.equal(
    mainWhitelistMatch[0].includes("'screenshot'"),
    false,
    'screenshot must stay out of the Supabase annotation whitelist — it is never synced, so clearing it locally requires no Supabase change.',
  );
});
