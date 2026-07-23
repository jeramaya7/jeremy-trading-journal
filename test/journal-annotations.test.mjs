import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createAppServer } from '../src/server.js';

const validEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
};

// A minimal in-memory stand-in for Supabase's PostgREST API, just enough to
// exercise the GET/PUT annotation routes: a single table keyed by trade_id.
function createFakeSupabase() {
  const rows = new Map(); // trade_id -> data object
  const calls = [];

  async function fetchImpl(url, requestInit = {}) {
    const parsedUrl = new URL(url);
    calls.push({ method: requestInit.method || 'GET', pathname: parsedUrl.pathname, search: parsedUrl.search });

    if (requestInit.method === 'POST') {
      const body = JSON.parse(requestInit.body);
      for (const record of body) {
        rows.set(record.trade_id, record.data);
      }
      return jsonResponse(200, body.map((record) => ({ trade_id: record.trade_id, data: record.data })));
    }

    // GET
    const tradeIdFilter = parsedUrl.searchParams.get('trade_id');
    if (tradeIdFilter) {
      const tradeId = tradeIdFilter.replace(/^eq\./, '');
      const data = rows.get(tradeId);
      return jsonResponse(200, data ? [{ trade_id: tradeId, data }] : []);
    }

    return jsonResponse(200, Array.from(rows.entries()).map(([trade_id, data]) => ({ trade_id, data })));
  }

  function jsonResponse(status, body) {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  }

  return { fetchImpl, rows, calls };
}

async function withServer(fn, { fetchImpl, env } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'journal-annotations-test-'));
  const server = createAppServer({ dataDir, env: env || validEnv, fetchImpl });

  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const { port } = server.address();
    await fn({ port });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
}

test('GET /api/journal/annotations returns an empty object when Supabase has no rows', async () => {
  const { fetchImpl } = createFakeSupabase();
  await withServer(async ({ port }) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/journal/annotations`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {});
  }, { fetchImpl });
});

test('PUT /api/journal/annotations/:tradeId saves the first annotation for a trade', async () => {
  const { fetchImpl, rows } = createFakeSupabase();
  await withServer(async ({ port }) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/journal/annotations/trade-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setup: 'ORB', state: 'A+', notes: 'Clean breakout' }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { tradeId: 'trade-1', setup: 'ORB', state: 'A+', notes: 'Clean breakout' });
    assert.deepEqual(rows.get('trade-1'), { setup: 'ORB', state: 'A+', notes: 'Clean breakout' });
  }, { fetchImpl });
});

test('PUT /api/journal/annotations/:tradeId partially updates an existing trade, preserving other fields', async () => {
  const { fetchImpl } = createFakeSupabase();
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
  }, { fetchImpl });
});

test('GET /api/journal/annotations returns multiple trades keyed by trade id', async () => {
  const { fetchImpl } = createFakeSupabase();
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
  }, { fetchImpl });
});

test('PUT /api/journal/annotations/:tradeId strips fields outside the allowed list', async () => {
  const { fetchImpl } = createFakeSupabase();
  await withServer(async ({ port }) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/journal/annotations/trade-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        setup: 'ORB',
        notes: 'Kept field',
        accountBalance: 100000,
        isAdmin: true,
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { tradeId: 'trade-1', setup: 'ORB', notes: 'Kept field' });
    assert.equal(body.accountBalance, undefined);
    assert.equal(body.isAdmin, undefined);
  }, { fetchImpl });
});

test('PUT /api/journal/annotations/:tradeId saves and syncs Initial Take Profit (takeProfit) and Final Take Profit (adjustedTakeProfit)', async () => {
  // Regression test: takeProfit (Initial Take Profit) was previously missing
  // from JOURNAL_ANNOTATION_FIELDS, so edits to it were silently stripped
  // before reaching Supabase and never appeared on a second device, even
  // though adjustedTakeProfit (Final Take Profit) synced fine. Both fields
  // must now round-trip through PUT and GET.
  const { fetchImpl } = createFakeSupabase();
  await withServer(async ({ port }) => {
    const putResponse = await fetch(`http://127.0.0.1:${port}/api/journal/annotations/trade-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ takeProfit: 1.205, adjustedTakeProfit: 1.21 }),
    });
    const putBody = await putResponse.json();

    assert.equal(putResponse.status, 200);
    assert.deepEqual(putBody, { tradeId: 'trade-1', takeProfit: 1.205, adjustedTakeProfit: 1.21 });

    const getResponse = await fetch(`http://127.0.0.1:${port}/api/journal/annotations`);
    const getBody = await getResponse.json();

    assert.deepEqual(getBody, { 'trade-1': { takeProfit: 1.205, adjustedTakeProfit: 1.21 } });
  }, { fetchImpl });
});

