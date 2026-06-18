import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CTraderOpenApiJsonClient,
  CTRADER_PAYLOAD_TYPES,
  buildOpenApiJsonMessage,
  getCtraderJsonEndpoint,
  parseOpenApiJsonMessage,
} from '../src/ctrader-open-api.js';

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sentMessages = [];
    this.listeners = new Map();
    FakeWebSocket.instances.push(this);
  }

  addEventListener(eventName, handler) {
    const handlers = this.listeners.get(eventName) || [];
    handlers.push(handler);
    this.listeners.set(eventName, handlers);
  }

  removeEventListener(eventName, handler) {
    const handlers = this.listeners.get(eventName) || [];
    this.listeners.set(eventName, handlers.filter((candidate) => candidate !== handler));
  }

  send(message) {
    this.sentMessages.push(JSON.parse(message));
  }

  close() {
    this.readyState = 3;
    this.emit('close', {});
  }

  open() {
    this.readyState = 1;
    this.emit('open', {});
  }

  receive(message) {
    this.emit('message', { data: JSON.stringify(message) });
  }

  emit(eventName, event) {
    for (const handler of this.listeners.get(eventName) || []) {
      handler(event);
    }
  }
}

function createClient(options = {}) {
  FakeWebSocket.instances = [];
  return new CTraderOpenApiJsonClient({
    environment: 'demo',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    accessToken: 'access-token',
    timeoutMs: 200,
    WebSocketImpl: FakeWebSocket,
    ...options,
  });
}

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('selects the documented cTrader JSON WebSocket endpoint for demo and live', () => {
  assert.equal(getCtraderJsonEndpoint('demo'), 'wss://demo.ctraderapi.com:5036');
  assert.equal(getCtraderJsonEndpoint('live'), 'wss://live.ctraderapi.com:5036');
  assert.throws(() => getCtraderJsonEndpoint('paper'), /demo or live/);
});

test('builds cTrader Open API JSON messages with clientMsgId, payloadType, and payload', () => {
  assert.deepEqual(buildOpenApiJsonMessage(2100, { clientId: 'abc' }, 'message-id'), {
    clientMsgId: 'message-id',
    payloadType: 2100,
    payload: { clientId: 'abc' },
  });
});

test('connects to cTrader JSON WebSocket endpoint', async () => {
  const client = createClient();
  const connected = client.connect();
  const socket = FakeWebSocket.instances[0];

  assert.equal(socket.url, 'wss://demo.ctraderapi.com:5036');
  socket.open();
  await connected;
});

test('authenticates the cTrader app over JSON WebSocket', async () => {
  const client = createClient();
  const authPromise = client.authenticateApplication();
  const socket = FakeWebSocket.instances[0];
  socket.open();
  await flushMicrotasks();

  const sentMessage = socket.sentMessages[0];
  assert.equal(sentMessage.payloadType, CTRADER_PAYLOAD_TYPES.PROTO_OA_APPLICATION_AUTH_REQ);
  assert.deepEqual(sentMessage.payload, { clientId: 'client-id', clientSecret: 'client-secret' });

  socket.receive({
    clientMsgId: sentMessage.clientMsgId,
    payloadType: CTRADER_PAYLOAD_TYPES.PROTO_OA_APPLICATION_AUTH_RES,
    payload: {},
  });

  const response = await authPromise;
  assert.equal(response.payloadType, CTRADER_PAYLOAD_TYPES.PROTO_OA_APPLICATION_AUTH_RES);
});

test('gets granted cTrader account list with access token', async () => {
  const client = createClient();
  const accountsPromise = client.getAccountList();
  const socket = FakeWebSocket.instances[0];
  socket.open();
  await flushMicrotasks();

  const sentMessage = socket.sentMessages[0];
  assert.equal(sentMessage.payloadType, CTRADER_PAYLOAD_TYPES.PROTO_OA_GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ);
  assert.deepEqual(sentMessage.payload, { accessToken: 'access-token' });

  socket.receive({
    clientMsgId: sentMessage.clientMsgId,
    payloadType: CTRADER_PAYLOAD_TYPES.PROTO_OA_GET_ACCOUNTS_BY_ACCESS_TOKEN_RES,
    payload: {
      ctidTraderAccount: [{ ctidTraderAccountId: 12345, isLive: false }],
    },
  });

  assert.deepEqual(await accountsPromise, [{ ctidTraderAccountId: 12345, isLive: false }]);
});

