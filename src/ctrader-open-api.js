import { randomUUID } from 'node:crypto';

export const CTRADER_JSON_ENDPOINTS = {
  demo: 'wss://demo.ctraderapi.com:5036',
  live: 'wss://live.ctraderapi.com:5036',
};

export const CTRADER_PAYLOAD_TYPES = {
  PROTO_OA_APPLICATION_AUTH_REQ: 2100,
  PROTO_OA_APPLICATION_AUTH_RES: 2101,
  PROTO_OA_ACCOUNT_AUTH_REQ: 2102,
  PROTO_OA_ACCOUNT_AUTH_RES: 2103,
  PROTO_OA_ERROR_RES: 2142,
  PROTO_OA_GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ: 2149,
  PROTO_OA_GET_ACCOUNTS_BY_ACCESS_TOKEN_RES: 2150,
  HEARTBEAT_EVENT: 51,
};

export function getCtraderJsonEndpoint(environment) {
  const endpoint = CTRADER_JSON_ENDPOINTS[String(environment || '').toLowerCase()];
  if (!endpoint) {
    throw new Error('cTrader environment must be either demo or live');
  }

  return endpoint;
}

export function buildOpenApiJsonMessage(payloadType, payload, clientMsgId = randomUUID()) {
  return {
    clientMsgId,
    payloadType,
    payload,
  };
}

export class CTraderOpenApiJsonClient {
  constructor({
    environment,
    clientId,
    clientSecret,
    accessToken,
    endpoint = getCtraderJsonEndpoint(environment),
    timeoutMs = 10_000,
    WebSocketImpl = globalThis.WebSocket,
  }) {
    if (!clientId) {
      throw new Error('cTrader clientId is required');
    }
    if (!clientSecret) {
      throw new Error('cTrader clientSecret is required');
    }
    if (!WebSocketImpl) {
      throw new Error('A WebSocket implementation is required to connect to cTrader Open API');
    }

    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.accessToken = accessToken;
    this.endpoint = endpoint;
    this.timeoutMs = timeoutMs;
    this.WebSocketImpl = WebSocketImpl;
    this.socket = null;
    this.pendingRequests = new Map();
  }