test('PUT /api/journal/annotations/:tradeId saves and syncs Initial Stop Loss (stopLoss) alongside Final Stop Loss (adjustedStopLoss)', async () => {
  // Regression test: stopLoss (Initial Stop Loss) had the same gap as
  // takeProfit above — missing from JOURNAL_ANNOTATION_FIELDS, so it never
  // reached Supabase and never appeared on a second device. Fixed the same
  // way: stopLoss now round-trips through PUT and GET like adjustedStopLoss.
  const { fetchImpl } = createFakeSupabase();
  await withServer(async ({ port }) => {
    const putResponse = await fetch(`http://127.0.0.1:${port}/api/journal/annotations/trade-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stopLoss: 1.095, adjustedStopLoss: 1.1 }),
    });
    const putBody = await putResponse.json();

    assert.equal(putResponse.status, 200);
    assert.deepEqual(putBody, { tradeId: 'trade-1', stopLoss: 1.095, adjustedStopLoss: 1.1 });

    const getResponse = await fetch(`http://127.0.0.1:${port}/api/journal/annotations`);
    const getBody = await getResponse.json();

    assert.deepEqual(getBody, { 'trade-1': { stopLoss: 1.095, adjustedStopLoss: 1.1 } });
  }, { fetchImpl });
});

test('PUT /api/journal/annotations/:tradeId saves and syncs Outcome Override', async () => {
  // outcomeOverride must be in JOURNAL_ANNOTATION_FIELDS or a Win/Breakeven/
  // Loss override would be silently stripped before reaching Supabase and
  // never appear on a second device.
  const { fetchImpl } = createFakeSupabase();
  await withServer(async ({ port }) => {
    const putResponse = await fetch(`http://127.0.0.1:${port}/api/journal/annotations/trade-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcomeOverride: 'Breakeven' }),
    });
    const putBody = await putResponse.json();

    assert.equal(putResponse.status, 200);
    assert.deepEqual(putBody, { tradeId: 'trade-1', outcomeOverride: 'Breakeven' });

    const getResponse = await fetch(`http://127.0.0.1:${port}/api/journal/annotations`);
    const getBody = await getResponse.json();

    assert.deepEqual(getBody, { 'trade-1': { outcomeOverride: 'Breakeven' } });
  }, { fetchImpl });
});

test('PUT /api/journal/annotations/:tradeId saves and syncs Timeframe like the other journal fields', async () => {
  // New field: timeframe must round-trip through PUT and GET exactly like
  // setup/state/position, so it saves, reloads, and syncs across devices.
  const { fetchImpl } = createFakeSupabase();
  await withServer(async ({ port }) => {
    const putResponse = await fetch(`http://127.0.0.1:${port}/api/journal/annotations/trade-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeframe: '5m' }),
    });
    const putBody = await putResponse.json();

    assert.equal(putResponse.status, 200);
    assert.deepEqual(putBody, { tradeId: 'trade-1', timeframe: '5m' });

    const getResponse = await fetch(`http://127.0.0.1:${port}/api/journal/annotations`);
    const getBody = await getResponse.json();

    assert.deepEqual(getBody, { 'trade-1': { timeframe: '5m' } });
  }, { fetchImpl });
});

test('PUT /api/journal/annotations/:tradeId saves and syncs Protected like the other journal fields', async () => {
  // New field: protected (Yes/No) must round-trip through PUT and GET
  // exactly like setup/state/position/timeframe, so it saves, reloads, and
  // syncs across devices.
  const { fetchImpl } = createFakeSupabase();
  await withServer(async ({ port }) => {
    const putResponse = await fetch(`http://127.0.0.1:${port}/api/journal/annotations/trade-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ protected: 'Yes' }),
    });
    const putBody = await putResponse.json();

    assert.equal(putResponse.status, 200);
    assert.deepEqual(putBody, { tradeId: 'trade-1', protected: 'Yes' });

    const getResponse = await fetch(`http://127.0.0.1:${port}/api/journal/annotations`);
    const getBody = await getResponse.json();

    assert.deepEqual(getBody, { 'trade-1': { protected: 'Yes' } });
  }, { fetchImpl });
});

test('PUT /api/journal/annotations/:tradeId returns 400 for malformed JSON and does not crash the server', async () => {
  const { fetchImpl } = createFakeSupabase();
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
  }, { fetchImpl });
});

test('PUT /api/journal/annotations/:tradeId returns 400 when the payload is not a JSON object', async () => {
  const { fetchImpl } = createFakeSupabase();
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
  }, { fetchImpl });
});

test('annotations persist across a fresh server instance backed by the same fake Supabase store', async () => {
  const { fetchImpl } = createFakeSupabase();
  const dataDir = await mkdtemp(join(tmpdir(), 'journal-annotations-persist-test-'));

  try {
    const firstServer = createAppServer({ dataDir, env: validEnv, fetchImpl });
    await new Promise((resolve) => firstServer.listen(0, resolve));
    const firstPort = firstServer.address().port;

    await fetch(`http://127.0.0.1:${firstPort}/api/journal/annotations/trade-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setup: 'ORB', position: 'Full size' }),
    });
    await new Promise((resolve) => firstServer.close(resolve));

    const secondServer = createAppServer({ dataDir, env: validEnv, fetchImpl });
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

test('a Supabase read failure returns 502 instead of crashing the server', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 500,
    statusText: 'Internal Server Error',
    json: async () => ({ message: 'boom' }),
    text: async () => 'boom',
  });

  await withServer(async ({ port }) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/journal/annotations`);
    assert.equal(response.status, 502);

    // Server should still be responsive after the failure.
    const followUp = await fetch(`http://127.0.0.1:${port}/api/journal/annotations`);
    assert.equal(followUp.status, 502);
  }, { fetchImpl });
});

test('missing Supabase configuration returns 500 with the missing variable names', async () => {
  const { fetchImpl } = createFakeSupabase();
  await withServer(async ({ port }) => {
    const getResponse = await fetch(`http://127.0.0.1:${port}/api/journal/annotations`);
    const getBody = await getResponse.json();
    assert.equal(getResponse.status, 500);
    assert.deepEqual(getBody.missing, ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);

    const putResponse = await fetch(`http://127.0.0.1:${port}/api/journal/annotations/trade-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setup: 'ORB' }),
    });
    assert.equal(putResponse.status, 500);
  }, { fetchImpl, env: {} });
});

test('OPTIONS preflight for the annotations endpoint allows PUT', async () => {
  const { fetchImpl } = createFakeSupabase();
  await withServer(async ({ port }) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/journal/annotations/trade-1`, {
      method: 'OPTIONS',
    });

    assert.equal(response.status, 204);
    assert.match(response.headers.get('access-control-allow-methods') || '', /PUT/);
  }, { fetchImpl });
});
