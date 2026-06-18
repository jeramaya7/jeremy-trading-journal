import { applyCTraderImportedTradeUpdates, buildCTraderSyncPlan, getImportedTradeSourceKey } from './ctrader-sync.js';
import { CTRADER_ENDPOINTS, buildCTraderOAuthUrl, fetchBackendJson, getBackendDiagnostics } from './backend-api.js';

const STORAGE_KEY = 'jeremy-trading-journal:v1';
const AUTO_SYNC_STORAGE_KEY = 'jeremy-trading-journal:ctrader-auto-sync:v1';
const LAST_SYNC_STORAGE_KEY = 'jeremy-trading-journal:ctrader-last-sync:v1';
const SELECTED_CTRADER_ACCOUNT_STORAGE_KEY = 'jeremy-trading-journal:ctrader-selected-account:v1';
const DELETED_CTRADER_SOURCE_KEYS_STORAGE_KEY = 'deletedCTraderSourceKeys';
const AUTO_SYNC_INTERVAL_MS = 60 * 1000;

const starterTrades = [
  {
    id: 'sample-1',
    date: '2026-06-03',
    symbol: 'AAPL',
    direction: 'Long',
    setup: 'Opening range breakout',
    entry: 198.42,
    exit: 201.1,
    size: 50,
    stopLoss: 196.9,
    accountSize: 25000,
    riskPercent: 0.3,
    fees: 2,
    emotion: 'Patient',
    tags: 'breakout, large-cap',
    notes: 'Waited for a clean retest of the opening range before entering.',
  },
  {
    id: 'sample-2',
    date: '2026-06-05',
    symbol: 'TSLA',
    direction: 'Short',
    setup: 'Failed VWAP reclaim',
    entry: 179.25,
    exit: 176.8,
    size: 30,
    stopLoss: 181.15,
    accountSize: 25000,
    riskPercent: 0.23,
    fees: 2.5,
    emotion: 'Focused',
    tags: 'vwap, momentum',
    notes: 'Covered into the first flush instead of getting greedy.',
  },
  {
    id: 'sample-3',
    date: '2026-06-08',
    symbol: 'NVDA',
    direction: 'Long',
    setup: 'Pullback to 20 EMA',
    entry: 145.7,
    exit: 143.9,
    size: 25,
    stopLoss: 144.5,
    accountSize: 25000,
    riskPercent: 0.12,
    fees: 1.5,
    emotion: 'Impatient',
    tags: 'pullback, lesson',
    notes: 'Entered before confirmation. Need the candle to close above the trigger level.',
  },
];

let trades = loadTrades();
let searchQuery = '';
let selectedScreenshot = null;
let pastedScreenshotFile = null;
let isPasteListenerBound = false;
let cTraderSyncStatus = null;
let isSyncingCTrader = false;
let isCheckingCTraderConnection = false;
let isCTraderAutoSyncEnabled = loadCTraderAutoSyncSetting();
let cTraderLastSyncAt = loadCTraderLastSyncTime();
let cTraderAutoSyncTimer = null;
let cTraderBackendDiagnostics = getCTraderBackendDiagnostics();
let cTraderAccounts = [];
let cTraderAccountBalance = null;
let selectedCTraderAccountId = loadSelectedCTraderAccountId();
let isLoadingCTraderAccounts = false;
let hasHandledCTraderOAuthReturn = false;
let editingTradeId = null;

const app = document.querySelector('#root');

function loadTrades() {
  const savedTrades = window.localStorage.getItem(STORAGE_KEY);
  if (!savedTrades) {
    return starterTrades;
  }

  const parsedTrades = JSON.parse(savedTrades);
  return Array.isArray(parsedTrades) ? parsedTrades : starterTrades;
}

function persistTrades(nextTrades) {
  trades = nextTrades;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
  render();
}

function loadCTraderAutoSyncSetting() {
  return window.localStorage.getItem(AUTO_SYNC_STORAGE_KEY) !== 'off';
}

function persistCTraderAutoSyncSetting(isEnabled) {
  isCTraderAutoSyncEnabled = isEnabled;
  window.localStorage.setItem(AUTO_SYNC_STORAGE_KEY, isEnabled ? 'on' : 'off');
  scheduleCTraderAutoSync();
  render();
}

function loadCTraderLastSyncTime() {
  const savedSyncTime = window.localStorage.getItem(LAST_SYNC_STORAGE_KEY);
  return savedSyncTime ? String(savedSyncTime) : null;
}

function persistCTraderLastSyncTime(syncTime) {
  cTraderLastSyncAt = syncTime;
  window.localStorage.setItem(LAST_SYNC_STORAGE_KEY, syncTime);
}

function loadSelectedCTraderAccountId() {
  const savedAccountId = window.localStorage.getItem(SELECTED_CTRADER_ACCOUNT_STORAGE_KEY);
  return savedAccountId ? String(savedAccountId) : '';
}

function persistSelectedCTraderAccountId(accountId) {
  selectedCTraderAccountId = accountId ? String(accountId) : '';
  if (selectedCTraderAccountId) {
    window.localStorage.setItem(SELECTED_CTRADER_ACCOUNT_STORAGE_KEY, selectedCTraderAccountId);
  } else {
    window.localStorage.removeItem(SELECTED_CTRADER_ACCOUNT_STORAGE_KEY);
  }
}

function loadDeletedCTraderSourceKeys() {
  const savedSourceKeys = window.localStorage.getItem(DELETED_CTRADER_SOURCE_KEYS_STORAGE_KEY);
  if (!savedSourceKeys) {
    return new Set();
  }

  try {
    const parsedSourceKeys = JSON.parse(savedSourceKeys);
    return new Set(Array.isArray(parsedSourceKeys) ? parsedSourceKeys.map(String) : []);
  } catch (error) {
    console.warn('[cTrader sync] Could not read deleted cTrader source keys.', error);
    return new Set();
  }
}

function persistDeletedCTraderSourceKeys(sourceKeys) {
  window.localStorage.setItem(DELETED_CTRADER_SOURCE_KEYS_STORAGE_KEY, JSON.stringify([...sourceKeys].sort()));
}

function rememberDeletedCTraderSourceKey(trade) {
  const sourceKey = getImportedTradeSourceKey(trade);
  if (!sourceKey) {
    return;
  }

  const deletedSourceKeys = loadDeletedCTraderSourceKeys();
  deletedSourceKeys.add(sourceKey);
  persistDeletedCTraderSourceKeys(deletedSourceKeys);
}

