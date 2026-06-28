import { createHmac, randomBytes, scryptSync, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CTraderOpenApiJsonClient } from './ctrader-open-api.js';
import { CTRADER_JOURNAL_MAPPER_TRACE_VERSION, mapCtraderDealsToJournalTrades } from './ctrader-journal-mapper.js';

export { CTRADER_JOURNAL_MAPPER_TRACE_VERSION, mapCtraderDealsToJournalTrades } from './ctrader-journal-mapper.js';

const PORT = Number(process.env.PORT) || 5173;
const ROOT_DIR = join(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_RECENT_DEALS_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_DEALS_MAX_ROWS = 100;
const RAW_DEALS_FILE_NAME = 'ctrader-raw-deals.json';
const CTRADER_DEBUG_POSITION_ID = '543914821';
const CTRADER_AUTHORIZE_URL = 'https://id.ctrader.com/my/settings/openapi/grantingaccess/';
const CTRADER_TOKEN_URL = 'https://openapi.ctrader.com/apps/token';
const STATE_COOKIE_NAME = 'ctrader_oauth_state';
const STATE_TTL_MS = 10 * 60 * 1000;

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

export function createAppServer(options = {}) {
  return createServer(async (request, response) => {
    setCorsHeaders(response, options);

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url || '/', getRequestOrigin(request));

    if (request.method === 'GET' && url.pathname === '/auth/ctrader/start') {
      await startCtraderAuth(request, response);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/auth/ctrader/callback') {
      await completeCtraderAuth(request, response, url, options);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/ctrader/deals') {
      await getCtraderDeals(response, url, options);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/ctrader/journal-preview') {
      await getCtraderJournalPreview(response, url, options);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/ctrader/status') {
      await getCtraderStatus(response, options);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/ctrader/accounts') {
      await getCtraderAccounts(response, url, options);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/ctrader/balance') {
      await getCtraderBalance(response, url, options);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/dna-doctor') {
      await runDnaDoctorEndpoint(request, response, options);
      return;
    }

    if (request.method === 'GET') {
      await serveStaticFile(response, url.pathname);
      return;
    }

    sendJson(response, 405, { error: 'Method not allowed' });
  });
}

export function getCtraderConfig(env = process.env) {
  const config = {
    clientId: env.CTRADER_CLIENT_ID,
    clientSecret: env.CTRADER_CLIENT_SECRET,
    redirectUri: env.CTRADER_REDIRECT_URI,
    environment: env.CTRADER_ENVIRONMENT,
    encryptionSecret: env.CTRADER_TOKEN_ENCRYPTION_KEY || env.CTRADER_CLIENT_SECRET,
  };
  const missing = Object.entries({
    CTRADER_CLIENT_ID: config.clientId,
    CTRADER_CLIENT_SECRET: config.clientSecret,
    CTRADER_REDIRECT_URI: config.redirectUri,
    CTRADER_ENVIRONMENT: config.environment,
  })
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length) {
    return { ok: false, missing };
  }

  const normalizedEnvironment = String(config.environment).toLowerCase();
  if (!['demo', 'live'].includes(normalizedEnvironment)) {
    return { ok: false, invalidEnvironment: config.environment };
  }

  return {
    ok: true,
    ...config,
    environment: normalizedEnvironment,
  };
}

export function buildCtraderAuthorizeUrl(config, state) {
  const authorizationUrl = new URL(CTRADER_AUTHORIZE_URL);
  authorizationUrl.searchParams.set('client_id', config.clientId);
  authorizationUrl.searchParams.set('redirect_uri', config.redirectUri);
  authorizationUrl.searchParams.set('scope', 'accounts');
  authorizationUrl.searchParams.set('product', 'web');
  authorizationUrl.searchParams.set('state', state);
  return authorizationUrl;
}

export function createSignedState(config, now = Date.now(), options = {}) {
  const payload = {
    nonce: base64Url(randomBytes(24)),
    environment: config.environment,
    expiresAt: now + STATE_TTL_MS,
  };

  if (options.returnTo) {
    payload.returnTo = options.returnTo;
  }
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = signState(encodedPayload, config.encryptionSecret);
  return `${encodedPayload}.${signature}`;
}