test('authorizes a cTrader account with account ID and access token', async () => {
  const client = createClient();
  const accountAuthPromise = client.authorizeAccount(12345);
  const socket = FakeWebSocket.instances[0];
  socket.open();
  await flushMicrotasks();

  const sentMessage = socket.sentMessages[0];
  assert.equal(sentMessage.payloadType, CTRADER_PAYLOAD_TYPES.PROTO_OA_ACCOUNT_AUTH_REQ);
  assert.deepEqual(sentMessage.payload, { ctidTraderAccountId: 12345, accessToken: 'access-token' });

  socket.receive({
    clientMsgId: sentMessage.clientMsgId,
    payloadType: CTRADER_PAYLOAD_TYPES.PROTO_OA_ACCOUNT_AUTH_RES,
    payload: { ctidTraderAccountId: 12345 },
  });

  const response = await accountAuthPromise;
  assert.equal(response.payload.ctidTraderAccountId, 12345);
});

test('runs app auth, account list, and account authorization in sequence', async () => {
  const client = createClient();
  const sequencePromise = client.authenticateAndAuthorizeAccount();
  const socket = FakeWebSocket.instances[0];
  socket.open();
  await flushMicrotasks();

  const appAuth = socket.sentMessages[0];
  socket.receive({ clientMsgId: appAuth.clientMsgId, payloadType: CTRADER_PAYLOAD_TYPES.PROTO_OA_APPLICATION_AUTH_RES, payload: {} });
  await flushMicrotasks();

  const accountList = socket.sentMessages[1];
  socket.receive({
    clientMsgId: accountList.clientMsgId,
    payloadType: CTRADER_PAYLOAD_TYPES.PROTO_OA_GET_ACCOUNTS_BY_ACCESS_TOKEN_RES,
    payload: { ctidTraderAccount: [{ ctidTraderAccountId: 67890 }] },
  });
  await flushMicrotasks();

  const accountAuth = socket.sentMessages[2];
  assert.equal(accountAuth.payload.ctidTraderAccountId, 67890);
  socket.receive({
    clientMsgId: accountAuth.clientMsgId,
    payloadType: CTRADER_PAYLOAD_TYPES.PROTO_OA_ACCOUNT_AUTH_RES,
    payload: { ctidTraderAccountId: 67890 },
  });

  const result = await sequencePromise;
  assert.equal(result.authorizedAccountId, 67890);
  assert.deepEqual(result.accounts, [{ ctidTraderAccountId: 67890 }]);
});

test('fetches cTrader trader account details with balance', async () => {
  const client = createClient();
  const traderPromise = client.getTrader(12345);
  const socket = FakeWebSocket.instances[0];
  socket.open();
  await flushMicrotasks();

  const sentMessage = socket.sentMessages[0];
  assert.equal(sentMessage.payloadType, CTRADER_PAYLOAD_TYPES.PROTO_OA_TRADER_REQ);
  assert.deepEqual(sentMessage.payload, { ctidTraderAccountId: 12345 });

  socket.receive({
    clientMsgId: sentMessage.clientMsgId,
    payloadType: CTRADER_PAYLOAD_TYPES.PROTO_OA_TRADER_RES,
    payload: { trader: { ctidTraderAccountId: 12345, balance: 2500000, moneyDigits: 2 } },
  });

  assert.deepEqual(await traderPromise, { ctidTraderAccountId: 12345, balance: 2500000, moneyDigits: 2 });
});

test('fetches cTrader symbol metadata by symbol ID', async () => {
  const client = createClient();
  const symbolPromise = client.getSymbolById(12345, 392);
  const socket = FakeWebSocket.instances[0];
  socket.open();
  await flushMicrotasks();

  const sentMessage = socket.sentMessages[0];
  assert.equal(sentMessage.payloadType, CTRADER_PAYLOAD_TYPES.PROTO_OA_SYMBOL_BY_ID_REQ);
  assert.deepEqual(sentMessage.payload, {
    ctidTraderAccountId: 12345,
    symbolId: [392],
  });

  socket.receive({
    clientMsgId: sentMessage.clientMsgId,
    payloadType: CTRADER_PAYLOAD_TYPES.PROTO_OA_SYMBOL_BY_ID_RES,
    payload: {
      symbol: [{ symbolId: 392, lotSize: 10000000, stepVolume: 1000, minVolume: 1000 }],
    },
  });

  assert.deepEqual(await symbolPromise, { symbolId: 392, lotSize: 10000000, stepVolume: 1000, minVolume: 1000 });
});