function rememberDeletedCTraderSourceKeys(deletedTrades) {
  const deletedSourceKeys = loadDeletedCTraderSourceKeys();
  let hasNewSourceKey = false;

  deletedTrades.forEach((trade) => {
    const sourceKey = getImportedTradeSourceKey(trade);
    if (sourceKey && !deletedSourceKeys.has(sourceKey)) {
      deletedSourceKeys.add(sourceKey);
      hasNewSourceKey = true;
    }
  });

  if (hasNewSourceKey) {
    persistDeletedCTraderSourceKeys(deletedSourceKeys);
  }
}

function currency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function toOptionalNumber(value) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatPercent(value) {
  return value === null || value === undefined ? '—' : `${value.toFixed(2)}%`;
}

function formatRMultiple(value) {
  return value === null || value === undefined ? '—' : `${value.toFixed(2)}R`;
}

function formatSyncTime(value) {
  if (!value) {
    return 'Never';
  }

  const syncDate = new Date(value);
  if (Number.isNaN(syncDate.getTime())) {
    return 'Never';
  }

  return syncDate.toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}


function formatTradeTimestamp(value) {
  if (!value) {
    return '—';
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return '—';
  }

  return timestamp.toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatTradeDuration(openTime, closeTime) {
  const openTimestamp = Date.parse(openTime || '');
  const closeTimestamp = Date.parse(closeTime || '');
  if (!Number.isFinite(openTimestamp) || !Number.isFinite(closeTimestamp) || closeTimestamp < openTimestamp) {
    return '—';
  }

  const totalMinutes = Math.round((closeTimestamp - openTimestamp) / (60 * 1000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];

  if (days) {
    parts.push(`${days}d`);
  }
  if (hours) {
    parts.push(`${hours}h`);
  }
  if (minutes || !parts.length) {
    parts.push(`${minutes}m`);
  }

  return parts.join(' ');
}

function cTraderTimeDetails(trade) {
  if (!isCTraderImportedTrade(trade)) {
    return '';
  }

  return `
        <span>Opened: ${escapeHtml(formatTradeTimestamp(trade.openTime))}</span>
        <span>Closed: ${escapeHtml(formatTradeTimestamp(trade.closeTime))}</span>
        <span>Duration: ${escapeHtml(formatTradeDuration(trade.openTime, trade.closeTime))}</span>`;
}

function calculateRiskDollars(trade) {
  const entry = toOptionalNumber(trade.entry);
  const stopLoss = toOptionalNumber(trade.stopLoss);
  const size = toOptionalNumber(trade.size);

  if (entry === null || stopLoss === null || size === null) {
    return null;
  }

  const riskDollars = Math.abs(entry - stopLoss) * size;
  return riskDollars > 0 ? riskDollars : null;
}

function calculateRiskPercent(trade) {
  const riskDollars = calculateRiskDollars(trade);
  const accountBalance = toOptionalNumber(trade.accountBalance);
  const accountSize = toOptionalNumber(trade.accountSize) ?? accountBalance;

  if (riskDollars === null || accountSize === null || accountSize <= 0) {
    return null;
  }

  return (riskDollars / accountSize) * 100;
}

function calculateRMultiple(trade) {
  const riskDollars = calculateRiskDollars(trade);
  if (riskDollars === null) {
    return null;
  }

  return calculatePnl(trade) / riskDollars;
}

function calculatePnl(trade) {
  const importedNetProfitLoss = toOptionalNumber(trade.netProfitLoss);
  if (isCTraderImportedTrade(trade) && importedNetProfitLoss !== null) {
    return importedNetProfitLoss;
  }

  const entry = Number(trade.entry) || 0;
  const exit = Number(trade.exit) || 0;
  const size = Number(trade.size) || 0;
  const fees = Number(trade.fees) || 0;
  const gross = trade.direction === 'Short' ? (entry - exit) * size : (exit - entry) * size;
  return gross - fees;
}

function getReportPeriodStart(referenceDate, period) {
  const periodStart = new Date(referenceDate);
  periodStart.setHours(0, 0, 0, 0);

  if (period === 'week') {
    const dayOfWeek = periodStart.getDay();
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    periodStart.setDate(periodStart.getDate() - daysSinceMonday);
  }

  if (period === 'month') {
    periodStart.setDate(1);
  }

  return periodStart;
}

function getTradeReportDate(trade) {
  const dateValue = trade.closeTime || trade.date;
  const tradeDate = new Date(dateValue);
  return Number.isNaN(tradeDate.getTime()) ? null : tradeDate;
}

function calculatePnlForPeriod(tradeList, period, referenceDate = new Date()) {
  const periodStart = getReportPeriodStart(referenceDate, period);
  const periodEnd = new Date(referenceDate);
  periodEnd.setHours(23, 59, 59, 999);

  return tradeList.reduce((report, trade) => {
    const tradeDate = getTradeReportDate(trade);
    if (!tradeDate || tradeDate < periodStart || tradeDate > periodEnd) {
      return report;
    }

    return {
      pnl: report.pnl + calculatePnl(trade),
      tradeCount: report.tradeCount + 1,
    };
  }, { pnl: 0, tradeCount: 0 });
}

function getPnlReports(referenceDate = new Date()) {
  return [
    { label: 'Daily P&L', period: 'day', ...calculatePnlForPeriod(trades, 'day', referenceDate) },
    { label: 'Weekly P&L', period: 'week', ...calculatePnlForPeriod(trades, 'week', referenceDate) },
    { label: 'Monthly P&L', period: 'month', ...calculatePnlForPeriod(trades, 'month', referenceDate) },
  ];
}

function getStats() {
  const pnlValues = trades.map(calculatePnl);
  const rValues = trades.map(calculateRMultiple).filter((value) => value !== null);
  const wins = pnlValues.filter((value) => value > 0);
  const losses = pnlValues.filter((value) => value < 0);
  const totalPnl = pnlValues.reduce((sum, value) => sum + value, 0);
  const averageWin = wins.length ? wins.reduce((sum, value) => sum + value, 0) / wins.length : 0;
  const averageLoss = losses.length ? losses.reduce((sum, value) => sum + value, 0) / losses.length : 0;
  const totalR = rValues.reduce((sum, value) => sum + value, 0);
  const averageR = rValues.length ? totalR / rValues.length : null;

  return {
    totalPnl,
    winRate: trades.length ? Math.round((wins.length / trades.length) * 100) : 0,
    tradeCount: trades.length,
    averageWin,
    averageLoss,
    totalR: rValues.length ? totalR : null,
    averageR,
  };
}

function getFilteredTrades() {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  if (!normalizedQuery) {
    return trades;
  }

  return trades.filter((trade) => {
    return [trade.symbol, trade.setup, trade.direction, trade.emotion, trade.tags, trade.notes]
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery);
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function icon(name) {
  const icons = {
    book: '<svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z"/></svg>',
    download: '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>',
    upload: '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>',
    trend: '<svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>',
    target: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
    chart: '<svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M7 16V8"/><path d="M12 16V5"/><path d="M17 16v-3"/></svg>',
    line: '<svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M7 14l3-3 4 4 5-8"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
    calendar: '<svg viewBox="0 0 24 24"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
    image: '<svg viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>',
    refresh: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    save: '<svg viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>',
  };
  return icons[name] ?? '';
}

function statCard(iconName, label, value, tone = '') {
  return `
    <article class="stat-card">
      <div class="stat-icon">${icon(iconName)}</div>
      <span>${label}</span>
      <strong class="${tone}">${value}</strong>
    </article>
  `;
}


function reportCard(report) {
  const tone = report.pnl >= 0 ? 'positive' : 'negative';
  const tradeLabel = report.tradeCount === 1 ? 'trade' : 'trades';

  return `
    <article class="report-card">
      <div class="report-card-header">
        <div class="stat-icon">${icon('calendar')}</div>
        <div>
          <span>${report.label}</span>
          <small>${report.tradeCount} ${tradeLabel} closed</small>
        </div>
      </div>
      <strong class="${tone}">${currency(report.pnl)}</strong>
    </article>
  `;
}

function screenshotLink(screenshot, label) {
  if (!screenshot?.dataUrl) {
    return '';
  }

  const safeLabel = escapeHtml(label);
  const altText = escapeHtml(screenshot.name || `${label} screenshot`);
  return `
    <a class="screenshot-link" href="${escapeHtml(screenshot.dataUrl)}" target="_blank" rel="noreferrer" aria-label="Open full-size screenshot for ${safeLabel}">
      <img class="screenshot-thumbnail" src="${escapeHtml(screenshot.dataUrl)}" alt="${altText}" loading="lazy" />
      <span>Open full-size chart</span>
    </a>
  `;
}

function screenshotPreview(trade) {
  return screenshotLink(trade.screenshot, trade.symbol);
}

function tradeCard(trade) {
  const displaySymbol = getTradeDisplaySymbol(trade);
  const pnl = calculatePnl(trade);
  const stopLoss = toOptionalNumber(trade.stopLoss);
  const riskDollars = calculateRiskDollars(trade);
  const riskPercent = calculateRiskPercent(trade);
  const rMultiple = calculateRMultiple(trade);
  const tone = pnl >= 0 ? 'positive' : 'negative';
  const rTone = rMultiple === null || rMultiple >= 0 ? 'positive' : 'negative';
  const importedTimeDetail = cTraderTimeDetails(trade);
  const emotionDetail = isCTraderImportedTrade(trade) ? '' : `<span>Emotion: ${escapeHtml(trade.emotion)}</span>`;
  const isEditing = editingTradeId === trade.id;
  return `
    <article class="trade-card">
      <div class="trade-card-header">
        <div>
          <p class="trade-symbol">${escapeHtml(displaySymbol)}</p>
          <p class="trade-meta">${escapeHtml(trade.date)} • ${escapeHtml(trade.direction)} • ${escapeHtml(trade.setup)}</p>
        </div>
        <strong class="${tone}">${currency(pnl)}</strong>
      </div>
      <div class="trade-details">
        <span>Entry: ${currency(Number(trade.entry))}</span>
        <span>Exit: ${currency(Number(trade.exit))}</span>
        <span>Size: ${escapeHtml(trade.size)}</span>
        <span>Stop Loss: ${stopLoss === null ? '—' : currency(stopLoss)}</span>
        <span>Risk $: ${riskDollars === null ? '—' : currency(riskDollars)}</span>
        <span>Risk %: ${formatPercent(riskPercent)}</span>
        <span class="${rTone}">R: ${formatRMultiple(rMultiple)}</span>
        ${importedTimeDetail}
        ${emotionDetail}
      </div>
      ${isEditing ? editTradeForm(trade) : tradeJournalDetails(trade)}
      ${!isEditing ? screenshotPreview(trade) : ''}
      <div class="trade-card-actions">
        ${isEditing ? '' : `<button class="edit-button" type="button" data-edit-trade="${escapeHtml(trade.id)}" aria-label="Edit journaling fields for ${escapeHtml(displaySymbol)} trade">${icon('edit')} Edit</button>`}
        <button class="icon-button" type="button" data-delete-trade="${escapeHtml(trade.id)}" aria-label="Delete ${escapeHtml(trade.symbol)} trade">
          ${icon('trash')} Delete
        </button>
      </div>
    </article>
  `;
}

function tradeJournalDetails(trade) {
  return `
      ${isCTraderImportedTrade(trade) && trade.emotion ? `<p class="journal-detail"><strong>Emotion:</strong> ${escapeHtml(trade.emotion)}</p>` : ''}
      ${trade.tags ? `<p class="tags">${escapeHtml(trade.tags)}</p>` : ''}
      ${trade.notes ? `<p class="notes">${escapeHtml(trade.notes)}</p>` : ''}`;
}

function editTradeForm(trade) {
  return `
      <form class="edit-trade-form" data-edit-trade-form="${escapeHtml(trade.id)}">
        <div class="form-grid">
          ${field('Setup', `<input name="setup" value="${escapeHtml(trade.setup)}" placeholder="Breakout, pullback, VWAP..." />`)}
          ${field('Emotion', `<input name="emotion" value="${escapeHtml(trade.emotion)}" placeholder="Calm, FOMO, patient..." />`)}
          ${field('Tags', `<input name="tags" value="${escapeHtml(trade.tags)}" placeholder="gap, reversal, A+" />`)}
        </div>
        ${field('Notes', `<textarea name="notes" rows="5" placeholder="What was the plan? What happened? What will you repeat or avoid?">${escapeHtml(trade.notes)}</textarea>`)}
        <p class="edit-import-note">Imported cTrader execution fields are read-only and will be preserved when journaling edits are saved.</p>
        <div class="edit-form-actions">
          <button class="primary-button" type="submit">${icon('save')} Save edits</button>
          <button class="secondary-button" type="button" data-cancel-edit-trade="${escapeHtml(trade.id)}">Cancel</button>
        </div>
      </form>`;
}

function getTradeDisplaySymbol(trade) {
  if (!isCTraderImportedTrade(trade)) {
    return trade.symbol;
  }

  return firstReadableTradeSymbol(
    trade.brokerSymbol,
    trade.symbolName,
    trade.displaySymbol,
    trade.symbol,
  ) || trade.symbol;
}

function firstReadableTradeSymbol(...values) {
  return values
    .map((value) => (value === undefined || value === null ? '' : String(value).trim()))
    .find((value) => value && !/^\d+$/.test(value)) || null;
}

function isCTraderImportedTrade(trade) {
  return trade?.provider === 'ctrader' || String(trade?.tags || '').toLowerCase().includes('ctrader');
}

function render() {
  const stats = getStats();
  const pnlReports = getPnlReports();
  const filteredTrades = getFilteredTrades();
  const today = new Date().toISOString().slice(0, 10);

  app.innerHTML = `
    <main class="app-shell">
      <section class="hero-card">
        <div>
          <p class="eyebrow">${icon('book')} Jeremy Trading Journal</p>
          <h1>Track every setup, decision, and lesson.</h1>
          <p class="hero-copy">
            A fast local-first journal for logging trades, reviewing performance, and building disciplined repeatable habits.
          </p>
        </div>
        <div class="hero-actions">
          <label class="auto-sync-toggle">
            <input type="checkbox" id="autoSyncCTrader" ${isCTraderAutoSyncEnabled ? 'checked' : ''} />
            <span>Auto Sync ${isCTraderAutoSyncEnabled ? 'ON' : 'OFF'}</span>
          </label>
          ${renderCTraderBackendDiagnostics()}
          ${renderCTraderAccountSelector()}
${cTraderSyncStatus ? `<p class="import-status ${escapeHtml(cTraderSyncStatus.tone)}" role="status">${escapeHtml(cTraderSyncStatus.message)}</p>` : ''}
<button class="connect-button" type="button" id="connectCTrader" ${isCheckingCTraderConnection ? 'disabled' : ''}>
 Connect cTrader
</button>
          <button class="secondary-button" type="button" id="syncCTrader" ${isSyncingCTrader || isCheckingCTraderConnection ? 'disabled' : ''}>
            ${icon('refresh')} ${isSyncingCTrader ? 'Syncing cTrader...' : 'Sync cTrader'}
          </button>
          <button class="secondary-button" type="button" id="deleteAllCTraderImports">
            ${icon('trash')} Delete All cTrader Imports
          </button>
          <button class="secondary-button" type="button" id="exportTrades">${icon('download')} Export JSON</button>
          <label class="secondary-button upload-button">
            ${icon('upload')} Import JSON
            <input type="file" accept="application/json" id="importTrades" />
          </label>
          <p class="sync-meta">Last cTrader sync: <strong>${escapeHtml(formatSyncTime(cTraderLastSyncAt))}</strong></p>
        </div>
      </section>

      <section class="stats-grid" aria-label="Trading performance summary">
        ${statCard('trend', 'Net P&L', currency(stats.totalPnl), stats.totalPnl >= 0 ? 'positive' : 'negative')}
        ${statCard('target', 'Win rate', `${stats.winRate}%`)}
        ${statCard('chart', 'Trades logged', stats.tradeCount)}
        ${statCard('line', 'Avg win / loss', `${currency(stats.averageWin)} / ${currency(stats.averageLoss)}`)}
        ${statCard('target', 'Total R', formatRMultiple(stats.totalR), stats.totalR === null || stats.totalR >= 0 ? 'positive' : 'negative')}
        ${statCard('line', 'Average R', formatRMultiple(stats.averageR), stats.averageR === null || stats.averageR >= 0 ? 'positive' : 'negative')}
      </section>

      <section class="reports-grid" aria-label="P&L reports">
        ${pnlReports.map(reportCard).join('')}
      </section>

      <section class="workspace-grid">
        <form class="panel trade-form" id="tradeForm">
          <div class="section-title">${icon('plus')}<h2>Add trade</h2></div>
          <div class="form-grid">
            ${field('Date', '<input name="date" type="date" required value="' + today + '" />')}
            ${field('Symbol', '<input name="symbol" placeholder="SPY" required />')}
            ${field('Direction', '<select name="direction"><option>Long</option><option>Short</option></select>')}
            ${field('Setup', '<input name="setup" placeholder="Breakout, pullback, VWAP..." />')}
            ${field('Entry', '<input name="entry" type="number" min="0" step="0.01" required />')}
            ${field('Exit', '<input name="exit" type="number" min="0" step="0.01" required />')}
            ${field('Size', '<input name="size" type="number" min="0.01" step="0.01" required />')}
            ${field('Stop Loss', '<input name="stopLoss" type="number" min="0" step="0.01" placeholder="Optional" />')}
            ${field('Account Size', '<input name="accountSize" type="number" min="0" step="0.01" placeholder="Optional" />')}
            ${field('Risk %', '<input name="riskPercent" type="number" min="0" step="0.01" placeholder="Calculated" readonly />')}
            ${field('Fees', '<input name="fees" type="number" min="0" step="0.01" value="0" />')}
            ${field('Emotion', '<input name="emotion" placeholder="Calm, FOMO, patient..." value="Calm" />')}
            ${field('Tags', '<input name="tags" placeholder="gap, reversal, A+" />')}
          </div>
          ${field('Notes', '<textarea name="notes" rows="5" placeholder="What was the plan? What happened? What will you repeat or avoid?"></textarea>')}
          <div class="screenshot-upload-field">
            <label class="screenshot-upload" id="screenshotUpload">
              <span>${icon('image')} Trade screenshot</span>
              <input name="screenshot" type="file" accept="image/*" />
              <small>Optional. One image is stored locally with this trade and included in JSON backups.</small>
              <small>Tip: Paste a screenshot with Ctrl+V / Cmd+V</small>
            </label>
            <div class="screenshot-field-preview" id="screenshotFieldPreview" aria-live="polite"></div>
          </div>
          <button class="primary-button" type="submit">Save trade</button>
        </form>

        <section class="panel journal-panel">
          <div class="journal-header">
            <div class="section-title">${icon('calendar')}<h2>Journal entries</h2></div>
            <input class="search-input" id="searchInput" placeholder="Search trades..." value="${escapeHtml(searchQuery)}" />
          </div>
          <div class="trade-list">
            ${filteredTrades.length ? filteredTrades.map(tradeCard).join('') : '<p class="empty-state">No trades match your search yet.</p>'}
          </div>
        </section>
      </section>
    </main>
  `;

  bindEvents();
}

function field(label, control) {
  return `<label class="field"><span>${label}</span>${control}</label>`;
}

function bindEvents() {
  const tradeForm = document.querySelector('#tradeForm');
  const screenshotInput = tradeForm.querySelector('input[name="screenshot"]');

  tradeForm.addEventListener('submit', submitTrade);
  tradeForm.addEventListener('input', updateRiskPercentField);
  screenshotInput.addEventListener('change', changeScreenshot);

  if (!isPasteListenerBound) {
    document.addEventListener('paste', pasteScreenshot);
    isPasteListenerBound = true;
  }
  document.querySelector('#searchInput').addEventListener('input', (event) => {
    searchQuery = event.target.value;
    render();
    document.querySelector('#searchInput').focus();
  });
  document.querySelector('#autoSyncCTrader').addEventListener('change', changeCTraderAutoSyncSetting);
  document.querySelector('#cTraderAccountSelect')?.addEventListener('change', changeCTraderAccountSelection);
  document.querySelector('#refreshCTraderAccounts')?.addEventListener('click', () => loadCTraderAccounts({ force: true }));
  document.querySelector('#connectCTrader').addEventListener('click', startCTraderOAuthFlow);
  document.querySelector('#syncCTrader').addEventListener('click', () => syncCTrader({ source: 'manual' }));
  document.querySelector('#deleteAllCTraderImports').addEventListener('click', deleteAllCTraderImports);
  document.querySelector('#exportTrades').addEventListener('click', exportTrades);
  document.querySelector('#importTrades').addEventListener('change', importTrades);

  updateScreenshotFieldPreview();
  updateRiskPercentField({ currentTarget: tradeForm });

  document.querySelectorAll('[data-edit-trade]').forEach((button) => {
    button.addEventListener('click', () => {
      editingTradeId = button.dataset.editTrade;
      render();
    });
  });

  document.querySelectorAll('[data-cancel-edit-trade]').forEach((button) => {
    button.addEventListener('click', () => {
      if (editingTradeId === button.dataset.cancelEditTrade) {
        editingTradeId = null;
      }
      render();
    });
  });

  document.querySelectorAll('[data-edit-trade-form]').forEach((form) => {
    form.addEventListener('submit', submitTradeEdit);
  });

  document.querySelectorAll('[data-delete-trade]').forEach((button) => {
    button.addEventListener('click', () => {
      const deletedTrade = trades.find((trade) => trade.id === button.dataset.deleteTrade);
      rememberDeletedCTraderSourceKey(deletedTrade);
      if (editingTradeId === button.dataset.deleteTrade) {
        editingTradeId = null;
      }
      persistTrades(trades.filter((trade) => trade.id !== button.dataset.deleteTrade));
    });
  });
}

function deleteAllCTraderImports() {
  if (!window.confirm('Delete all imported cTrader trades?')) {
    return;
  }

  const deletedTrades = trades.filter((trade) => trade?.provider === 'ctrader');
  rememberDeletedCTraderSourceKeys(deletedTrades);
  const remainingTrades = trades.filter((trade) => trade?.provider !== 'ctrader');
  const deletedCount = trades.length - remainingTrades.length;

  cTraderSyncStatus = {
    tone: 'success',
    message: `Deleted ${deletedCount} imported cTrader ${deletedCount === 1 ? 'trade' : 'trades'}. They will not be re-imported on future syncs.`,
  };
  persistTrades(remainingTrades);
}

async function submitTrade(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const screenshot = selectedScreenshot ?? await readScreenshot(formData.get('screenshot') || pastedScreenshotFile);
  const nextTrade = {
    id: crypto.randomUUID(),
    date: formData.get('date'),
    symbol: String(formData.get('symbol')).trim().toUpperCase(),
    direction: formData.get('direction'),
    setup: String(formData.get('setup')).trim() || 'Uncategorized setup',
    entry: Number(formData.get('entry')),
    exit: Number(formData.get('exit')),
    size: Number(formData.get('size')),
    stopLoss: toOptionalNumber(formData.get('stopLoss')),
    accountSize: toOptionalNumber(formData.get('accountSize')),
    riskPercent: calculateRiskPercent({
      entry: formData.get('entry'),
      stopLoss: formData.get('stopLoss'),
      size: formData.get('size'),
      accountSize: formData.get('accountSize'),
    }),
    fees: Number(formData.get('fees')) || 0,
    emotion: String(formData.get('emotion')).trim() || 'Calm',
    tags: String(formData.get('tags')).trim(),
    notes: String(formData.get('notes')).trim(),
    screenshot,
  };

  selectedScreenshot = null;
  pastedScreenshotFile = null;
  persistTrades([nextTrade, ...trades]);
}

function submitTradeEdit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const tradeId = form.dataset.editTradeForm;
  const formData = new FormData(form);
  const journalingUpdates = {
    setup: String(formData.get('setup')).trim() || 'Uncategorized setup',
    emotion: String(formData.get('emotion')).trim() || (isCTraderImportedTrade(trades.find((trade) => trade.id === tradeId)) ? 'Imported' : 'Calm'),
    tags: String(formData.get('tags')).trim(),
    notes: String(formData.get('notes')).trim(),
  };

  editingTradeId = null;
  persistTrades(trades.map((trade) => (
    trade.id === tradeId
      ? { ...trade, ...journalingUpdates }
      : trade
  )));
}

function updateRiskPercentField(event) {
  const form = event.currentTarget;
  const riskPercentInput = form.querySelector('input[name="riskPercent"]');
  if (!riskPercentInput) {
    return;
  }

  const formData = new FormData(form);
  const riskPercent = calculateRiskPercent({
    entry: formData.get('entry'),
    stopLoss: formData.get('stopLoss'),
    size: formData.get('size'),
    accountSize: formData.get('accountSize'),
  });

  riskPercentInput.value = riskPercent === null ? '' : riskPercent.toFixed(2);
}

async function changeScreenshot(event) {
  pastedScreenshotFile = null;
  selectedScreenshot = await readScreenshot(event.target.files?.[0]);
  updateScreenshotFieldPreview();
}

async function pasteScreenshot(event) {
  const file = getClipboardImageFile(event.clipboardData);
  if (!file) {
    return;
  }

  event.preventDefault();
  pastedScreenshotFile = file;
  setFileInputFile(document.querySelector('input[name="screenshot"]'), file);
  selectedScreenshot = await readScreenshot(file);
  updateScreenshotFieldPreview();
}

function getClipboardImageFile(clipboardData) {
  if (!clipboardData) {
    return null;
  }

  const items = Array.from(clipboardData.items ?? []);
  const imageItem = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'));
  const itemFile = imageItem?.getAsFile();
  if (itemFile) {
    return itemFile;
  }

  return Array.from(clipboardData.files ?? []).find((file) => file.type.startsWith('image/')) ?? null;
}

function setFileInputFile(input, file) {
  if (!input || !file || typeof DataTransfer === 'undefined') {
    return;
  }

  try {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    input.files = dataTransfer.files;
  } catch {
    pastedScreenshotFile = file;
  }
}

function updateScreenshotFieldPreview() {
  const preview = document.querySelector('#screenshotFieldPreview');
  if (!preview) {
    return;
  }

  preview.innerHTML = selectedScreenshot ? screenshotLink(selectedScreenshot, 'selected trade screenshot') : '';
}

function readScreenshot(file) {
  if (!(file instanceof File) || !file.size) {
    return null;
  }

  if (!file.type.startsWith('image/')) {
    window.alert('Please choose an image file for the trade screenshot.');
    return null;
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        dataUrl: String(reader.result),
        name: file.name,
        type: file.type,
        size: file.size,
      });
    };
    reader.onerror = () => {
      window.alert('The screenshot could not be read. Save the trade without it or choose another image.');
      resolve(null);
    };
    reader.readAsDataURL(file);
  });
}

