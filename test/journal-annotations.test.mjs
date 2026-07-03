import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createAppServer } from '../src/server.js';

async function withServer(fn) {
  const dataDir = await mkdtemp(join(tmpdir(), 'journal-annotations-test-'));
  const journalAnnotationsStorePath = join(dataDir, 'journal-annotations.json');
  const server = createAppServer({ dataDir, journalAnnotationsStorePath });

  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const { port } = server.address();
    await fn({ port, dataDir, journalAnnotationsStorePath });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
}

test('GET /api/journal/annotations returns an empty object when no store file exists', async () => {
  await withServer(async ({ port }) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/journal/annotations`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {});
  });
});

test('PUT /api/journal/annotations/:tradeId saves the first annotation for a trade', async () => {
  await withServer(async ({ port, journalAnnotationsStorePath }) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/journal/annotations/trade-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setup: 'ORB', state: 'A+', notes: 'Clean breakout' }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { tradeId: 'trade-1', setup: 'ORB', state: 'A+', notes: 'Clean breakout' });

    const stored = JSON.parse(await readFile(journalAnnotationsStorePath, 'utf8'));
    assert.deepEqual(stored, {
      'trade-1': { setup: 'ORB', state: 'A+', notes: 'Clean breakout' },
    });
  });
});

test('PUT /api/journal/annotations/:tradeId partially updates an existing trade, preserving other fields', async () => {
  await withServer(async ({ port }) => {
    await fetch(`http://127.0.0.1:${port}/api/journal/annotations/trade-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setup: 'ORB', state: 'A+', tags: ['london-open'] }),
    });

    const response = await fetch(`http://127.0.0.1:${port}/api/journal/annotations/trade-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'Updated after review' }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      tradeId: 'trade-1',
      setup: 'ORB',
      state: 'A+',
      tags: ['london-open'],
      notes: 'Updated after review',
    });
  });
});

test('GET /api/journal/annotations returns multiple trades keyed by trade id', async () => {
  await withServer(async ({ port }) => {
    await fetch(`http://127.0.0.1:${port}/api/journal/annotations/trade-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setup: 'ORB' }),
    });
    await fetch(`http://127.0.0.1:${port}/api/journal/annotations/trade-2`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setup: 'Reversal', lossReason: 'Chased entry' }),
    });

    const response = await fetch(`http://127.0.0.1:${port}/api/journal/annotations`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      'trade-1': { setup: 'ORB' },
      'trade-2': { setup: 'Reversal', lossReason: 'Chased entry' },
    });
  });
});

test('PUT /api/journal/annotations/:tradeId strips fields outside the allowed list', async () => {
  await withServer(async ({ port }) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/journal/annotations/trade-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        setup: 'ORB',
        notes: 'Kept field',
        __proto__: 'ignored',
        accountBalance: 100000,
        isAdmin: true,
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { tradeId: 'trade-1', setup: 'ORB', notes: 'Kept field' });
    assert.equal(body.accountBalance, undefined);
    assert.equal(body.isAdmin, undefined);
  });
});

test('PUT /api/journal/annotations/:tradeId returns 400 for malformed JSON and does not crash the server', async () => {
  await withServer(async ({ port }) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/journal/annotations/trade-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{ this is not valid json',
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.match(body.error, /invalid json/i);

    // Server should still be responsive after the malformed request.
    const followUp = await fetch(`http://127.0.0.1:${port}/api/journal/annotations`);
    assert.equal(followUp.status, 200);
  });
});

test('PUT /api/journal/annotations/:tradeId returns 400 when the payload is not a JSON object', async () => {
  await withServer(async ({ port }) => {
    const arrayResponse = await fetch(`http://127.0.0.1:${port}/api/journal/annotations/trade-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(['not', 'an', 'object']),
    });
    assert.equal(arrayResponse.status, 400);

    const stringResponse = await fetch(`http://127.0.0.1:${port}/api/journal/annotations/trade-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify('just a string'),
    });
    assert.equal(stringResponse.status, 400);
  });
});

test('journal annotations persist across a fresh server instance pointed at the same store file', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'journal-annotations-persist-test-'));
  const journalAnnotationsStorePath = join(dataDir, 'journal-annotations.json');

  try {
    const firstServer = createAppServer({ dataDir, journalAnnotationsStorePath });
    await new Promise((resolve) => firstServer.listen(0, resolve));
    const firstPort = firstServer.address().port;

    await fetch(`http://127.0.0.1:${firstPort}/api/journal/annotations/trade-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setup: 'ORB', position: 'Full size' }),
    });
    await new Promise((resolve) => firstServer.close(resolve));

    const secondServer = createAppServer({ dataDir, journalAnnotationsStorePath });
    await new Promise((resolve) => secondServer.listen(0, resolve));
    const secondPort = secondServer.address().port;

    try {
      const response = await fetch(`http://127.0.0.1:${secondPort}/api/journal/annotations`);
      const body = await response.json();

      assert.deepEqual(body, {
        'trade-1': { setup: 'ORB', position: 'Full size' },
      });
    } finally {
      await new Promise((resolve) => secondServer.close(resolve));
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('a corrupt store file on disk resolves to an empty store instead of crashing the server', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'journal-annotations-corrupt-test-'));
  const journalAnnotationsStorePath = join(dataDir, 'journal-annotations.json');
  await writeFile(journalAnnotationsStorePath, '{ not valid json at all', 'utf8');

  const server = createAppServer({ dataDir, journalAnnotationsStorePath });
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/journal/annotations`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {});
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('OPTIONS preflight for the annotations endpoint allows PUT', async () => {
  await withServer(async ({ port }) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/journal/annotations/trade-1`, {
      method: 'OPTIONS',
    });

    assert.equal(response.status, 204);
    assert.match(response.headers.get('access-control-allow-methods') || '', /PUT/);
  });
});
