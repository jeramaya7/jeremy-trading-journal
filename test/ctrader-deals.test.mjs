import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildCtraderAccountsRequest,
  buildCtraderDealsRequest,
  createAppServer,
  decryptTokenPayload,
  encryptTokenPayload,
  storeEncryptedTokens,
} from '../src/server.js';
import {
  mapCtraderClosingDealToJournalTrade,
  mapCtraderDealsToJournalTrades,
} from '../src/ctrader-journal-mapper.js';

const validEnv = {
  CTRADER_CLIENT_ID: 'client-id',
  CTRADER_CLIENT_SECRET: 'client-secret',
  CTRADER_REDIRECT_URI: 'http://localhost:5173/auth/ctrader/callback',
  CTRADER_ENVIRONMENT: 'demo',
  CTRADER_TOKEN_ENCRYPTION_KEY: 'encryption-secret',
};

test('encrypted cTrader token payloads can be decrypted for Open API use', () => {
  const encrypted = encryptTokenPayload({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    tokenType: 'Bearer',
  }, validEnv.CTRADER_TOKEN_ENCRYPTION_KEY);

  assert.deepEqual(decryptTokenPayload(encrypted, validEnv.CTRADER_TOKEN_ENCRYPTION_KEY), {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    tokenType: 'Bearer',
  });
});

test('builds default recent cTrader deals request query', () => {
  const url = new URL('http://localhost/api/ctrader/deals');
  const request = buildCtraderDealsRequest(url, 1_700_000_000_000);

  assert.deepEqual(request, {
    ctidTraderAccountId: undefined,
    fromTimestamp: 1_697_408_000_000,
    toTimestamp: 1_700_000_000_000,
    maxRows: 100,
  });
});

test('builds cTrader accounts request without deal summaries by default', () => {
  const url = new URL('http://localhost/api/ctrader/accounts?maxRows=1');
  const request = buildCtraderAccountsRequest(url, 1_700_000_000_000);

  assert.deepEqual(request, {
    ctidTraderAccountId: undefined,
    fromTimestamp: 1_697_408_000_000,
    toTimestamp: 1_700_000_000_000,
    maxRows: 1,
    includeDealSummaries: false,
  });
});

test('maps completed cTrader deals into journal preview trade objects', () => {
  const trades = mapCtraderDealsToJournalTrades({
    deal: [
      {
        dealId: 100,
        positionId: 900,
        symbolName: 'EURUSD',
        tradeSide: 'BUY',
        executionPrice: 1.1,
        executionTimestamp: 1_690_000_000_000,
        filledVolume: 100000,
      },
      {
        dealId: 101,
        positionId: 900,
        symbolName: 'EURUSD',
        tradeSide: 'SELL',
        executionPrice: 1.105,
        executionTimestamp: 1_700_000_000_000,
        filledVolume: 100000,
        closePositionDetail: {
          entryPrice: 1.1,
          grossProfit: 500,
          commission: -7.5,
          swap: -1.25,
          pnlConversionFee: -0.25,
        },
      },
      {
        dealId: 102,
        positionId: 901,
        symbol: 'GBPUSD',
        tradeSide: 'BUY',
        executionPrice: 1.25,
        executionTimestamp: 1_701_000_000_000,
        filledVolume: 50000,
        closePositionDetail: {
          entryPrice: 1.255,
          grossProfit: 250,
          commission: -5,
          swap: 0,
        },
      },
    ],
  }, { accountId: 12345 });

  assert.deepEqual(trades, [
    {
      id: 'ctrader-101',
      provider: 'ctrader',
      accountId: 12345,
      sourceDealId: 101,
      sourcePositionId: 900,
      symbol: 'EURUSD',
      direction: 'Long',
      entry: 1.1,
      exit: 1.105,
      size: 100000,
      volume: 100000,
      openTime: '2023-07-22T04:26:40.000Z',
      closeTime: '2023-11-14T22:13:20.000Z',
      date: '2023-11-14',
      netProfitLoss: 491,
      fees: 9,
      setup: 'cTrader import preview',
      emotion: '',
      tags: 'ctrader, import-preview',
      notes: 'Preview only. Not saved to the journal.',
    },
    {
      id: 'ctrader-102',
      provider: 'ctrader',
      accountId: 12345,
      sourceDealId: 102,
      sourcePositionId: 901,
      symbol: 'GBPUSD',
      direction: 'Short',
      entry: 1.255,
      exit: 1.25,
      size: 50000,
      volume: 50000,
      openTime: null,
      closeTime: '2023-11-26T12:00:00.000Z',
      date: '2023-11-26',
      netProfitLoss: 245,
      fees: 5,
      setup: 'cTrader import preview',
      emotion: '',
      tags: 'ctrader, import-preview',
      notes: 'Preview only. Not saved to the journal.',
    },
  ]);
});