function getCTraderBackendDiagnostics(overrides = {}) {
  return {
    ...getBackendDiagnostics(window),
    connectionStatus: overrides.connectionStatus || getBackendDiagnostics(window).connectionStatus,
    tone: overrides.tone || (getBackendDiagnostics(window).deploymentHint ? 'error' : 'pending'),
  };
}

function setCTraderBackendDiagnostics(overrides = {}) {
  cTraderBackendDiagnostics = getCTraderBackendDiagnostics(overrides);
}

function renderCTraderBackendDiagnostics() {
  return `
    <dl class="backend-diagnostics" aria-label="cTrader backend diagnostics">
      <div>
        <dt>Backend URL</dt>
        <dd>${escapeHtml(cTraderBackendDiagnostics.backendUrl)}</dd>
      </div>
      <div>
        <dt>Status check URL</dt>
        <dd>${escapeHtml(cTraderBackendDiagnostics.statusUrl)}</dd>
      </div>
      <div>
        <dt>OAuth start URL</dt>
        <dd>${escapeHtml(cTraderBackendDiagnostics.authStartUrl)}</dd>
      </div>
      <div>
        <dt>OAuth callback URL</dt>
        <dd>${escapeHtml(cTraderBackendDiagnostics.authCallbackUrl)}</dd>
      </div>
      <div>
        <dt>Connection status</dt>
        <dd class="diagnostic-${escapeHtml(cTraderBackendDiagnostics.tone)}">${escapeHtml(cTraderBackendDiagnostics.connectionStatus)}</dd>
      </div>
    </dl>
  `;
}