export function getVerifiedSignedStatePayload(state, expectedEnvironment, secret, now = Date.now()) {
  const [encodedPayload, signature] = String(state || '').split('.');
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signState(encodedPayload, secret);
  if (!timingSafeStringEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (payload.environment !== expectedEnvironment || Number(payload.expiresAt) <= now) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function verifySignedState(state, expectedEnvironment, secret, now = Date.now()) {
  return getVerifiedSignedStatePayload(state, expectedEnvironment, secret, now) !== null;
}

export async function exchangeAuthorizationCode(config, code, fetchImpl = fetch) {
  const tokenUrl = new URL(CTRADER_TOKEN_URL);
  tokenUrl.searchParams.set('grant_type', 'authorization_code');
  tokenUrl.searchParams.set('code', code);
  tokenUrl.searchParams.set('redirect_uri', config.redirectUri);
  tokenUrl.searchParams.set('client_id', config.clientId);
  tokenUrl.searchParams.set('client_secret', config.clientSecret);

  const tokenResponse = await fetchImpl(tokenUrl, { method: 'GET' });
  const responseText = await tokenResponse.text();
  console.log('[cTrader token exchange] status:', tokenResponse.status);
  console.log('[cTrader token exchange] content-type:', tokenResponse.headers.get('content-type'));
  console.log('[cTrader token exchange] retry-after:', tokenResponse.headers.get('retry-after'));
  console.log('[cTrader token exchange] x-ratelimit-remaining:', tokenResponse.headers.get('x-ratelimit-remaining'));
  console.log('[cTrader token exchange] redirect_uri sent:', config.redirectUri);
  console.log('[cTrader token exchange] client_id sent:', config.clientId);
  if (!tokenResponse.headers.get('content-type')?.includes('application/json')) {
    console.log('[cTrader token exchange] non-JSON body (first 300 chars):', responseText.slice(0, 300));
    throw new Error(`cTrader token endpoint returned non-JSON (status ${tokenResponse.status}) — check redirect URI or rate limit`);
  }
  const responseBody = JSON.parse(responseText);
  if (!tokenResponse.ok) {
    throw new Error(responseBody.error_description || responseBody.error || 'cTrader token exchange failed');
  }

  return normalizeTokenResponse(responseBody);
}

export function normalizeTokenResponse(responseBody) {
  return {
    accessToken: responseBody.accessToken || responseBody.access_token,
    refreshToken: responseBody.refreshToken || responseBody.refresh_token,
    tokenType: responseBody.tokenType || responseBody.token_type || 'Bearer',
    expiresIn: Number(responseBody.expiresIn || responseBody.expires_in || 0),
    raw: responseBody,
  };
}

export function encryptTokenPayload(payload, secret) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(secret, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = JSON.stringify(payload);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    algorithm: 'aes-256-gcm',
    kdf: 'scrypt',
    salt: base64Url(salt),
    iv: base64Url(iv),
    authTag: base64Url(authTag),
    ciphertext: base64Url(ciphertext),
  };
}

export async function storeEncryptedTokens(config, tokens, options = {}) {
  if (!tokens.accessToken || !tokens.refreshToken) {
    throw new Error('cTrader token response did not include both access and refresh tokens');
  }

  const receivedAt = new Date();
  const expiresAt = tokens.expiresIn > 0
    ? new Date(receivedAt.getTime() + tokens.expiresIn * 1000)
    : null;
  const encryptedTokens = encryptTokenPayload({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenType: tokens.tokenType,
  }, config.encryptionSecret);
  const tokenRecord = {
    provider: 'ctrader',
    environment: config.environment,
    receivedAt: receivedAt.toISOString(),
    expiresAt: expiresAt?.toISOString() || null,
    tokenType: tokens.tokenType,
    encryptedTokens,
  };

  const tokenStorePath = getTokenStorePath(options);
  await mkdir(getDataDir(options), { recursive: true, mode: 0o700 });
  const tempPath = `${tokenStorePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(tokenRecord, null, 2)}\n`, { mode: 0o600 });
  await rename(tempPath, tokenStorePath);
  return tokenRecord;
}

export function decryptTokenPayload(encryptedPayload, secret) {
  if (encryptedPayload?.algorithm !== 'aes-256-gcm' || encryptedPayload?.kdf !== 'scrypt') {
    throw new Error('Unsupported cTrader token encryption format');
  }

  const salt = Buffer.from(encryptedPayload.salt, 'base64url');
  const iv = Buffer.from(encryptedPayload.iv, 'base64url');
  const authTag = Buffer.from(encryptedPayload.authTag, 'base64url');
  const ciphertext = Buffer.from(encryptedPayload.ciphertext, 'base64url');
  const key = scryptSync(secret, salt, 32);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext);
}

async function refreshCtraderTokens(config, refreshToken, options = {}, fetchImpl = fetch) {
  const tokenUrl = new URL(CTRADER_TOKEN_URL);
  tokenUrl.searchParams.set('grant_type', 'refresh_token');
  tokenUrl.searchParams.set('refresh_token', refreshToken);
  tokenUrl.searchParams.set('client_id', config.clientId);
  tokenUrl.searchParams.set('client_secret', config.clientSecret);

  const tokenResponse = await fetchImpl(tokenUrl, { method: 'GET' });
  const responseBody = await tokenResponse.json();
  if (!tokenResponse.ok) {
    throw new Error(responseBody.error_description || responseBody.error || 'cTrader token refresh failed');
  }

  return {
    accessToken: responseBody.accessToken || responseBody.access_token,
    refreshToken: responseBody.refreshToken || responseBody.refresh_token || refreshToken,
    tokenType: responseBody.tokenType || responseBody.token_type || 'Bearer',
    expiresIn: Number(responseBody.expiresIn || responseBody.expires_in || 0),
  };
}