test('maps an individual cTrader closing deal into the journal trade schema', () => {
  const trade = mapCtraderClosingDealToJournalTrade({
    dealId: 777,
    positionId: 888,
    symbolId: 1,
    tradeSide: 2,
    executionPrice: '1.0850',
    executionTimestamp: 1_700_100_000_000,
    volume: '25000',
    closePositionDetail: {
      entryTimestamp: 1_700_000_000_000,
      entryPrice: '1.0800',
      realizedNetProfit: '120.5',
      commission: '-3.25',
      swap: '1.00',
      pnlConversionFee: '-0.75',
      closedVolume: '25000',
    },
  }, null, { accountId: 24680 });

  assert.deepEqual(trade, {
    id: 'ctrader-777',
    provider: 'ctrader',
    accountId: 24680,
    sourceDealId: 777,
    sourcePositionId: 888,
    symbol: '1',
    direction: 'Long',
    entry: 1.08,
    exit: 1.085,
    size: 25000,
    volume: 25000,
    openTime: '2023-11-14T22:13:20.000Z',
    closeTime: '2023-11-16T02:00:00.000Z',
    date: '2023-11-16',
    netProfitLoss: 120.5,
    fees: 5,
    setup: 'cTrader import preview',
    emotion: '',
    tags: 'ctrader, import-preview',
    notes: 'Preview only. Not saved to the journal.',
  });
});