test('fetches cTrader symbol metadata when JSON payload returns a symbol object', async () => {
  const client = createClient();
  const symbolPromise = client.getSymbolById(12345, 41);
  const socket = FakeWebSocket.instances[0];
  socket.open();
  await flushMicrotasks();

  const sentMessage = socket.sentMessages[0];
  socket.receive({
    clientMsgId: sentMessage.clientMsgId,
    payloadType: CTRADER_PAYLOAD_TYPES.PROTO_OA_SYMBOL_BY_ID_RES,
    payload: {
      symbol: { symbolId: 41, symbolName: 'XAUUSD', lotSize: 10000 },
    },
  });

  assert.deepEqual(await symbolPromise, { symbolId: 41, symbolName: 'XAUUSD', lotSize: 10000 });
});

test('fetches archived cTrader symbol metadata when JSON payload returns an archived symbol object', async () => {
  const client = createClient();
  const symbolPromise = client.getSymbolById(12345, 10026);
  const socket = FakeWebSocket.instances[0];
  socket.open();
  await flushMicrotasks();

  const sentMessage = socket.sentMessages[0];
  socket.receive({
    clientMsgId: sentMessage.clientMsgId,
    payloadType: CTRADER_PAYLOAD_TYPES.PROTO_OA_SYMBOL_BY_ID_RES,
    payload: {
      archivedSymbol: { symbolId: 10026, symbolName: 'BTCUSD', lotSize: 100 },
    },
  });

  assert.deepEqual(await symbolPromise, { symbolId: 10026, symbolName: 'BTCUSD', lotSize: 100 });
});

test('fetches historical cTrader deals for an authorized account', async () => {
  const client = createClient();
  const dealsPromise = client.getDealList(12345, {
    fromTimestamp: 1_690_000_000_000,
    toTimestamp: 1_700_000_000_000,
    maxRows: 25,
  });
  const socket = FakeWebSocket.instances[0];
  socket.open();
  await flushMicrotasks();

  const sentMessage = socket.sentMessages[0];
  assert.equal(sentMessage.payloadType, CTRADER_PAYLOAD_TYPES.PROTO_OA_DEAL_LIST_REQ);
  assert.deepEqual(sentMessage.payload, {
    ctidTraderAccountId: 12345,
    fromTimestamp: 1_690_000_000_000,
    toTimestamp: 1_700_000_000_000,
    maxRows: 25,
  });

  socket.receive({
    clientMsgId: sentMessage.clientMsgId,
    payloadType: CTRADER_PAYLOAD_TYPES.PROTO_OA_DEAL_LIST_RES,
    payload: {
      ctidTraderAccountId: 12345,
      deal: [{ dealId: 1, dealStatus: 'FILLED' }],
      hasMore: false,
    },
  });

  assert.deepEqual(await dealsPromise, {
    ctidTraderAccountId: 12345,
    deal: [{ dealId: 1, dealStatus: 'FILLED' }],
    hasMore: false,
  });
});

test('rejects cTrader API error responses', async () => {
  const client = createClient();
  const authPromise = client.authenticateApplication();
  const socket = FakeWebSocket.instances[0];
  socket.open();
  await flushMicrotasks();

  const sentMessage = socket.sentMessages[0];
  socket.receive({
    clientMsgId: sentMessage.clientMsgId,
    payloadType: CTRADER_PAYLOAD_TYPES.PROTO_OA_ERROR_RES,
    payload: { errorCode: 'INVALID_REQUEST', description: 'Bad request' },
  });

  await assert.rejects(authPromise, /Bad request/);
});

test('parses cTrader Open API JSON message strings', () => {
  assert.deepEqual(parseOpenApiJsonMessage('{"clientMsgId":"1","payloadType":2101,"payload":{}}'), {
    clientMsgId: '1',
    payloadType: 2101,
    payload: {},
  });
  assert.throws(() => parseOpenApiJsonMessage('{"payload":{}}'), /Invalid/);
});