function describeCTraderConnectionStatus(status) {
  if (status.connected) {
    return `Connected to cTrader.${getSelectedCTraderAccountStatusLabel()}`;
  }

  return status.error || 'Backend reached, but cTrader OAuth is not connected yet.';
}

function getCTraderAccountId(account) {
  return account?.ctidTraderAccountId ?? account?.accountId ?? null;
}

function getCTraderAccountNumber(account) {
  return account?.accountNumber ?? account?.accountNo ?? account?.login ?? null;
}

function getCTraderAccountEnvironmentLabel(account) {
  if (account?.isLive === true) {
    return 'LIVE';
  }
  if (account?.isLive === false) {
    return 'DEMO';
  }
  return 'UNKNOWN';
}

function formatCTraderAccountBalance(accountBalance = cTraderAccountBalance) {
  const balance = toOptionalNumber(accountBalance?.balance);
  if (balance === null) {
    return 'Balance not loaded';
  }
  return `Balance: ${currency(balance)}`;
}

function formatCTraderAccountLabel(account) {
  if (!account) {
    return selectedCTraderAccountId ? `Selected account ${selectedCTraderAccountId}` : 'No account selected';
  }

  const accountId = getCTraderAccountId(account);
  const accountNumber = getCTraderAccountNumber(account);
  const environment = getCTraderAccountEnvironmentLabel(account);
  const numberLabel = accountNumber ? `#${accountNumber}` : `ID ${accountId}`;
  return `${environment} ${numberLabel} (ID ${accountId})`;
}