export async function loadStoredCtraderTokens(config, options = {}) {
  let tokenRecord;
  try {
    tokenRecord = JSON.parse(await readFile(getTokenStorePath(options), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('cTrader OAuth tokens have not been stored yet; connect cTrader first');
    }
    throw error;
  }

  if (tokenRecord.provider !== 'ctrader') {
    throw new Error('Stored token record is not for cTrader');
  }
  if (tokenRecord.environment !== config.environment) {
    throw new Error(`Stored cTrader tokens are for ${tokenRecord.environment}, but ${config.environment} is configured`);
  }

  const decryptedTokens = decryptTokenPayload(tokenRecord.encryptedTokens, config.encryptionSecret);
  if (!decryptedTokens.accessToken) {
    throw new Error('Stored cTrader tokens do not include an access token');
  }

  // Auto-refresh if token is expired or within 5 minutes of expiry
  const REFRESH_BUFFER_MS = 5 * 60 * 1000;
  const expiresAt = tokenRecord.expiresAt ? new Date(tokenRecord.expiresAt).getTime() : null;
  const isExpiredOrExpiring = expiresAt !== null && Date.now() >= expiresAt - REFRESH_BUFFER_MS;

  if (isExpiredOrExpiring && decryptedTokens.refreshToken) {
    try {
      console.log('[cTrader auth] Access token expired or expiring — refreshing automatically');
      const freshTokens = await refreshCtraderTokens(config, decryptedTokens.refreshToken, options);
      const freshRecord = await storeEncryptedTokens(config, freshTokens, options);
      console.log('[cTrader auth] Token refreshed successfully, expires:', freshRecord.expiresAt);
      return {
        ...freshTokens,
        tokenType: freshTokens.tokenType || 'Bearer',
        record: freshRecord,
      };
    } catch (refreshError) {
      console.error('[cTrader auth] Token refresh failed:', refreshError.message);
      // Fall through and try the existing token — it may still work
    }
  }

  return {
    ...decryptedTokens,
    tokenType: decryptedTokens.tokenType || tokenRecord.tokenType || 'Bearer',
    record: tokenRecord,
  };
}

export function buildCtraderDealsRequest(url, now = Date.now()) {
  const toTimestamp = parseTimestampQuery(url.searchParams.get('toTimestamp'), now);
  const fromTimestamp = parseTimestampQuery(
    url.searchParams.get('fromTimestamp'),
    toTimestamp - DEFAULT_RECENT_DEALS_LOOKBACK_MS,
  );
  const maxRows = parseIntegerQuery(url.searchParams.get('maxRows'), DEFAULT_DEALS_MAX_ROWS);
  const accountIdQuery = url.searchParams.get('ctidTraderAccountId') || url.searchParams.get('accountId');

  return {
    ctidTraderAccountId: accountIdQuery ? parseIntegerQuery(accountIdQuery) : undefined,
    fromTimestamp,
    toTimestamp,
    maxRows,
  };
}

export function buildCtraderAccountsRequest(url, now = Date.now()) {
  const request = buildCtraderDealsRequest(url, now);
  const includeDealSummaries = ['1', 'true', 'yes'].includes(String(url.searchParams.get('includeDealSummaries') || '').toLowerCase());

  return {
    ...request,
    includeDealSummaries,
  };
}

export async function fetchRecentCtraderDeals(config, tokens, requestOptions = {}, options = {}) {
  const OpenApiClient = options.OpenApiClient || CTraderOpenApiJsonClient;
  const client = options.openApiClient || new OpenApiClient({
    environment: config.environment,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    accessToken: tokens.accessToken,
  });

  try {
    const accountAuth = await client.authenticateAndAuthorizeAccount(
      requestOptions.ctidTraderAccountId,
      tokens.accessToken,
    );
    logAuthorizedCtraderAccounts(accountAuth.accounts);
    const selectedAccount = findCtraderAccount(accountAuth.accounts, accountAuth.authorizedAccountId);
    console.info('[cTrader sync] Selected account for sync', {
      accountId: accountAuth.authorizedAccountId,
      requestedAccountId: requestOptions.ctidTraderAccountId ?? null,
      selectedBy: requestOptions.ctidTraderAccountId ? 'request' : 'first-live-authorized-account',
      accountNumber: getCtraderAccountNumber(selectedAccount),
      isLive: selectedAccount?.isLive ?? null,
      accountEnvironment: accountAuth.accountEnvironment || config.environment,
      configuredEnvironment: config.environment,
    });
    console.info('[cTrader deals] Querying account', { accountId: accountAuth.authorizedAccountId, requestedAccountId: requestOptions.ctidTraderAccountId ?? null });
    const rawDeals = await client.getDealList(accountAuth.authorizedAccountId, {
      fromTimestamp: requestOptions.fromTimestamp,
      toTimestamp: requestOptions.toTimestamp,
      maxRows: requestOptions.maxRows,
    });
    logCtraderDealSymbolFields(accountAuth.authorizedAccountId, rawDeals?.deal);
    const symbolMetadataById = await fetchCtraderSymbolMetadataForDeals(
      client,
      accountAuth.authorizedAccountId,
      rawDeals?.deal,
    );
    const ordersByPositionId = requestOptions.includeOrdersByPositionId
      ? await fetchCtraderOrdersByPositionIdForDeals(
        client,
        accountAuth.authorizedAccountId,
        rawDeals?.deal,
        requestOptions,
      )
      : {};

    const dealCount = Array.isArray(rawDeals?.deal) ? rawDeals.deal.length : 0;
    const latestDealId = getLatestCtraderDealId(rawDeals?.deal);
    console.info('[cTrader deals] Response summary', {
      accountId: accountAuth.authorizedAccountId,
      dealCount,
      latestDealId,
      request: {
        fromTimestamp: requestOptions.fromTimestamp,
        toTimestamp: requestOptions.toTimestamp,
        maxRows: requestOptions.maxRows,
      },
    });

    return {
      environment: config.environment,
      accountId: accountAuth.authorizedAccountId,
      accounts: accountAuth.accounts,
      request: {
        fromTimestamp: requestOptions.fromTimestamp,
        toTimestamp: requestOptions.toTimestamp,
        maxRows: requestOptions.maxRows,
      },
      rawDeals,
      symbolMetadataById,
      ordersByPositionId,
      dealCount,
      latestDealId,
    };
  } finally {
    if (typeof client.close === 'function') {
      client.close();
    }
  }
}

async function fetchCtraderOrdersByPositionIdForDeals(client, accountId, deals, requestOptions = {}) {
  if (typeof client.getOrderListByPositionId !== 'function') {
    return {};
  }

  const positionIds = [...new Set((Array.isArray(deals) ? deals : [])
    .map((deal) => deal?.positionId)
    .filter((positionId) => positionId !== undefined && positionId !== null && positionId !== '')
    .map((positionId) => String(positionId)))];
  const ordersByPositionId = {};

  for (const positionId of positionIds) {
    try {
      const rawOrders = await client.getOrderListByPositionId(accountId, positionId, {
        fromTimestamp: requestOptions.fromTimestamp,
        toTimestamp: requestOptions.toTimestamp,
      });
      logCtraderPositionDebug(positionId, 'raw-getOrderListByPositionId-response', rawOrders);
      const orders = Array.isArray(rawOrders?.order) ? rawOrders.order : [];
      ordersByPositionId[positionId] = orders;
      console.info('[cTrader orders] Orders resolved for position', {
        accountId,
        positionId,
        orderCount: orders.length,
        orderIds: orders.map((order) => order?.orderId ?? order?.id ?? null),
      });
    } catch (error) {
      ordersByPositionId[positionId] = [];
      console.warn('[cTrader orders] Order lookup failed for position; continuing without order stop loss fallback', {
        accountId,
        positionId,
        error: error.message || 'Unknown cTrader order history error',
      });
    }
  }

  if (Object.prototype.hasOwnProperty.call(ordersByPositionId, CTRADER_DEBUG_POSITION_ID)) {
    logCtraderPositionDebug(CTRADER_DEBUG_POSITION_ID, 'ordersByPositionId-after-build', ordersByPositionId);
  }
  return ordersByPositionId;
}

function logCtraderPositionDebug(positionId, stage, payload) {
  if (String(positionId) !== CTRADER_DEBUG_POSITION_ID) {
    return;
  }

  console.info(`[cTrader position ${CTRADER_DEBUG_POSITION_ID}] ${stage}`, JSON.stringify(payload, null, 2));
}

async function fetchCtraderSymbolMetadataForDeals(client, accountId, deals) {
  if (typeof client.getSymbolById !== 'function') {
    return {};
  }

  const symbolIds = [...new Set((Array.isArray(deals) ? deals : [])
    .flatMap((deal) => [
      deal?.symbolId,
      deal?.closePositionDetail?.symbolId,
      isNumericCtraderSymbolIdentifier(deal?.symbol) ? deal.symbol : null,
      deal?.closePositionDetail?.symbol,
    ])
    .filter((symbolId) => symbolId !== undefined && symbolId !== null && symbolId !== '')
    .filter(isNumericCtraderSymbolIdentifier)
    .map((symbolId) => String(symbolId)))];
  const symbolMetadataById = {};

  for (const symbolId of symbolIds) {
    try {
      const symbol = await client.getSymbolById(accountId, symbolId);
      if (symbol) {
        symbolMetadataById[String(symbolId)] = symbol;
        console.info('[cTrader symbols] Metadata resolved', {
          accountId,
          symbolId,
          symbolName: symbol?.symbolName ?? symbol?.symbol ?? symbol?.name ?? symbol?.displayName ?? null,
          rawSymbolFields: getCtraderSymbolMetadataLogFields(symbol),
        });
      } else {
        console.warn('[cTrader symbols] Metadata lookup returned no symbol', { accountId, symbolId });
      }
    } catch (error) {
      console.warn('[cTrader symbols] Metadata lookup failed', {
        accountId,
        symbolId,
        error: error.message || 'Unknown cTrader symbol metadata error',
      });
    }
  }

  return symbolMetadataById;
}

function logCtraderDealSymbolFields(accountId, deals) {
  if (!Array.isArray(deals) || deals.length === 0) {
    console.info('[cTrader deals] Raw symbol fields', { accountId, dealCount: 0, symbolFields: [] });
    return;
  }

  console.info('[cTrader deals] Raw symbol fields', {
    accountId,
    dealCount: deals.length,
    symbolFields: deals.map((deal) => ({
      dealId: deal?.dealId ?? null,
      positionId: deal?.positionId ?? null,
      symbol: deal?.symbol ?? null,
      symbolId: deal?.symbolId ?? null,
      symbolName: deal?.symbolName ?? null,
      closePositionDetailSymbol: deal?.closePositionDetail?.symbol ?? null,
      closePositionDetailSymbolId: deal?.closePositionDetail?.symbolId ?? null,
      closePositionDetailSymbolName: deal?.closePositionDetail?.symbolName ?? null,
      allSymbolFields: collectCtraderSymbolFields(deal),
    })),
  });
}

function collectCtraderSymbolFields(value, path = '') {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const symbolFields = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    const fieldPath = path ? `${path}.${key}` : key;
    if (key.toLowerCase().includes('symbol')) {
      symbolFields[fieldPath] = fieldValue;
    }
    if (fieldValue && typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
      Object.assign(symbolFields, collectCtraderSymbolFields(fieldValue, fieldPath));
    }
  }

  return symbolFields;
}

