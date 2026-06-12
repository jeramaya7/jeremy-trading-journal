import { createHmac, randomBytes, scryptSync, createCipheriv, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT) || 5173;
const ROOT_DIR = join(fileURLToPath(new URL('..', import.meta.url)));
const DATA_DIR = process.env.CTRADER_TOKEN_STORE_DIR || join(ROOT_DIR, '.data');
const TOKEN_STORE_PATH = join(DATA_DIR, 'ctrader-tokens.json');
const CTRADER_AUTHORIZE_URL = 'https://id.ctrader.com/my/settings/openapi/grantingaccess/';
const CTRADER_TOKEN_URL = 'https://openapi.ctrader.com/apps/token';
const STATE_COOKIE_NAME = 'ctrader_oauth_state';
const STATE_TTL_MS = 10 * 60 * 1000;

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

export function createAppServer() {
  return createServer(async (request, response) => {
    const url = new URL(request.url || '/', getRequestOrigin(request));

    if (request.method === 'GET' && url.pathname === '/auth/ctrader/start') {
      await startCtraderAuth(request, response);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/auth/ctrader/callback') {
      await completeCtraderAuth(request, response, url);
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

export function createSignedState(config, now = Date.now()) {
  const payload = {
    nonce: base64Url(randomBytes(24)),
    environment: config.environment,
    expiresAt: now + STATE_TTL_MS,
  };
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = signState(encodedPayload, config.encryptionSecret);
  return `${encodedPayload}.${signature}`;
}

export function verifySignedState(state, expectedEnvironment, secret, now = Date.now()) {
  const [encodedPayload, signature] = String(state || '').split('.');
  if (!encodedPayload || !signature) {
    return false;
  }

  const expectedSignature = signState(encodedPayload, secret);
  if (!timingSafeStringEqual(signature, expectedSignature)) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    return payload.environment === expectedEnvironment && Number(payload.expiresAt) > now;
  } catch {
    return false;
  }
}

export async function exchangeAuthorizationCode(config, code, fetchImpl = fetch) {
  const tokenUrl = new URL(CTRADER_TOKEN_URL);
  tokenUrl.searchParams.set('grant_type', 'authorization_code');
  tokenUrl.searchParams.set('code', code);
  tokenUrl.searchParams.set('redirect_uri', config.redirectUri);
  tokenUrl.searchParams.set('client_id', config.clientId);
  tokenUrl.searchParams.set('client_secret', config.clientSecret);

  const tokenResponse = await fetchImpl(tokenUrl, { method: 'GET' });
  const responseBody = await tokenResponse.json();
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

export async function storeEncryptedTokens(config, tokens) {
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

  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const tempPath = `${TOKEN_STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(tokenRecord, null, 2)}\n`, { mode: 0o600 });
  await rename(tempPath, TOKEN_STORE_PATH);
  return tokenRecord;
}

async function startCtraderAuth(request, response) {
  const config = getCtraderConfig();
  if (!config.ok) {
    sendConfigurationError(response, config);
    return;
  }

  const state = createSignedState(config);
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

async function completeCtraderAuth(request, response, url) {
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

  if (!state || state !== stateCookie || !verifySignedState(state, config.environment, config.encryptionSecret)) {
    sendJson(response, 400, { error: 'Invalid or expired cTrader OAuth state' });
    return;
  }

  try {
    const tokens = await exchangeAuthorizationCode(config, code);
    const tokenRecord = await storeEncryptedTokens(config, tokens);
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Set-Cookie': serializeCookie(STATE_COOKIE_NAME, '', {
        httpOnly: true,
        maxAge: 0,
        sameSite: 'Lax',
        secure: isSecureRequest(request),
        path: '/auth/ctrader',
      }),
    });
    response.end(`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>cTrader connected</title></head>
  <body>
    <h1>cTrader connected</h1>
    <p>Tokens were stored securely for the ${escapeHtml(tokenRecord.environment)} environment.</p>
    <p>Trade sync is not implemented yet.</p>
    <p><a href="/">Return to the journal</a></p>
  </body>
</html>`);
  } catch (error) {
    sendJson(response, 502, { error: error.message });
  }
}

async function serveStaticFile(response, pathname) {
  const normalizedPath = pathname === '/' ? '/index.html' : pathname;
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