function getSelectedCTraderAccount() {
  return cTraderAccounts.find((account) => String(getCTraderAccountId(account)) === String(selectedCTraderAccountId)) || null;
}

function getSelectedCTraderAccountStatusLabel() {
  const selectedAccount = getSelectedCTraderAccount();
  if (selectedAccount) {
    return ` Selected: ${formatCTraderAccountLabel(selectedAccount)}.`;
  }
  if (selectedCTraderAccountId) {
    return ` Selected account ID: ${selectedCTraderAccountId}.`;
  }
  return ' No account selected.';
}

function chooseDefaultCTraderAccount(accounts) {
  if (!Array.isArray(accounts) || !accounts.length) {
    return null;
  }

  return accounts.find((account) => account?.isLive === true) || accounts[0];
}

function applyCTraderAccounts(accounts) {
  cTraderAccounts = Array.isArray(accounts) ? accounts : [];
  const selectedExists = cTraderAccounts.some((account) => String(getCTraderAccountId(account)) === String(selectedCTraderAccountId));
  if (!selectedExists) {
    const defaultAccount = chooseDefaultCTraderAccount(cTraderAccounts);
    persistSelectedCTraderAccountId(getCTraderAccountId(defaultAccount) || '');
  }
}

function renderCTraderAccountSelector() {
  const options = cTraderAccounts.map((account) => {
    const accountId = String(getCTraderAccountId(account));
    return `<option value="${escapeHtml(accountId)}" ${accountId === String(selectedCTraderAccountId) ? 'selected' : ''}>${escapeHtml(formatCTraderAccountLabel(account))}</option>`;
  }).join('');
  const selectedLabel = escapeHtml(getSelectedCTraderAccountStatusLabel().trim());

  return `
    <div class="ctrader-account-selector">
      <label class="field" for="cTraderAccountSelect">
        <span>cTrader account</span>
        <select id="cTraderAccountSelect" ${isLoadingCTraderAccounts || !cTraderAccounts.length ? 'disabled' : ''}>
          ${cTraderAccounts.length ? options : '<option value="">Connect cTrader to load accounts</option>'}
        </select>
      </label>
      <button class="secondary-button" type="button" id="refreshCTraderAccounts" ${isLoadingCTraderAccounts ? 'disabled' : ''}>${isLoadingCTraderAccounts ? 'Loading accounts...' : 'Refresh accounts'}</button>
      <p class="selected-account-meta">${selectedLabel}</p>
      <p class="selected-account-meta">${escapeHtml(formatCTraderAccountBalance())}</p>
    </div>
  `;
}