function getCtraderSymbolMetadataLogFields(symbol) {
  if (!symbol || typeof symbol !== 'object') {
    return symbol ?? null;
  }

  return {
    symbolId: symbol.symbolId ?? null,
    symbolName: symbol.symbolName ?? null,
    symbol: symbol.symbol ?? null,
    name: symbol.name ?? null,
    displayName: symbol.displayName ?? null,
    baseAssetId: symbol.baseAssetId ?? null,
    quoteAssetId: symbol.quoteAssetId ?? null,
  };
}

function isNumericCtraderSymbolIdentifier(value) {
  if (value === undefined || value === null || value === '') {
    return false;
  }
  return /^\d+$/.test(String(value).trim());
}

export async function fetchCtraderAccountBalance(config, tokens, requestOptions = {}, options = {}) {
  const OpenApiClient = options.OpenApiClient || CTraderOpenApiJsonClient;
  const client = options.openApiClient || new OpenApiClient({
    environment: config.environment,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    accessToken: tokens.accessToken,
  });

  try {
    const accountAuth = await client.authenticateAndAuthorizeAccount(
      requestOptions.ctidTraderAccountId,
      tokens.accessToken,
    );
    const trader = await client.getTrader(accountAuth.authorizedAccountId);
    const balance = normalizeCtraderMoney(trader?.balance, trader?.moneyDigits);

    return {
      provider: 'ctrader',
      environment: accountAuth.accountEnvironment || config.environment,
      accountId: accountAuth.authorizedAccountId,
      balance,
      rawBalance: trader?.balance ?? null,
      moneyDigits: trader?.moneyDigits ?? null,
      depositAssetId: trader?.depositAssetId ?? null,
      accountNumber: trader?.login ?? getCtraderAccountNumber(findCtraderAccount(accountAuth.accounts, accountAuth.authorizedAccountId)),
      isLive: findCtraderAccount(accountAuth.accounts, accountAuth.authorizedAccountId)?.isLive ?? null,
    };
  } finally {
    if (typeof client.close === 'function') {
      client.close();
    }
  }
}

function normalizeCtraderMoney(value, moneyDigits) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }
  const digits = Number.isInteger(Number(moneyDigits)) ? Number(moneyDigits) : 2;
  return Number((numericValue / (10 ** digits)).toFixed(2));
}

