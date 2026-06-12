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