function getCTraderOAuthReturnUrl() {
  const returnUrl = new URL(window.location.href);
  returnUrl.searchParams.set('ctrader', 'connected');
  returnUrl.searchParams.delete('error');
  returnUrl.hash = '';
  return returnUrl.toString();
}

function startCTraderOAuthFlow() {
  const authStartUrl = new URL(buildCTraderOAuthUrl(CTRADER_ENDPOINTS.authStart));
  authStartUrl.searchParams.set('returnTo', getCTraderOAuthReturnUrl());
  cTraderSyncStatus = { tone: 'pending', message: 'Opening cTrader OAuth on the Render backend...' };
  setCTraderBackendDiagnostics({ connectionStatus: 'Starting cTrader OAuth flow...', tone: 'pending' });
  render();
  window.location.assign(authStartUrl.toString());
}

function clearCTraderOAuthReturnQuery() {
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.delete('ctrader');
  if (window.history?.replaceState) {
    window.history.replaceState({}, document.title, currentUrl.toString());
  }
}

async function handleCTraderOAuthReturn() {
  if (hasHandledCTraderOAuthReturn) {
    return false;
  }

  const currentUrl = new URL(window.location.href);
  if (currentUrl.searchParams.get('ctrader') !== 'connected') {
    return false;
  }

  hasHandledCTraderOAuthReturn = true;
  clearCTraderOAuthReturnQuery();
  cTraderSyncStatus = { tone: 'pending', message: 'Authorization complete. Checking cTrader connection status...' };
  render();

  try {
    await checkCTraderConnection();
    await loadCTraderAccounts({ force: true });
    cTraderSyncStatus = { tone: 'success', message: 'cTrader is connected. You can now Sync cTrader or leave Auto Sync on.' };
  } catch (error) {
    cTraderSyncStatus = {
      tone: 'error',
      message: error.message || 'Authorization finished, but cTrader connection status could not be confirmed.',
    };
  } finally {
    render();
  }

  return true;
}

