const BACKEND_BASE_URL_GLOBAL = 'JEREMY_TRADING_JOURNAL_BACKEND_URL';
const BACKEND_BASE_URL_STORAGE_KEY = 'jeremy-trading-journal:backend-base-url:v1';

export const DEFAULT_BACKEND_BASE_URL = 'https://jeremy-trading-journal.onrender.com';
const HTML_PREVIEW_LENGTH = 120;

export const CTRADER_ENDPOINTS = Object.freeze({
  status: '/api/ctrader/status',
  journalPreview: '/api/ctrader/journal-preview',
  deals: '/api/ctrader/deals',
  authStart: '/auth/ctrader/start',
  authCallback: '/auth/ctrader/callback',
});

export class BackendUnavailableError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'BackendUnavailableError';
    this.status = options.status;
    this.contentType = options.contentType;
    this.url = options.url;
    this.bodyPreview = options.bodyPreview;
    this.cause = options.cause;
  }
}

export function normalizeBackendBaseUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }

  return trimmed.replace(/\/+$/, '');
}

export function getConfiguredBackendBaseUrl(runtime = globalThis) {
  const explicitGlobal = normalizeBackendBaseUrl(runtime?.[BACKEND_BASE_URL_GLOBAL]);
  if (explicitGlobal) {
    return explicitGlobal;
  }

  try {
    const storedBaseUrl = normalizeBackendBaseUrl(runtime?.localStorage?.getItem(BACKEND_BASE_URL_STORAGE_KEY));
    if (storedBaseUrl) {
      return storedBaseUrl;
    }
  } catch {
    // Ignore inaccessible localStorage and fall back to the production backend.
  }

  return DEFAULT_BACKEND_BASE_URL;
}

export function isGitHubPagesHost(hostname) {
  return String(hostname || '').toLowerCase().endsWith('.github.io');
}

export function resolveRuntimeUrl(path, runtime = globalThis) {
  try {
    return new URL(path, runtime?.location?.href || runtime?.location?.origin || 'http://localhost/').toString();
  } catch {
    return path;
  }
}

export function getBackendDeploymentHint(runtime = globalThis) {
  const configuredBaseUrl = getConfiguredBackendBaseUrl(runtime);
  if (configuredBaseUrl) {
    return '';
  }

  if (isGitHubPagesHost(runtime?.location?.hostname)) {
    return 'This GitHub Pages site only hosts the static journal. cTrader sync needs the Node backend deployed separately and configured with window.JEREMY_TRADING_JOURNAL_BACKEND_URL.';
  }

  return '';
}

export function buildBackendUrl(path, runtime = globalThis) {
  const configuredBaseUrl = getConfiguredBackendBaseUrl(runtime);
  return new URL(path, `${configuredBaseUrl}/`).toString();
}

export function getBackendDiagnostics(runtime = globalThis) {
  const configuredBaseUrl = getConfiguredBackendBaseUrl(runtime);
  const statusUrl = buildBackendUrl(CTRADER_ENDPOINTS.status, runtime);
  const absoluteStatusUrl = resolveRuntimeUrl(statusUrl, runtime);
  const origin = runtime?.location?.origin || '';

  return {
    configured: Boolean(configuredBaseUrl),
    backendUrl: configuredBaseUrl || (origin ? `${origin} (same origin fallback)` : 'Not configured'),
    statusUrl: absoluteStatusUrl,
    connectionStatus: configuredBaseUrl || !getBackendDeploymentHint(runtime) ? 'Not checked' : 'Not configured',
    deploymentHint: getBackendDeploymentHint(runtime),
  };
}

function previewResponseBody(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, HTML_PREVIEW_LENGTH);
}

async function readResponseText(response) {
  if (typeof response.text === 'function') {
    return response.text();
  }

  return '';
}

export async function fetchBackendJson(path, options = {}) {
  const runtime = options.runtime || globalThis;
  const fetchImpl = options.fetchImpl || runtime.fetch;
  const deploymentHint = getBackendDeploymentHint(runtime);
  const url = buildBackendUrl(path, runtime);
  const displayUrl = resolveRuntimeUrl(url, runtime);

  if (deploymentHint) {
    throw new BackendUnavailableError(`${deploymentHint} The skipped fetch URL was ${displayUrl}.`, { url: displayUrl });
  }

  if (typeof fetchImpl !== 'function') {
    throw new BackendUnavailableError('This browser cannot contact the cTrader backend because fetch is unavailable.', { url: displayUrl });
  }

  let response;
  try {
    response = await fetchImpl(url, {
      ...options.fetchOptions,
      headers: {
        Accept: 'application/json',
        ...options.fetchOptions?.headers,
      },
    });
  } catch (error) {
    throw new BackendUnavailableError(
      `The cTrader backend is unavailable at ${displayUrl}. Confirm the Render backend is reachable or configure the journal with another public backend URL.`,
      { url: displayUrl, cause: error },
    );
  }

  const contentType = response.headers?.get?.('content-type') || '';
  const isJsonResponse = contentType.toLowerCase().includes('application/json');
  const responseText = await readResponseText(response);
  const bodyPreview = previewResponseBody(responseText);

  if (!isJsonResponse) {
    throw new BackendUnavailableError(
      `The cTrader backend did not return JSON from ${displayUrl} (HTTP ${response.status || 'unknown'}, Content-Type: ${contentType || 'unknown'}). This endpoint is returning ${bodyPreview.startsWith('<!DOCTYPE') || bodyPreview.startsWith('<html') ? 'HTML' : 'non-JSON'} instead of the Node API response. Confirm the Render backend is reachable or set window.JEREMY_TRADING_JOURNAL_BACKEND_URL to another public backend URL.`,
      { status: response.status, contentType, url: displayUrl, bodyPreview },
    );
  }

  let body;
  try {
    if (responseText || typeof response.json !== 'function') {
      body = JSON.parse(responseText);
    } else {
      body = await response.json();
    }
  } catch (error) {
    throw new BackendUnavailableError(
      `The cTrader backend returned invalid JSON from ${displayUrl} (HTTP ${response.status || 'unknown'}, Content-Type: ${contentType || 'unknown'}). Check the deployed Node backend logs.`,
      { status: response.status, contentType, url: displayUrl, bodyPreview, cause: error },
    );
  }

  return { response, body, url: displayUrl };
}