export async function fetchCtraderAccounts(config, tokens, requestOptions = {}, options = {}) {
  const OpenApiClient = options.OpenApiClient || CTraderOpenApiJsonClient;
  const client = options.openApiClient || new OpenApiClient({
    environment: config.environment,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    accessToken: tokens.accessToken,
  });

  try {
    await client.connect();
    await client.authenticateApplication();
    const accounts = await client.getAccountList(tokens.accessToken);
    logAuthorizedCtraderAccounts(accounts);

    const normalizedAccounts = [];
    for (const account of accounts) {
      const accountId = account?.ctidTraderAccountId;
      if (!accountId) {
        continue;
      }

      const accountSummary = {
        ctidTraderAccountId: accountId,
        accountNumber: getCtraderAccountNumber(account),
        isLive: account?.isLive ?? null,
        brokerName: account?.brokerName ?? null,
        depositCurrency: account?.depositCurrency ?? null,
      };

      if (requestOptions.includeDealSummaries) {
        try {
          const accountAuth = await client.authorizeAccount(accountId, tokens.accessToken);
          const authorizedAccountId = accountAuth.payload?.ctidTraderAccountId || accountId;
          const rawDeals = await client.getDealList(authorizedAccountId, {
            fromTimestamp: requestOptions.fromTimestamp,
            toTimestamp: requestOptions.toTimestamp,
            maxRows: requestOptions.maxRows,
          });
          const deals = Array.isArray(rawDeals?.deal) ? rawDeals.deal : [];
          accountSummary.ctidTraderAccountId = authorizedAccountId;
          accountSummary.dealCount = deals.length;
          accountSummary.latestDealId = getLatestCtraderDealId(deals);
          accountSummary.latestDealTimestamp = getLatestCtraderDealTimestamp(deals);
        } catch (error) {
          accountSummary.dealCount = null;
          accountSummary.latestDealId = null;
          accountSummary.latestDealTimestamp = null;
          accountSummary.dealSummaryError = error.message || 'Unable to load latest deals for this account.';
          console.warn('[cTrader accounts] Account deal summary failed; returning account without deal summary', {
            accountId,
            error: accountSummary.dealSummaryError,
          });
        }
      }

      normalizedAccounts.push(accountSummary);
    }

    console.info('[cTrader accounts] Authorized account summary', {
      accountCount: normalizedAccounts.length,
      includeDealSummaries: Boolean(requestOptions.includeDealSummaries),
      accounts: normalizedAccounts.map((account) => ({
        accountId: account.ctidTraderAccountId,
        accountNumber: account.accountNumber,
        isLive: account.isLive,
        dealCount: account.dealCount ?? null,
        latestDealId: account.latestDealId ?? null,
      })),
    });

    return {
      provider: 'ctrader',
      environment: config.environment,
      request: {
        fromTimestamp: requestOptions.fromTimestamp,
        toTimestamp: requestOptions.toTimestamp,
        maxRows: requestOptions.maxRows,
        includeDealSummaries: Boolean(requestOptions.includeDealSummaries),
      },
      accountCount: normalizedAccounts.length,
      accounts: normalizedAccounts,
    };
  } finally {
    if (typeof client.close === 'function') {
      client.close();
    }
  }
}

export async function storeRawCtraderDeals(dealsResult, options = {}) {
  const storedPayload = {
    provider: 'ctrader',
    environment: dealsResult.environment,
    accountId: dealsResult.accountId,
    fetchedAt: new Date(options.now?.() ?? Date.now()).toISOString(),
    request: dealsResult.request,
    dealCount: dealsResult.dealCount,
    latestDealId: dealsResult.latestDealId,
    symbolMetadataById: dealsResult.symbolMetadataById || {},
    rawDeals: dealsResult.rawDeals,
  };
  const rawDealsStorePath = getRawDealsStorePath(options);
  await mkdir(getDataDir(options), { recursive: true, mode: 0o700 });
  const tempPath = `${rawDealsStorePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(storedPayload, null, 2)}\n`, { mode: 0o600 });
  await rename(tempPath, rawDealsStorePath);
  return storedPayload;
}

async function getCtraderStatus(response, options = {}) {
  const config = getCtraderConfig(options.env);
  if (!config.ok) {
    sendConfigurationError(response, config);
    return;
  }

  try {
    const tokens = await loadStoredCtraderTokens(config, options);
    sendJson(response, 200, {
      provider: 'ctrader',
      connected: true,
      environment: config.environment,
      tokenType: tokens.tokenType,
      expiresAt: tokens.record?.expiresAt || null,
    });
  } catch (error) {
    sendJson(response, 401, {
      provider: 'ctrader',
      connected: false,
      environment: config.environment,
      error: error.message,
    });
  }
}

async function getCtraderDeals(response, url, options = {}) {
  const config = getCtraderConfig(options.env);
  if (!config.ok) {
    sendConfigurationError(response, config);
    return;
  }

  try {
    const tokens = await loadStoredCtraderTokens(config, options);
    const requestOptions = buildCtraderDealsRequest(url, options.now?.() ?? Date.now());
    console.info('[cTrader deals] Incoming backend request', getCtraderRequestLogContext(url, requestOptions));
    const dealsResult = await fetchRecentCtraderDeals(config, tokens, requestOptions, options);
    const stored = await storeRawCtraderDeals(dealsResult, options);
    sendJson(response, 200, {
      provider: 'ctrader',
      environment: dealsResult.environment,
      accountId: dealsResult.accountId,
      accounts: dealsResult.accounts,
      request: dealsResult.request,
      dealCount: dealsResult.dealCount,
      latestDealId: dealsResult.latestDealId,
      storedAt: stored.fetchedAt,
      symbolMetadataById: dealsResult.symbolMetadataById || {},
      rawDeals: dealsResult.rawDeals,
    });
  } catch (error) {
    logCtraderRouteError('/api/ctrader/deals', url, error);
    sendJson(response, 502, { error: error.message });
  }
}

