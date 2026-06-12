import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CTRADER_ENDPOINTS,
  DEFAULT_BACKEND_BASE_URL,
  BackendUnavailableError,
  buildBackendUrl,
  fetchBackendJson,
  getBackendDeploymentHint,
  getBackendDiagnostics,
  getConfiguredBackendBaseUrl,
} from '../src/backend-api.js';

function runtime(overrides = {}) {
  return {
    location: { hostname: 'localhost' },
    localStorage: { getItem: () => null },
    ...overrides,
  };
}

test('cTrader production endpoint registry covers status, sync, raw deals, and OAuth routes', () => {
  assert.deepEqual(CTRADER_ENDPOINTS, {
    status: '/api/ctrader/status',
    journalPreview: '/api/ctrader/journal-preview',
    deals: '/api/ctrader/deals',
    authStart: '/auth/ctrader/start',
    authCallback: '/auth/ctrader/callback',
  });
});

test('backend base URL defaults to the live Render backend and can be overridden', () => {
  assert.equal(getConfiguredBackendBaseUrl(runtime()), DEFAULT_BACKEND_BASE_URL);
  assert.equal(
    buildBackendUrl(CTRADER_ENDPOINTS.journalPreview, runtime()),
    'https://jeremy-trading-journal.onrender.com/api/ctrader/journal-preview',
  );

  const configuredRuntime = runtime({
    JEREMY_TRADING_JOURNAL_BACKEND_URL: 'https://journal-backend.example.com/',
  });

  assert.equal(getConfiguredBackendBaseUrl(configuredRuntime), 'https://journal-backend.example.com');
  assert.equal(
    buildBackendUrl(CTRADER_ENDPOINTS.journalPreview, configuredRuntime),
    'https://journal-backend.example.com/api/ctrader/journal-preview',
  );
});

test('GitHub Pages uses the live Render backend instead of relative HTML fallback paths', () => {
  const pagesRuntime = runtime({ location: { hostname: 'jeramaya7.github.io' } });

  assert.equal(getBackendDeploymentHint(pagesRuntime), '');
  assert.equal(
    buildBackendUrl(CTRADER_ENDPOINTS.status, pagesRuntime),
    'https://jeremy-trading-journal.onrender.com/api/ctrader/status',
  );
});

test('backend diagnostics expose the configured backend URL and status endpoint', () => {
  const diagnostics = getBackendDiagnostics(runtime({
    location: { hostname: 'jeramaya7.github.io', origin: 'https://jeramaya7.github.io', href: 'https://jeramaya7.github.io/jeremy-trading-journal/' },
    JEREMY_TRADING_JOURNAL_BACKEND_URL: 'https://journal-backend.example.com/',
  }));

  assert.equal(diagnostics.configured, true);
  assert.equal(diagnostics.backendUrl, 'https://journal-backend.example.com');
  assert.equal(diagnostics.statusUrl, 'https://journal-backend.example.com/api/ctrader/status');
  assert.equal(diagnostics.connectionStatus, 'Not checked');
});

test('fetchBackendJson calls the Render backend from GitHub Pages by default', async () => {
  const pagesRuntime = runtime({ location: { hostname: 'jeramaya7.github.io' } });

  const result = await fetchBackendJson(CTRADER_ENDPOINTS.status, {
    runtime: pagesRuntime,
    fetchImpl: async (url) => {
      assert.equal(url, 'https://jeremy-trading-journal.onrender.com/api/ctrader/status');
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        async json() {
          return { connected: false };
        },
      };
    },
  });

  assert.deepEqual(result.body, { connected: false });
});

test('fetchBackendJson reports the exact Render backend URL on request failures', async () => {
  await assert.rejects(
    fetchBackendJson(CTRADER_ENDPOINTS.status, {
      runtime: runtime({ location: { hostname: 'jeramaya7.github.io', origin: 'https://jeramaya7.github.io', href: 'https://jeramaya7.github.io/jeremy-trading-journal/' } }),
      fetchImpl: async () => { throw new Error('network down'); },
    }),
    (error) => error instanceof BackendUnavailableError
      && error.url === 'https://jeremy-trading-journal.onrender.com/api/ctrader/status'
      && error.message.includes('https://jeremy-trading-journal.onrender.com/api/ctrader/status'),
  );
});

test('fetchBackendJson rejects HTML responses with a friendly backend message', async () => {
  await assert.rejects(
    fetchBackendJson(CTRADER_ENDPOINTS.journalPreview, {
      runtime: runtime(),
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => 'text/html; charset=utf-8' },
        async json() {
          throw new Error('Unexpected token <');
        },
      }),
    }),
    (error) => error instanceof BackendUnavailableError
      && error.message.includes('did not return JSON')
      && !error.message.includes('Unexpected token'),
  );
});

test('fetchBackendJson returns parsed JSON for available backend endpoints', async () => {
  const result = await fetchBackendJson(CTRADER_ENDPOINTS.status, {
    runtime: runtime({ JEREMY_TRADING_JOURNAL_BACKEND_URL: 'https://backend.example.com' }),
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://backend.example.com/api/ctrader/status');
      assert.equal(options.headers.Accept, 'application/json');
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json; charset=utf-8' },
        async json() {
          return { connected: true };
        },
      };
    },
  });

  assert.deepEqual(result.body, { connected: true });
  assert.equal(result.response.ok, true);
});
