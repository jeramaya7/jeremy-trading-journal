import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  buildCtraderAuthorizeUrl,
  createSignedState,
  encryptTokenPayload,
  exchangeAuthorizationCode,
  getCtraderConfig,
  getVerifiedSignedStatePayload,
  normalizeTokenResponse,
  verifySignedState,
} from '../src/server.js';

const validEnv = {
  CTRADER_CLIENT_ID: 'client-id',
  CTRADER_CLIENT_SECRET: 'client-secret',
  CTRADER_REDIRECT_URI: 'http://localhost:5173/auth/ctrader/callback',
  CTRADER_ENVIRONMENT: 'demo',
};

test('cTrader config requires the documented environment variables', () => {
  const config = getCtraderConfig({});

  assert.equal(config.ok, false);
  assert.deepEqual(config.missing, [
    'CTRADER_CLIENT_ID',
    'CTRADER_CLIENT_SECRET',
    'CTRADER_REDIRECT_URI',
    'CTRADER_ENVIRONMENT',
  ]);
});

test('cTrader config accepts demo and live environments only', () => {
  assert.equal(getCtraderConfig(validEnv).ok, true);
  assert.equal(getCtraderConfig({ ...validEnv, CTRADER_ENVIRONMENT: 'live' }).ok, true);

  const config = getCtraderConfig({ ...validEnv, CTRADER_ENVIRONMENT: 'paper' });
  assert.equal(config.ok, false);
  assert.equal(config.invalidEnvironment, 'paper');
});

test('authorization URL uses cTrader OAuth account access scope', () => {
  const config = getCtraderConfig(validEnv);
  const authorizationUrl = buildCtraderAuthorizeUrl(config, 'state-value');

  assert.equal(authorizationUrl.origin, 'https://id.ctrader.com');
  assert.equal(authorizationUrl.searchParams.get('client_id'), validEnv.CTRADER_CLIENT_ID);
  assert.equal(authorizationUrl.searchParams.get('redirect_uri'), validEnv.CTRADER_REDIRECT_URI);
  assert.equal(authorizationUrl.searchParams.get('scope'), 'accounts');
  assert.equal(authorizationUrl.searchParams.get('product'), 'web');
  assert.equal(authorizationUrl.searchParams.get('state'), 'state-value');
});

test('OAuth state is signed, environment-bound, and expires', () => {
  const config = getCtraderConfig(validEnv);
  const state = createSignedState(config, 1_000);

  assert.equal(verifySignedState(state, 'demo', config.encryptionSecret, 1_100), true);
  assert.equal(verifySignedState(state, 'live', config.encryptionSecret, 1_100), false);
  assert.equal(verifySignedState(state, 'demo', 'wrong-secret', 1_100), false);
  assert.equal(verifySignedState(state, 'demo', config.encryptionSecret, 1_000 + 10 * 60 * 1000 + 1), false);
});

test('OAuth state can carry a frontend return URL for post-authorization status checks', () => {
  const config = getCtraderConfig(validEnv);
  const state = createSignedState(config, 1_000, { returnTo: 'https://jeramaya7.github.io/jeremy-trading-journal/?ctrader=connected' });
  const payload = getVerifiedSignedStatePayload(state, 'demo', config.encryptionSecret, 1_100);

  assert.equal(payload.returnTo, 'https://jeramaya7.github.io/jeremy-trading-journal/?ctrader=connected');
});

test('token exchange calls cTrader token endpoint with authorization code grant', async () => {
  const config = getCtraderConfig(validEnv);
  let requestedUrl;
  const tokens = await exchangeAuthorizationCode(config, 'auth-code', async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      async json() {
        return {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          tokenType: 'Bearer',
          expiresIn: 100,
        };
      },
    };
  });

  assert.equal(requestedUrl.origin, 'https://openapi.ctrader.com');
  assert.equal(requestedUrl.pathname, '/apps/token');
  assert.equal(requestedUrl.searchParams.get('grant_type'), 'authorization_code');
  assert.equal(requestedUrl.searchParams.get('code'), 'auth-code');
  assert.equal(requestedUrl.searchParams.get('redirect_uri'), validEnv.CTRADER_REDIRECT_URI);
  assert.equal(requestedUrl.searchParams.get('client_id'), validEnv.CTRADER_CLIENT_ID);
  assert.equal(requestedUrl.searchParams.get('client_secret'), validEnv.CTRADER_CLIENT_SECRET);
  assert.equal(tokens.accessToken, 'access-token');
  assert.equal(tokens.refreshToken, 'refresh-token');
});

test('token response normalization supports cTrader camelCase and OAuth snake_case fields', () => {
  assert.deepEqual(normalizeTokenResponse({
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    token_type: 'Bearer',
    expires_in: '123',
  }), {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    tokenType: 'Bearer',
    expiresIn: 123,
    raw: {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      token_type: 'Bearer',
      expires_in: '123',
    },
  });
});

test('encrypted token payload does not store token plaintext', () => {
  const encrypted = encryptTokenPayload({ accessToken: 'secret-access', refreshToken: 'secret-refresh' }, 'encryption-secret');
  const serialized = JSON.stringify(encrypted);

  assert.equal(encrypted.algorithm, 'aes-256-gcm');
  assert.equal(serialized.includes('secret-access'), false);
  assert.equal(serialized.includes('secret-refresh'), false);
  assert.notEqual(createHash('sha256').update(encrypted.ciphertext).digest('hex').length, 0);
});