async function getCtraderBalance(response, url, options = {}) {
  const config = getCtraderConfig(options.env);
  if (!config.ok) {
    sendConfigurationError(response, config);
    return;
  }

  try {
    const tokens = await loadStoredCtraderTokens(config, options);
    const requestOptions = buildCtraderDealsRequest(url, options.now?.() ?? Date.now());
    console.info('[cTrader balance] Incoming backend request', getCtraderRequestLogContext(url, requestOptions));
    const balanceResult = await fetchCtraderAccountBalance(config, tokens, requestOptions, options);
    sendJson(response, 200, balanceResult);
  } catch (error) {
    logCtraderRouteError('/api/ctrader/balance', url, error);
    sendJson(response, 502, { error: error.message });
  }
}

async function getCtraderAccounts(response, url, options = {}) {
  const config = getCtraderConfig(options.env);
  if (!config.ok) {
    sendConfigurationError(response, config);
    return;
  }

  try {
    const tokens = await loadStoredCtraderTokens(config, options);
    const requestOptions = buildCtraderAccountsRequest(url, options.now?.() ?? Date.now());
    console.info('[cTrader accounts] Incoming backend request', getCtraderRequestLogContext(url, requestOptions));
    const accountsResult = await fetchCtraderAccounts(config, tokens, requestOptions, options);
    sendJson(response, 200, accountsResult);
  } catch (error) {
    logCtraderRouteError('/api/ctrader/accounts', url, error);
    sendJson(response, 502, { error: error.message });
  }
}

async function getCtraderJournalPreview(response, url, options = {}) {
  const config = getCtraderConfig(options.env);
  if (!config.ok) {
    sendConfigurationError(response, config);
    return;
  }

  try {
    const tokens = await loadStoredCtraderTokens(config, options);
    const requestOptions = {
      ...buildCtraderDealsRequest(url, options.now?.() ?? Date.now()),
      includeOrdersByPositionId: true,
    };
    console.info('[cTrader journal-preview] Incoming backend request', getCtraderRequestLogContext(url, requestOptions));
    const dealsResult = await fetchRecentCtraderDeals(config, tokens, requestOptions, options);
    const symbolMetadataById = dealsResult.symbolMetadataById || {};
    console.info('[cTrader journal-preview] Mapper trace', {
      mapperTraceVersion: CTRADER_JOURNAL_MAPPER_TRACE_VERSION,
      symbolMetadataIds: Object.keys(symbolMetadataById),
      hasSymbolMetadataForXauusd41: Boolean(symbolMetadataById['41']),
    });
    const ordersByPositionId = dealsResult.ordersByPositionId || {};
    const trades = mapCtraderDealsToJournalTrades(dealsResult.rawDeals, {
      accountId: dealsResult.accountId,
      symbolMetadataById,
      ordersByPositionId,
    });
    console.info('[cTrader journal-preview] Import preview summary', {
      accountId: dealsResult.accountId,
      dealsReturned: dealsResult.dealCount,
      latestDealId: dealsResult.latestDealId,
      tradesMapped: trades.length,
      tradeSymbols: trades.map((trade) => ({
        sourceDealId: trade.sourceDealId,
        sourceSymbolId: trade.sourceSymbolId ?? null,
        symbol: trade.symbol,
        brokerSymbol: trade.brokerSymbol ?? null,
      })),
    });

    sendJson(response, 200, {
      provider: 'ctrader',
      environment: dealsResult.environment,
      accountId: dealsResult.accountId,
      request: dealsResult.request,
      dealCount: dealsResult.dealCount,
      latestDealId: dealsResult.latestDealId,
      tradeCount: trades.length,
      trades,
    });
  } catch (error) {
    logCtraderRouteError('/api/ctrader/journal-preview', url, error);
    sendJson(response, 502, { error: error.message });
  }
}

function getCtraderRequestLogContext(url, requestOptions = {}) {
  return {
    requestUrl: url.toString(),
    requestParameters: Object.fromEntries(url.searchParams.entries()),
    selectedAccountId: requestOptions.ctidTraderAccountId ?? null,
    requestOptions,
  };
}

function logCtraderRouteError(route, url, error) {
  console.error('[cTrader backend] Request failed', {
    route,
    requestUrl: url.toString(),
    requestParameters: Object.fromEntries(url.searchParams.entries()),
    selectedAccountId: url.searchParams.get('ctidTraderAccountId') || url.searchParams.get('accountId') || null,
    errorMessage: error?.message || String(error),
    stack: error?.stack || null,
  });
}