function changeCTraderAutoSyncSetting(event) {
  persistCTraderAutoSyncSetting(event.target.checked);
  cTraderSyncStatus = {
    tone: event.target.checked ? 'success' : 'pending',
    message: `Auto Sync ${event.target.checked ? 'enabled' : 'disabled'}.`,
  };
  render();

  if (event.target.checked) {
    syncCTraderOnStartup();
  }
}

async function loadSelectedCTraderAccountBalance(options = {}) {
  if (!selectedCTraderAccountId) {
    cTraderAccountBalance = null;
    return null;
  }
  if (cTraderAccountBalance && String(cTraderAccountBalance.accountId) === String(selectedCTraderAccountId) && !options.force) {
    return cTraderAccountBalance;
  }

  const params = new URLSearchParams({ accountId: String(selectedCTraderAccountId) });
  const { response, body, url } = await fetchBackendJson(`${CTRADER_ENDPOINTS.balance}?${params.toString()}`);
  if (!response.ok) {
    const error = new Error(body.error || 'Unable to load cTrader account balance.');
    error.url = url;
    throw error;
  }

  cTraderAccountBalance = { ...body, fetchedAt: new Date().toISOString() };
  return cTraderAccountBalance;
}

async function loadCTraderAccounts(options = {}) {
  if (isLoadingCTraderAccounts) {
    return cTraderAccounts;
  }
  if (cTraderAccounts.length && !options.force) {
    return cTraderAccounts;
  }

  isLoadingCTraderAccounts = true;
  render();
  try {
    const { response, body } = await fetchBackendJson(`${CTRADER_ENDPOINTS.accounts}?maxRows=1`);
    if (!response.ok) {
      throw new Error(body.error || 'Unable to load cTrader accounts.');
    }
    applyCTraderAccounts(body.accounts);
    try {
      await loadSelectedCTraderAccountBalance(options);
    } catch (error) {
      console.warn('[cTrader balance] Could not load selected account balance while refreshing accounts.', error);
      cTraderAccountBalance = null;
    }
    setCTraderBackendDiagnostics({ connectionStatus: describeCTraderConnectionStatus({ connected: true }), tone: 'success' });
    return cTraderAccounts;
  } finally {
    isLoadingCTraderAccounts = false;
    render();
  }
}

function changeCTraderAccountSelection(event) {
  persistSelectedCTraderAccountId(event.target.value);
  cTraderAccountBalance = null;
  cTraderSyncStatus = { tone: 'success', message: `Selected cTrader account: ${formatCTraderAccountLabel(getSelectedCTraderAccount())}.` };
  setCTraderBackendDiagnostics({ connectionStatus: describeCTraderConnectionStatus({ connected: true }), tone: 'success' });
  render();
}

async function checkCTraderConnection() {
  setCTraderBackendDiagnostics({ connectionStatus: 'Checking backend status...', tone: 'pending' });
  const { response, body: status, url } = await fetchBackendJson(CTRADER_ENDPOINTS.status);
  if (!response.ok || !status.connected) {
    setCTraderBackendDiagnostics({ connectionStatus: describeCTraderConnectionStatus(status), tone: 'error' });
    const error = new Error(status.error || 'cTrader is not connected.');
    error.url = url;
    throw error;
  }

  setCTraderBackendDiagnostics({ connectionStatus: describeCTraderConnectionStatus(status), tone: 'success' });
  await loadCTraderAccounts();
  return status;
}

