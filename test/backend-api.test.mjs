import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CTRADER_ENDPOINTS,
  BackendUnavailableError,
  buildBackendUrl,
  fetchBackendJson,
  getBackendDeploymentHint,
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

test('backend base URL can be configured for static production hosting', () => {
  const configuredRuntime = runtime({
    JEREMY_TRADING_JOURNAL_BACKEND_URL: 'https://journal-backend.example.com/',
  });

  assert.equal(getConfiguredBackendBaseUrl(configuredRuntime), 'https://journal-backend.example.com');
  assert.equal(
    buildBackendUrl(CTRADER_ENDPOINTS.journalPreview, configuredRuntime),
    'https://journal-backend.example.com/api/ctrader/journal-preview',
  );
});

test('GitHub Pages without a backend URL reports deployment architecture instead of fetching HTML', () => {
  const pagesRuntime = runtime({ location: { hostname: 'jeramaya7.github.io' } });

  assert.match(getBackendDeploymentHint(pagesRuntime), /GitHub Pages site only hosts the static journal/);
  assert.equal(buildBackendUrl(CTRADER_ENDPOINTS.status, pagesRuntime), CTRADER_ENDPOINTS.status);
});

test('fetchBackendJson stops GitHub Pages calls before JSON parsing', async () => {
  const pagesRuntime = runtime({ location: { hostname: 'jeramaya7.github.io' } });

  await assert.rejects(
    fetchBackendJson(CTRADER_ENDPOINTS.status, {
      runtime: pagesRuntime,
      fetchImpl: async () => assert.fail('fetch should not be called when deployment is known to be missing a backend'),
    }),
    (error) => error instanceof BackendUnavailableError
      && error.message.includes('Node backend deployed separately'),
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