function normalizeOAuthReturnUrl(value) {
  if (!value) {
    return '';
  }

  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

async function startCtraderAuth(request, response) {
  const config = getCtraderConfig();
  if (!config.ok) {
    sendConfigurationError(response, config);
    return;
  }

  const requestUrl = new URL(request.url || '/', getRequestOrigin(request));
  const returnTo = normalizeOAuthReturnUrl(requestUrl.searchParams.get('returnTo'));
  const state = createSignedState(config, Date.now(), { returnTo });
  response.writeHead(302, {
    Location: buildCtraderAuthorizeUrl(config, state).toString(),
    'Set-Cookie': serializeCookie(STATE_COOKIE_NAME, state, {
      httpOnly: true,
      maxAge: Math.floor(STATE_TTL_MS / 1000),
      sameSite: 'Lax',
      secure: isSecureRequest(request),
      path: '/auth/ctrader',
    }),
  });
  response.end();
}

async function completeCtraderAuth(request, response, url, options = {}) {
  const config = getCtraderConfig();
  if (!config.ok) {
    sendConfigurationError(response, config);
    return;
  }

  const error = url.searchParams.get('error');
  if (error) {
    sendJson(response, 400, { error, errorDescription: url.searchParams.get('error_description') });
    return;
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const stateCookie = parseCookies(request.headers.cookie || '')[STATE_COOKIE_NAME];
  if (!code) {
    sendJson(response, 400, { error: 'Missing cTrader authorization code' });
    return;
  }

  const statePayload = state && state === stateCookie
    ? getVerifiedSignedStatePayload(state, config.environment, config.encryptionSecret)
    : null;
  if (!statePayload) {
    sendJson(response, 400, { error: 'Invalid or expired cTrader OAuth state' });
    return;
  }

  try {
    const tokens = await exchangeAuthorizationCode(config, code);
    const tokenRecord = await storeEncryptedTokens(config, tokens, options);
    const clearStateCookie = serializeCookie(STATE_COOKIE_NAME, '', {
      httpOnly: true,
      maxAge: 0,
      sameSite: 'Lax',
      secure: isSecureRequest(request),
      path: '/auth/ctrader',
    });

    if (statePayload.returnTo) {
      response.writeHead(302, {
        Location: statePayload.returnTo,
        'Set-Cookie': clearStateCookie,
      });
      response.end();
      return;
    }

    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Set-Cookie': clearStateCookie,
    });
    response.end(`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>cTrader connected</title></head>
  <body>
    <h1>cTrader connected</h1>
    <p>Tokens were stored securely for the ${escapeHtml(tokenRecord.environment)} environment.</p>
    <p>Return to the journal to use Sync cTrader or Auto Sync.</p>
    <p><a href="/">Return to the journal</a></p>
  </body>
</html>`);
  } catch (error) {
    sendJson(response, 502, { error: error.message });
  }
}

async function serveStaticFile(response, pathname) {
  const normalizedPath = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const candidatePath = normalize(join(ROOT_DIR, normalizedPath));
  if (!candidatePath.startsWith(ROOT_DIR)) {
    sendJson(response, 403, { error: 'Forbidden' });
    return;
  }

  try {
    const fileStats = await stat(candidatePath);
    if (!fileStats.isFile()) {
      sendJson(response, 404, { error: 'Not found' });
      return;
    }

    const contentType = contentTypes[extname(candidatePath)] || 'application/octet-stream';
    const fileStream = createReadStream(candidatePath);
    fileStream.on('error', () => {
      response.destroy();
    });
    response.writeHead(200, { 'Content-Type': contentType });
    fileStream.pipe(response);
  } catch {
    sendJson(response, 404, { error: 'Not found' });
  }
}

function sendConfigurationError(response, config) {
  if (config.missing) {
    sendJson(response, 500, {
      error: 'Missing cTrader configuration',
      missing: config.missing,
    });
    return;
  }

  sendJson(response, 500, {
    error: 'Invalid cTrader environment',
    expected: ['demo', 'live'],
    received: config.invalidEnvironment,
  });
}

function getLatestCtraderDealId(deals) {
  if (!Array.isArray(deals)) {
    return null;
  }

  return deals
    .map((deal) => Number(deal?.dealId))
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0] ?? null;
}

function getLatestCtraderDealTimestamp(deals) {
  if (!Array.isArray(deals)) {
    return null;
  }

  return deals
    .map((deal) => Number(deal?.executionTimestamp))
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0] ?? null;
}

function logAuthorizedCtraderAccounts(accounts) {
  console.info('[cTrader accounts] Authorized accounts returned by cTrader', {
    accountCount: Array.isArray(accounts) ? accounts.length : 0,
    accounts: Array.isArray(accounts)
      ? accounts.map((account) => ({
        accountId: account?.ctidTraderAccountId ?? null,
        accountNumber: getCtraderAccountNumber(account),
        isLive: account?.isLive ?? null,
        brokerName: account?.brokerName ?? null,
      }))
      : [],
  });
}

function findCtraderAccount(accounts, ctidTraderAccountId) {
  return Array.isArray(accounts)
    ? accounts.find((account) => String(account?.ctidTraderAccountId) === String(ctidTraderAccountId))
    : null;
}

function getCtraderAccountNumber(account) {
  return account?.accountNumber
    ?? account?.traderLogin
    ?? account?.login
    ?? account?.accountId
    ?? null;
}

function getDataDir(options = {}) {
  return options.dataDir || process.env.CTRADER_TOKEN_STORE_DIR || join(ROOT_DIR, '.data');
}

function getTokenStorePath(options = {}) {
  return options.tokenStorePath || join(getDataDir(options), 'ctrader-tokens.json');
}

function getRawDealsStorePath(options = {}) {
  return options.rawDealsStorePath || join(getDataDir(options), RAW_DEALS_FILE_NAME);
}

function parseTimestampQuery(value, fallback) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 2_147_483_646_000) {
    throw new Error('cTrader deal timestamp query values must be integer milliseconds from 0 through 2147483646000');
  }
  return parsed;
}

function parseIntegerQuery(value, fallback) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('cTrader deal query values for accountId and maxRows must be positive integers');
  }
  return parsed;
}

function getRequestOrigin(request) {
  const protocol = isSecureRequest(request) ? 'https' : 'http';
  return `${protocol}://${request.headers.host || `localhost:${PORT}`}`;
}

function isSecureRequest(request) {
  return request.headers['x-forwarded-proto'] === 'https';
}

function parseCookies(cookieHeader) {
  return Object.fromEntries(cookieHeader
    .split(';')
    .map((cookie) => cookie.trim())
    .filter(Boolean)
    .map((cookie) => {
      const separatorIndex = cookie.indexOf('=');
      if (separatorIndex === -1) {
        return [cookie, ''];
      }
      return [cookie.slice(0, separatorIndex), decodeURIComponent(cookie.slice(separatorIndex + 1))];
    }));
}

function serializeCookie(name, value, options = {}) {
  const segments = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) {
    segments.push(`Max-Age=${options.maxAge}`);
  }
  if (options.httpOnly) {
    segments.push('HttpOnly');
  }
  if (options.secure) {
    segments.push('Secure');
  }
  if (options.sameSite) {
    segments.push(`SameSite=${options.sameSite}`);
  }
  if (options.path) {
    segments.push(`Path=${options.path}`);
  }
  return segments.join('; ');
}