  async connect() {
    if (this.socket && isOpenSocket(this.socket)) {
      return;
    }

    this.socket = new this.WebSocketImpl(this.endpoint);
    attachSocketHandler(this.socket, 'message', (event) => this.handleMessage(event));
    attachSocketHandler(this.socket, 'close', () => this.rejectPendingRequests(new Error('cTrader Open API WebSocket closed')));
    attachSocketHandler(this.socket, 'error', () => this.rejectPendingRequests(new Error('cTrader Open API WebSocket error')));

    if (isOpenSocket(this.socket)) {
      return;
    }

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Timed out connecting to cTrader Open API'));
      }, this.timeoutMs);

      const cleanup = () => {
        clearTimeout(timeout);
        detachSocketHandler(this.socket, 'open', handleOpen);
        detachSocketHandler(this.socket, 'error', handleError);
      };
      const handleOpen = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error('Unable to connect to cTrader Open API'));
      };

      attachSocketHandler(this.socket, 'open', handleOpen);
      attachSocketHandler(this.socket, 'error', handleError);
    });
  }

  close() {
    if (this.socket && typeof this.socket.close === 'function') {
      this.socket.close();
    }
    this.socket = null;
    this.rejectPendingRequests(new Error('cTrader Open API client closed'));
  }

  async authenticateApplication() {
    return this.sendRequest(
      CTRADER_PAYLOAD_TYPES.PROTO_OA_APPLICATION_AUTH_REQ,
      {
        clientId: this.clientId,
        clientSecret: this.clientSecret,
      },
      CTRADER_PAYLOAD_TYPES.PROTO_OA_APPLICATION_AUTH_RES,
    );
  }

  async getAccountList(accessToken = this.accessToken) {
    if (!accessToken) {
      throw new Error('cTrader access token is required to get account list');
    }

    const response = await this.sendRequest(
      CTRADER_PAYLOAD_TYPES.PROTO_OA_GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ,
      { accessToken },
      CTRADER_PAYLOAD_TYPES.PROTO_OA_GET_ACCOUNTS_BY_ACCESS_TOKEN_RES,
    );

    return response.payload?.ctidTraderAccount || [];
  }

  async authorizeAccount(ctidTraderAccountId, accessToken = this.accessToken) {
    if (!ctidTraderAccountId) {
      throw new Error('cTrader account ID is required to authorize an account');
    }
    if (!accessToken) {
      throw new Error('cTrader access token is required to authorize an account');
    }

    return this.sendRequest(
      CTRADER_PAYLOAD_TYPES.PROTO_OA_ACCOUNT_AUTH_REQ,
      {
        ctidTraderAccountId,
        accessToken,
      },
      CTRADER_PAYLOAD_TYPES.PROTO_OA_ACCOUNT_AUTH_RES,
    );
  }

  async authenticateAndAuthorizeAccount(ctidTraderAccountId, accessToken = this.accessToken) {
    await this.connect();
    await this.authenticateApplication();
    const accounts = await this.getAccountList(accessToken);
    const accountId = ctidTraderAccountId || accounts[0]?.ctidTraderAccountId;
    if (!accountId) {
      throw new Error('No cTrader accounts were returned for this access token');
    }

    const accountAuth = await this.authorizeAccount(accountId, accessToken);
    return {
      accounts,
      authorizedAccountId: accountAuth.payload?.ctidTraderAccountId || accountId,
      accountAuth,
    };
  }

  async sendRequest(payloadType, payload, expectedPayloadType) {
    await this.connect();
    const message = buildOpenApiJsonMessage(payloadType, payload);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(message.clientMsgId);
        reject(new Error(`Timed out waiting for cTrader response to payload ${payloadType}`));
      }, this.timeoutMs);

      this.pendingRequests.set(message.clientMsgId, {
        expectedPayloadType,
        resolve,
        reject,
        timeout,
      });

      try {
        this.socket.send(JSON.stringify(message));
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(message.clientMsgId);
        reject(error);
      }
    });
  }

  async handleMessage(event) {
    const message = parseOpenApiJsonMessage(await normalizeMessageData(event?.data ?? event));
    if (message.payloadType === CTRADER_PAYLOAD_TYPES.HEARTBEAT_EVENT) {
      return;
    }

    const pendingRequest = this.pendingRequests.get(message.clientMsgId);
    if (!pendingRequest) {
      return;
    }

    clearTimeout(pendingRequest.timeout);
    this.pendingRequests.delete(message.clientMsgId);

    if (message.payloadType === CTRADER_PAYLOAD_TYPES.PROTO_OA_ERROR_RES) {
      pendingRequest.reject(new Error(message.payload?.description || message.payload?.errorCode || 'cTrader Open API request failed'));
      return;
    }

    if (pendingRequest.expectedPayloadType && message.payloadType !== pendingRequest.expectedPayloadType) {
      pendingRequest.reject(new Error(`Unexpected cTrader payload type ${message.payloadType}; expected ${pendingRequest.expectedPayloadType}`));
      return;
    }

    pendingRequest.resolve(message);
  }

  rejectPendingRequests(error) {
    for (const [clientMsgId, pendingRequest] of this.pendingRequests) {
      clearTimeout(pendingRequest.timeout);
      pendingRequest.reject(error);
      this.pendingRequests.delete(clientMsgId);
    }
  }
}

export function parseOpenApiJsonMessage(data) {
  if (typeof data !== 'string') {
    throw new Error('cTrader Open API JSON message must be a string');
  }

  const message = JSON.parse(data);
  if (!message || typeof message !== 'object' || typeof message.payloadType !== 'number') {
    throw new Error('Invalid cTrader Open API JSON message');
  }

  return message;
}

async function normalizeMessageData(data) {
  if (typeof data === 'string') {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString('utf8');
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8');
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  }
  if (data && typeof data.text === 'function') {
    return data.text();
  }

  throw new Error('Unsupported cTrader Open API message data type');
}

function isOpenSocket(socket) {
  return socket.readyState === 1 || socket.readyState === socket.OPEN;
}

function attachSocketHandler(socket, eventName, handler) {
  if (typeof socket.addEventListener === 'function') {
    socket.addEventListener(eventName, handler);
    return;
  }

  if (typeof socket.on === 'function') {
    socket.on(eventName, handler);
  }
}

function detachSocketHandler(socket, eventName, handler) {
  if (typeof socket?.removeEventListener === 'function') {
    socket.removeEventListener(eventName, handler);
    return;
  }

  if (typeof socket?.off === 'function') {
    socket.off(eventName, handler);
  }
}