async function syncCTrader(options = {}) {
  if (isSyncingCTrader) {
    return;
  }

  isSyncingCTrader = true;
  const isAutoSync = options.source === 'auto';
  cTraderSyncStatus = { tone: 'pending', message: isAutoSync ? 'Auto Sync checking cTrader trades...' : 'Syncing cTrader trades...' };
  render();

  try {
    await loadCTraderAccounts();
    if (!selectedCTraderAccountId) {
      throw new Error('Select a cTrader account before syncing.');
    }
    const accountBalance = await loadSelectedCTraderAccountBalance({ force: true });
    const syncRequestPath = buildCTraderSyncRequestPath(trades);
    console.info('[cTrader sync] Frontend request starting', {
      requestPath: syncRequestPath,
      selectedAccountId: selectedCTraderAccountId,
      selectedAccount: getSelectedCTraderAccount(),
    });
    const { response, body: preview, url } = await fetchBackendJson(syncRequestPath);
    if (!response.ok) {
      const error = new Error(preview.error || 'cTrader sync failed');
      error.url = url;
      throw error;
    }

    setCTraderBackendDiagnostics({ connectionStatus: 'Backend reachable; cTrader journal preview loaded.', tone: 'success' });

    const previewTrades = Array.isArray(preview.trades) ? preview.trades : [];
    const syncPlan = buildCTraderSyncPlan(previewTrades, trades, {
      deletedSourceKeys: loadDeletedCTraderSourceKeys(),
      accountBalance,
    });
    logCTraderSyncDiagnostics({ preview, syncPlan, existingTrades: trades });

    const updatedExistingTrades = applyCTraderImportedTradeUpdates(trades, syncPlan.skippedTrades);
    if (syncPlan.importedTrades.length || updatedExistingTrades.updatedCount > 0) {
      persistTrades([...syncPlan.importedTrades, ...updatedExistingTrades.trades]);
    }

    const syncedAt = new Date().toISOString();
    persistCTraderLastSyncTime(syncedAt);
    cTraderSyncStatus = {
      tone: 'success',
      message: `${isAutoSync ? 'Auto Sync complete.' : 'Sync complete.'} New trades imported: ${syncPlan.importedCount}. Trades skipped: ${syncPlan.skippedCount}. Imported trades updated: ${updatedExistingTrades.updatedCount}.`,
    };
  } catch (error) {
    console.error('[cTrader sync] Frontend request failed', {
      requestUrl: error.url || null,
      requestParameters: error.url ? Object.fromEntries(new URL(error.url).searchParams.entries()) : null,
      selectedAccountId: selectedCTraderAccountId || null,
      errorMessage: error.message || String(error),
      stack: error.stack || null,
    });
    setCTraderBackendDiagnostics({ connectionStatus: error.url ? `Backend error at ${error.url}` : 'Backend check failed', tone: 'error' });
    cTraderSyncStatus = {
      tone: 'error',
      message: error.message || 'cTrader sync failed.',
    };
  } finally {
    isSyncingCTrader = false;
    render();
  }
}

function buildCTraderSyncRequestPath(existingTrades) {
  const params = new URLSearchParams();
  const latestImportedTrade = getLatestImportedCTraderTrade(existingTrades);

  if (selectedCTraderAccountId) {
    params.set('accountId', String(selectedCTraderAccountId));
  }

  const latestCloseTime = Date.parse(latestImportedTrade?.closeTime || latestImportedTrade?.date || '');
  if (Number.isFinite(latestCloseTime)) {
    params.set('fromTimestamp', String(Math.max(0, latestCloseTime - 24 * 60 * 60 * 1000)));
  }

  params.set('maxRows', '1000');

  return `${CTRADER_ENDPOINTS.journalPreview}?${params.toString()}`;
}

function getLatestImportedCTraderTrade(existingTrades) {
  return [...existingTrades]
    .filter((trade) => trade?.provider === 'ctrader')
    .filter((trade) => !selectedCTraderAccountId || String(trade?.accountId) === String(selectedCTraderAccountId))
    .sort((left, right) => {
      const leftTime = Date.parse(left.closeTime || left.date || '') || 0;
      const rightTime = Date.parse(right.closeTime || right.date || '') || 0;
      return rightTime - leftTime;
    })[0] || null;
}

function getLatestCTraderDealId(tradeList) {
  return tradeList
    .map((trade) => Number(trade?.sourceDealId ?? trade?.sourceTradeId))
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0] ?? null;
}

function logCTraderSyncDiagnostics({ preview, syncPlan, existingTrades }) {
  const previewTrades = Array.isArray(preview?.trades) ? preview.trades : [];
  const latestStoredDealId = getLatestCTraderDealId(existingTrades.filter((trade) => trade?.provider === 'ctrader'));
  const latestReturnedDealId = getLatestCTraderDealId(previewTrades);

  console.info('[cTrader sync]', {
    accountId: preview?.accountId ?? null,
    selectedAccount: getSelectedCTraderAccount() ? {
      accountId: getCTraderAccountId(getSelectedCTraderAccount()),
      accountNumber: getCTraderAccountNumber(getSelectedCTraderAccount()),
      isLive: getSelectedCTraderAccount()?.isLive ?? null,
    } : { accountId: selectedCTraderAccountId || null },
    request: preview?.request ?? null,
    dealsReturned: preview?.dealCount ?? previewTrades.length,
    latestDealIdFound: latestReturnedDealId,
    latestDealIdStoredLocally: latestStoredDealId,
    tradesImported: syncPlan.importedCount,
    tradesSkipped: syncPlan.skippedCount,
    skippedReasons: syncPlan.skippedTrades.map(({ trade, reason }) => ({
      sourceDealId: trade?.sourceDealId ?? trade?.sourceTradeId ?? null,
      reason,
    })),
  });
}

function scheduleCTraderAutoSync() {
  if (cTraderAutoSyncTimer !== null) {
    clearInterval(cTraderAutoSyncTimer);
    cTraderAutoSyncTimer = null;
  }

  if (!isCTraderAutoSyncEnabled) {
    return;
  }

  cTraderAutoSyncTimer = window.setInterval(() => {
    syncCTraderOnStartup();
  }, AUTO_SYNC_INTERVAL_MS);
}

async function syncCTraderOnStartup() {
  if (!isCTraderAutoSyncEnabled) {
    cTraderSyncStatus = { tone: 'pending', message: 'Auto Sync is off.' };
    render();
    return;
  }

  if (isSyncingCTrader || isCheckingCTraderConnection) {
    return;
  }

  isCheckingCTraderConnection = true;
  cTraderSyncStatus = { tone: 'pending', message: 'Checking cTrader connection for Auto Sync...' };
  render();

  try {
    await checkCTraderConnection();
  } catch (error) {
    setCTraderBackendDiagnostics({ connectionStatus: error.url ? `Backend error at ${error.url}` : 'Backend check failed', tone: 'error' });
    cTraderSyncStatus = {
      tone: 'error',
      message: error.message || 'cTrader is not connected. Connect cTrader to enable Auto Sync.',
    };
    return;
  } finally {
    isCheckingCTraderConnection = false;
    render();
  }

  await syncCTrader({ source: 'auto' });
}

function exportTrades() {
  const blob = new Blob([JSON.stringify(trades, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'jeremy-trading-journal.json';
  link.click();
  URL.revokeObjectURL(url);
}

function importTrades(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const importedTrades = JSON.parse(String(reader.result));
    if (Array.isArray(importedTrades)) {
      persistTrades(importedTrades);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

render();
scheduleCTraderAutoSync();
handleCTraderOAuthReturn().then((handledOAuthReturn) => {
  if (!handledOAuthReturn) {
    syncCTraderOnStartup();
  }
});
