const BACKEND_BASE_URL_GLOBAL = 'JEREMY_TRADING_JOURNAL_BACKEND_URL';
const BACKEND_BASE_URL_STORAGE_KEY = 'jeremy-trading-journal:backend-base-url:v1';

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
    return normalizeBackendBaseUrl(runtime?.localStorage?.getItem(BACKEND_BASE_URL_STORAGE_KEY));
  } catch {
    return '';
  }
}

export function isGitHubPagesHost(hostname) {
  return String(hostname || '').toLowerCase().endsWith('.github.io');
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
  if (!configuredBaseUrl) {
    return path;
  }

  return new URL(path, `${configuredBaseUrl}/`).toString();
}

export async function fetchBackendJson(path, options = {}) {
  const runtime = options.runtime || globalThis;
  const fetchImpl = options.fetchImpl || runtime.fetch;
  const deploymentHint = getBackendDeploymentHint(runtime);
  const url = buildBackendUrl(path, runtime);

  if (deploymentHint) {
    throw new BackendUnavailableError(deploymentHint, { url });
  }

  if (typeof fetchImpl !== 'function') {
    throw new BackendUnavailableError('This browser cannot contact the cTrader backend because fetch is unavailable.', { url });
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
      `The cTrader backend is unavailable at ${url}. Deploy the Node backend and configure the journal to use its public URL.`,
      { url, cause: error },
    );
  }

  const contentType = response.headers?.get?.('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new BackendUnavailableError(
      `The cTrader backend did not return JSON from ${url}. If this is GitHub Pages, deploy the Node backend separately and set window.JEREMY_TRADING_JOURNAL_BACKEND_URL to its URL.`,
      { status: response.status, contentType, url },
    );
  }

  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new BackendUnavailableError(
      `The cTrader backend returned invalid JSON from ${url}. Check the deployed Node backend logs.`,
      { status: response.status, contentType, url, cause: error },
    );
  }

  return { response, body, url };
}