test('GET /api/ctrader/deals authorizes account, fetches raw deals, stores raw response, and returns JSON', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ctrader-deals-test-'));
  const rawDealsStorePath = join(dataDir, 'raw-deals.json');
  const calls = [];

  class FakeOpenApiClient {
    constructor(options) {
      calls.push(['constructor', options]);
    }

    async authenticateAndAuthorizeAccount(ctidTraderAccountId, accessToken) {
      calls.push(['authenticateAndAuthorizeAccount', ctidTraderAccountId, accessToken]);
      return {
        authorizedAccountId: ctidTraderAccountId,
        accounts: [{ ctidTraderAccountId, isLive: false }],
      };
    }

    async getDealList(ctidTraderAccountId, request) {
      calls.push(['getDealList', ctidTraderAccountId, request]);
      return {
        ctidTraderAccountId,
        deal: [
          {
            dealId: 10,
            positionId: 20,
            executionTimestamp: 1_700_000_000_000,
            dealStatus: 'FILLED',
          },
        ],
        hasMore: false,
      };
    }

    close() {
      calls.push(['close']);
    }
  }

  const config = {
    ok: true,
    clientId: validEnv.CTRADER_CLIENT_ID,
    clientSecret: validEnv.CTRADER_CLIENT_SECRET,
    redirectUri: validEnv.CTRADER_REDIRECT_URI,
    environment: validEnv.CTRADER_ENVIRONMENT,
    encryptionSecret: validEnv.CTRADER_TOKEN_ENCRYPTION_KEY,
  };
  await storeEncryptedTokens(config, {
    accessToken: 'stored-access-token',
    refreshToken: 'stored-refresh-token',
    tokenType: 'Bearer',
    expiresIn: 3600,
  }, { dataDir });

  const server = createAppServer({
    dataDir,
    rawDealsStorePath,
    env: validEnv,
    OpenApiClient: FakeOpenApiClient,
    now: () => 1_700_000_000_000,
  });

  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/ctrader/deals?accountId=12345&fromTimestamp=1690000000000&toTimestamp=1700000000000&maxRows=25`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.provider, 'ctrader');
    assert.equal(body.accountId, 12345);
    assert.deepEqual(body.request, {
      fromTimestamp: 1_690_000_000_000,
      toTimestamp: 1_700_000_000_000,
      maxRows: 25,
    });
    assert.deepEqual(body.rawDeals.deal, [
      {
        dealId: 10,
        positionId: 20,
        executionTimestamp: 1_700_000_000_000,
        dealStatus: 'FILLED',
      },
    ]);

    assert.deepEqual(calls.map(([name]) => name), [
      'constructor',
      'authenticateAndAuthorizeAccount',
      'getDealList',
      'close',
    ]);
    assert.equal(calls[1][2], 'stored-access-token');
    assert.deepEqual(calls[2], ['getDealList', 12345, {
      fromTimestamp: 1_690_000_000_000,
      toTimestamp: 1_700_000_000_000,
      maxRows: 25,
    }]);

    const stored = JSON.parse(await readFile(rawDealsStorePath, 'utf8'));
    assert.equal(stored.provider, 'ctrader');
    assert.equal(stored.accountId, 12345);
    assert.deepEqual(stored.rawDeals, body.rawDeals);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('GET /api/ctrader/journal-preview returns mapped trades without saving journal entries', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ctrader-preview-test-'));
  const calls = [];

  class FakeOpenApiClient {
    constructor(options) {
      calls.push(['constructor', options]);
    }

    async authenticateAndAuthorizeAccount(ctidTraderAccountId, accessToken) {
      calls.push(['authenticateAndAuthorizeAccount', ctidTraderAccountId, accessToken]);
      return {
        authorizedAccountId: ctidTraderAccountId,
        accounts: [{ ctidTraderAccountId, isLive: false }],
      };
    }

    async getDealList(ctidTraderAccountId, request) {
      calls.push(['getDealList', ctidTraderAccountId, request]);
      return {
        ctidTraderAccountId,
        deal: [
          {
            dealId: 200,
            positionId: 300,
            symbolName: 'USDJPY',
            tradeSide: 'SELL',
            executionPrice: 151.1,
            executionTimestamp: 1_699_000_000_000,
            filledVolume: 1000,
          },
          {
            dealId: 201,
            positionId: 300,
            symbolName: 'USDJPY',
            tradeSide: 'BUY',
            executionPrice: 150.2,
            executionTimestamp: 1_700_000_000_000,
            filledVolume: 1000,
            closePositionDetail: {
              entryPrice: 151.1,
              grossProfit: 90,
              commission: -2,
              swap: -0.5,
            },
          },
        ],
      };
    }

    close() {
      calls.push(['close']);
    }
  }

  const config = {
    ok: true,
    clientId: validEnv.CTRADER_CLIENT_ID,
    clientSecret: validEnv.CTRADER_CLIENT_SECRET,
    redirectUri: validEnv.CTRADER_REDIRECT_URI,
    environment: validEnv.CTRADER_ENVIRONMENT,
    encryptionSecret: validEnv.CTRADER_TOKEN_ENCRYPTION_KEY,
  };
  await storeEncryptedTokens(config, {
    accessToken: 'stored-access-token',
    refreshToken: 'stored-refresh-token',
    tokenType: 'Bearer',
    expiresIn: 3600,
  }, { dataDir });

  const server = createAppServer({
    dataDir,
    env: validEnv,
    OpenApiClient: FakeOpenApiClient,
    now: () => 1_700_000_000_000,
  });

  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/ctrader/journal-preview?accountId=98765&maxRows=10`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.provider, 'ctrader');
    assert.equal(body.accountId, 98765);
    assert.equal(body.tradeCount, 1);
    assert.deepEqual(body.trades, [
      {
        id: 'ctrader-201',
        provider: 'ctrader',
        accountId: 98765,
        sourceDealId: 201,
        sourcePositionId: 300,
        symbol: 'USDJPY',
        direction: 'Short',
        entry: 151.1,
        exit: 150.2,
        size: 1000,
        volume: 1000,
        openTime: '2023-11-03T08:26:40.000Z',
        closeTime: '2023-11-14T22:13:20.000Z',
        date: '2023-11-14',
        netProfitLoss: 87.5,
        fees: 2.5,
        setup: 'cTrader import preview',
        emotion: '',
        tags: 'ctrader, import-preview',
        notes: 'Preview only. Not saved to the journal.',
      },
    ]);
    assert.equal(body.rawDeals, undefined);
    assert.deepEqual(calls.map(([name]) => name), [
      'constructor',
      'authenticateAndAuthorizeAccount',
      'getDealList',
      'close',
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('GET /api/ctrader/accounts loads accounts without routing deal requests by default', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ctrader-accounts-list-test-'));
  const calls = [];

  class FakeOpenApiClient {
    constructor(options) {
      calls.push(['constructor', options]);
    }

    async connect() {
      calls.push(['connect']);
    }

    async authenticateApplication() {
      calls.push(['authenticateApplication']);
    }

    async getAccountList(accessToken) {
      calls.push(['getAccountList', accessToken]);
      return [
        { ctidTraderAccountId: 111, accountNumber: 900111, isLive: false, brokerName: 'Broker A' },
        { ctidTraderAccountId: 222, accountNumber: 900222, isLive: true, brokerName: 'Broker B' },
      ];
    }

    async authorizeAccount() {
      throw new Error('Cannot route request');
    }

    async getDealList() {
      throw new Error('Cannot route request');
    }

    close() {
      calls.push(['close']);
    }
  }

  const config = {
    ok: true,
    clientId: validEnv.CTRADER_CLIENT_ID,
    clientSecret: validEnv.CTRADER_CLIENT_SECRET,
    redirectUri: validEnv.CTRADER_REDIRECT_URI,
    environment: validEnv.CTRADER_ENVIRONMENT,
    encryptionSecret: validEnv.CTRADER_TOKEN_ENCRYPTION_KEY,
  };
  await storeEncryptedTokens(config, {
    accessToken: 'stored-access-token',
    refreshToken: 'stored-refresh-token',
    tokenType: 'Bearer',
    expiresIn: 3600,
  }, { dataDir });

  const server = createAppServer({
    dataDir,
    env: validEnv,
    OpenApiClient: FakeOpenApiClient,
    now: () => 1_700_000_000_000,
  });

  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/ctrader/accounts?maxRows=1`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.accountCount, 2);
    assert.deepEqual(body.accounts.map((account) => ({
      ctidTraderAccountId: account.ctidTraderAccountId,
      accountNumber: account.accountNumber,
      isLive: account.isLive,
      brokerName: account.brokerName,
    })), [
      { ctidTraderAccountId: 111, accountNumber: 900111, isLive: false, brokerName: 'Broker A' },
      { ctidTraderAccountId: 222, accountNumber: 900222, isLive: true, brokerName: 'Broker B' },
    ]);
    assert.equal(body.request.includeDealSummaries, false);
    assert.deepEqual(calls.filter(([name]) => name === 'authorizeAccount'), []);
    assert.deepEqual(calls.filter(([name]) => name === 'getDealList'), []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('GET /api/ctrader/accounts returns authorized accounts with latest deal IDs when requested', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ctrader-accounts-test-'));
  const calls = [];

  class FakeOpenApiClient {
    constructor(options) {
      calls.push(['constructor', options]);
    }

    async connect() {
      calls.push(['connect']);
    }

    async authenticateApplication() {
      calls.push(['authenticateApplication']);
    }

    async getAccountList(accessToken) {
      calls.push(['getAccountList', accessToken]);
      return [
        { ctidTraderAccountId: 111, accountNumber: 900111, isLive: false, brokerName: 'Broker A' },
        { ctidTraderAccountId: 222, accountNumber: 900222, isLive: false, brokerName: 'Broker B' },
      ];
    }

    async authorizeAccount(ctidTraderAccountId, accessToken) {
      calls.push(['authorizeAccount', ctidTraderAccountId, accessToken]);
      return { payload: { ctidTraderAccountId } };
    }

    async getDealList(ctidTraderAccountId, request) {
      calls.push(['getDealList', ctidTraderAccountId, request]);
      return {
        ctidTraderAccountId,
        deal: ctidTraderAccountId === 111
          ? [{ dealId: 10, executionTimestamp: 1_699_000_000_000 }]
          : [
            { dealId: 20, executionTimestamp: 1_699_500_000_000 },
            { dealId: 25, executionTimestamp: 1_700_000_000_000 },
          ],
      };
    }

    close() {
      calls.push(['close']);
    }
  }

  const config = {
    ok: true,
    clientId: validEnv.CTRADER_CLIENT_ID,
    clientSecret: validEnv.CTRADER_CLIENT_SECRET,
    redirectUri: validEnv.CTRADER_REDIRECT_URI,
    environment: validEnv.CTRADER_ENVIRONMENT,
    encryptionSecret: validEnv.CTRADER_TOKEN_ENCRYPTION_KEY,
  };
  await storeEncryptedTokens(config, {
    accessToken: 'stored-access-token',
    refreshToken: 'stored-refresh-token',
    tokenType: 'Bearer',
    expiresIn: 3600,
  }, { dataDir });

  const server = createAppServer({
    dataDir,
    env: validEnv,
    OpenApiClient: FakeOpenApiClient,
    now: () => 1_700_000_000_000,
  });

  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/ctrader/accounts?maxRows=5&includeDealSummaries=true`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.provider, 'ctrader');
    assert.equal(body.environment, 'demo');
    assert.equal(body.accountCount, 2);
    assert.deepEqual(body.accounts.map((account) => ({
      ctidTraderAccountId: account.ctidTraderAccountId,
      accountNumber: account.accountNumber,
      dealCount: account.dealCount,
      latestDealId: account.latestDealId,
    })), [
      { ctidTraderAccountId: 111, accountNumber: 900111, dealCount: 1, latestDealId: 10 },
      { ctidTraderAccountId: 222, accountNumber: 900222, dealCount: 2, latestDealId: 25 },
    ]);
    assert.deepEqual(calls.filter(([name]) => name === 'authorizeAccount').map(([, accountId]) => accountId), [111, 222]);
    assert.deepEqual(calls.filter(([name]) => name === 'getDealList').map(([, accountId]) => accountId), [111, 222]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});


test('GET /api/ctrader/status reports stored cTrader connection state', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ctrader-status-test-'));
  const config = {
    ok: true,
    clientId: validEnv.CTRADER_CLIENT_ID,
    clientSecret: validEnv.CTRADER_CLIENT_SECRET,
    redirectUri: validEnv.CTRADER_REDIRECT_URI,
    environment: validEnv.CTRADER_ENVIRONMENT,
    encryptionSecret: validEnv.CTRADER_TOKEN_ENCRYPTION_KEY,
  };
  await storeEncryptedTokens(config, {
    accessToken: 'stored-access-token',
    refreshToken: 'stored-refresh-token',
    tokenType: 'Bearer',
    expiresIn: 3600,
  }, { dataDir });

  const server = createAppServer({ dataDir, env: validEnv });

  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/ctrader/status`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.provider, 'ctrader');
    assert.equal(body.connected, true);
    assert.equal(body.environment, 'demo');
    assert.equal(body.tokenType, 'Bearer');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('GET /api/ctrader/status reports disconnected when tokens are missing', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ctrader-status-missing-test-'));
  const server = createAppServer({ dataDir, env: validEnv });

  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/ctrader/status`);
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.provider, 'ctrader');
    assert.equal(body.connected, false);
    assert.match(body.error, /tokens have not been stored/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('backend supports cross-origin GitHub Pages API checks', async () => {
  const server = createAppServer({ env: validEnv, corsOrigin: 'https://jeramaya7.github.io' });

  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/ctrader/status`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://jeramaya7.github.io',
        'Access-Control-Request-Method': 'GET',
      },
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://jeramaya7.github.io');
    assert.match(response.headers.get('access-control-allow-methods'), /GET/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