async function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

async function runDnaDoctorEndpoint(request, response, options = {}, fetchImpl = fetch) {
  const apiKey = options.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    sendJson(response, 500, { error: 'Anthropic API key is not configured on the server.' });
    return;
  }

  let payload;
  try {
    const body = await readRequestBody(request);
    payload = JSON.parse(body);
  } catch {
    sendJson(response, 400, { error: 'Invalid JSON payload.' });
    return;
  }

  if (!payload || typeof payload.tradeCount !== 'number') {
    sendJson(response, 400, { error: 'Invalid payload: tradeCount is required.' });
    return;
  }

  const systemPrompt = `You are DNA Doctor, a professional trading performance analyst.
Produce a concise, honest, data-driven trading diagnosis based ONLY on the statistics provided.
Never invent data. Never hallucinate. If data is missing or fewer than 10 trades exist, say so explicitly.
Write in professional language. Be direct and specific. Avoid generic advice.
Respond ONLY with valid JSON matching this exact schema — no markdown, no explanation outside the JSON:
{
  "score": number (0-100),
  "grade": "string (A+/A/B+/B/C+/C/D/F)",
  "scoreExplanation": "string — 1-2 sentences explaining the score",
  "diagnosis": "string — 2-4 sentence summary of this trader",
  "strengths": ["string"],
  "weaknesses": ["string"],
  "prescription": ["string"],
  "riskFactors": ["string"]
}`;

  const userPrompt = `Here are my trading statistics. Produce a DNA Doctor Report.

Total Trades: ${payload.tradeCount}
Win Rate: ${payload.winRate != null ? Number(payload.winRate).toFixed(1) + '%' : 'N/A'}
Total P&L: ${payload.totalPnl != null ? '$' + Number(payload.totalPnl).toFixed(2) : 'N/A'}
Average Winner: ${payload.averageWin != null ? '$' + Number(payload.averageWin).toFixed(2) : 'N/A'}
Average Loser: ${payload.averageLoss != null ? '$' + Number(payload.averageLoss).toFixed(2) : 'N/A'}
Average R: ${payload.averageR != null ? Number(payload.averageR).toFixed(2) + 'R' : 'N/A'}
Profit Factor: ${payload.profitFactor != null && isFinite(payload.profitFactor) ? Number(payload.profitFactor).toFixed(2) : 'N/A'}
Biggest Winner: ${payload.biggestWinner != null ? '$' + Number(payload.biggestWinner).toFixed(2) : 'N/A'}
Biggest Loser: ${payload.biggestLoser != null ? '$' + Number(payload.biggestLoser).toFixed(2) : 'N/A'}
Average Risk $: ${payload.averageRiskDollars != null ? '$' + Number(payload.averageRiskDollars).toFixed(2) : 'N/A'}
Average Risk %: ${payload.averageRiskPercent != null ? Number(payload.averageRiskPercent).toFixed(2) + '%' : 'N/A'}

By Asset:
${(payload.assets || []).map((a) => `${a.symbol}: ${a.trades} trades, ${Number(a.winRate).toFixed(1)}% WR, $${Number(a.netPnl).toFixed(2)} P&L, ${a.averageR != null ? Number(a.averageR).toFixed(2) + 'R' : 'N/A'} avg R`).join('\n') || 'No asset data'}

By Setup:
${(payload.setups || []).map((s) => `${s.name}: ${s.trades} trades, ${Number(s.winRate).toFixed(1)}% WR, $${Number(s.netPnl).toFixed(2)} P&L, ${s.averageR != null ? Number(s.averageR).toFixed(2) + 'R' : 'N/A'} avg R`).join('\n') || 'No setup data'}

By Trading Session:
${(payload.sessions || []).map((s) => `${s.session}: ${s.trades} trades, ${Number(s.winRate).toFixed(1)}% WR, $${Number(s.netPnl).toFixed(2)} P&L, PF ${s.profitFactor != null && isFinite(s.profitFactor) ? Number(s.profitFactor).toFixed(2) : 'N/A'}`).join('\n') || 'No session data'}`;

  const TIMEOUT_MS = 30_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const claudeResponse = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    clearTimeout(timeout);

    if (!claudeResponse.ok) {
      const err = await claudeResponse.json().catch(() => ({}));
      const msg = err.error?.message || `Claude API error ${claudeResponse.status}`;
      sendJson(response, 502, { error: msg });
      return;
    }

    const data = await claudeResponse.json();
    const text = data.content?.find((b) => b.type === 'text')?.text || '';
    console.log('[DNA Doctor] Raw Claude response length:', text.length, '| stop_reason:', data.stop_reason);

    // Strip markdown fences if present
    const clean = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

    let report;
    try {
      report = JSON.parse(clean);
    } catch (parseError) {
      console.error('[DNA Doctor] JSON parse failed:', parseError.message);
      console.error('[DNA Doctor] Raw text (first 500 chars):', text.slice(0, 500));
      sendJson(response, 502, {
        error: `Claude returned invalid JSON: ${parseError.message}`,
        rawResponse: text.slice(0, 1000),
      });
      return;
    }
    sendJson(response, 200, report);
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      sendJson(response, 504, { error: 'DNA Doctor timed out. Try again.' });
    } else {
      sendJson(response, 502, { error: `Claude unavailable: ${error.message}` });
    }
  }
}


function setCorsHeaders(response, options = {}) {
  const allowedOrigin = options.corsOrigin || process.env.JOURNAL_FRONTEND_ORIGIN || '*';
  response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function signState(encodedPayload, secret) {
  return base64Url(createHmac('sha256', secret).update(encodedPayload).digest());
}

function timingSafeStringEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createAppServer().listen(PORT, () => {
    console.log(`Trading journal backend listening on http://localhost:${PORT}`);
  });
}