test('authenticateAndAuthorizeAccount defaults to first live account when no account is requested', async () => {
  const calls = [];
  const client = new CTraderOpenApiJsonClient({
    environment: 'demo',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    accessToken: 'access-token',
    WebSocketImpl: class {},
  });

  client.connect = async () => calls.push(['connect']);
  client.authenticateApplication = async () => calls.push(['authenticateApplication']);
  client.getAccountList = async () => {
    calls.push(['getAccountList']);
    return [
      { ctidTraderAccountId: 45954881, accountNumber: 5188953, isLive: false },
      { ctidTraderAccountId: 1318619, accountNumber: 1318619, isLive: true },
      { ctidTraderAccountId: 1334186, accountNumber: 1334186, isLive: true },
    ];
  };
  client.authorizeAccount = async (accountId, accessToken) => {
    calls.push(['authorizeAccount', accountId, accessToken]);
    return { payload: { ctidTraderAccountId: accountId } };
  };

  const result = await client.authenticateAndAuthorizeAccount(undefined, 'access-token');

  assert.equal(result.authorizedAccountId, 1318619);
  assert.deepEqual(calls.at(-1), ['authorizeAccount', 1318619, 'access-token']);
});

test('authenticateAndAuthorizeAccount routes selected live accounts to the live endpoint before account authorization', async () => {
  const calls = [];
  const client = new CTraderOpenApiJsonClient({
    environment: 'demo',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    accessToken: 'access-token',
    WebSocketImpl: class {},
  });

  client.connect = async () => calls.push(['connect', client.environment, client.endpoint]);
  client.authenticateApplication = async () => calls.push(['authenticateApplication', client.environment]);
  client.getAccountList = async () => {
    calls.push(['getAccountList']);
    return [
      { ctidTraderAccountId: 45954881, accountNumber: 5188953, isLive: false },
      { ctidTraderAccountId: 45954931, accountNumber: 1318619, isLive: true },
    ];
  };
  client.authorizeAccount = async (accountId, accessToken) => {
    calls.push(['authorizeAccount', accountId, accessToken, client.environment, client.endpoint]);
    return { payload: { ctidTraderAccountId: accountId } };
  };

  const result = await client.authenticateAndAuthorizeAccount(45954931, 'access-token');

  assert.equal(result.authorizedAccountId, 45954931);
  assert.equal(result.accountEnvironment, 'live');
  assert.deepEqual(calls.at(-1), [
    'authorizeAccount',
    45954931,
    'access-token',
    'live',
    'wss://live.ctraderapi.com:5036',
  ]);
});

test('prefers readable archived cTrader symbol metadata over numeric active placeholder', async () => {
  const client = createClient();
  const symbolPromise = client.getSymbolById(45954931, 41);
  const socket = FakeWebSocket.instances[0];
  socket.open();
  await flushMicrotasks();

  const sentMessage = socket.sentMessages[0];
  socket.receive({
    clientMsgId: sentMessage.clientMsgId,
    payloadType: CTRADER_PAYLOAD_TYPES.PROTO_OA_SYMBOL_BY_ID_RES,
    payload: {
      symbol: [{ symbolId: 41, symbolName: '41', lotSize: 10000 }],
      archivedSymbol: [{ symbolId: 41, symbolName: 'XAUUSD', lotSize: 10000 }],
    },
  });

  assert.deepEqual(await symbolPromise, { symbolId: 41, symbolName: 'XAUUSD', lotSize: 10000 });
});

test('fetches cTrader orders by position ID for stop loss fallback', async () => {
  const client = createClient();
  const ordersPromise = client.getOrderListByPositionId(12345, 67890, {
    fromTimestamp: 1_690_000_000_000,
    toTimestamp: 1_700_000_000_000,
  });
  const socket = FakeWebSocket.instances[0];
  socket.open();
  await flushMicrotasks();

  const sentMessage = socket.sentMessages[0];
  assert.equal(sentMessage.payloadType, CTRADER_PAYLOAD_TYPES.PROTO_OA_ORDER_LIST_BY_POSITION_ID_REQ);
  assert.deepEqual(sentMessage.payload, {
    ctidTraderAccountId: 12345,
    positionId: 67890,
    fromTimestamp: 1_690_000_000_000,
    toTimestamp: 1_700_000_000_000,
  });

  socket.receive({
    clientMsgId: sentMessage.clientMsgId,
    payloadType: CTRADER_PAYLOAD_TYPES.PROTO_OA_ORDER_LIST_BY_POSITION_ID_RES,
    payload: {
      ctidTraderAccountId: 12345,
      positionId: 67890,
      order: [{ orderId: 5, stopLoss: 1.2345 }],
    },
  });

  assert.deepEqual(await ordersPromise, {
    ctidTraderAccountId: 12345,
    positionId: 67890,
    order: [{ orderId: 5, stopLoss: 1.2345 }],
  });
});
