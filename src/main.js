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
    openTime: '2026-06-03T13:30:00.000Z',
    closeTime: '2026-06-03T13:35:00.000Z',
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
    openTime: '2026-06-05T14:00:00.000Z',
    closeTime: '2026-06-05T15:15:00.000Z',
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
    openTime: '2026-06-08T16:12:00.000Z',
    closeTime: '2026-06-08T18:20:00.000Z',
    notes: 'Entered before confirmation. Need the candle to close above the trigger level.',
  },
];

let trades = loadTrades();
let searchQuery = '';
let selectedScreenshot = null;
let pastedScreenshotFile = null;
let editScreenshotDrafts = {};
let isPasteListenerBound = false;
let cTraderSyncStatus = null;
let isSyncingCTrader = false;
let isCheckingCTraderConnection = false;
let isCTraderAutoSyncEnabled = loadCTraderAutoSyncSetting();
let cTraderLastSyncAt = loadCTraderLastSyncTime();
let cTraderAutoSyncTimer = null;
let cTraderBackendDiagnostics = getCTraderBackendDiagnostics();
let isCTraderConnected = false;
let cTraderAccounts = [];
let cTraderAccountBalance = null;
let selectedCTraderAccountId = loadSelectedCTraderAccountId();
let isLoadingCTraderAccounts = false;
let hasHandledCTraderOAuthReturn = false;
let editingTradeId = null;
let isManualTradeFormOpen = false;
let setupAnalyticsSort = { key: 'netPnl', direction: 'desc' };

const PLAY_BOOK_SETUP_OPTIONS = [
  'Elephant Bar',
  'Buy the Retrace',
  'TB Retrace',
  'Ride the 🐋',
  'MATX',
  'MAX',
  'Support & Resistance',
  'Hedge',
  'Set & Forget',
  'Return to 200',
  'The General Forecast',
];
const CUSTOM_SETUP_OPTION = 'Custom';
const LOSS_REASON_OPTIONS = [
  'Bad Entry',
  'Chased Price',
  'Ignored Rules',
  'Good Trade, Normal Loss',
  'Stop Too Tight',
  'Other',
];
const CLOSE_REASON_OPTIONS = [
  'Take Profit',
  'Stop Loss',
  'Trailed Stop',
  'Trend Change',
  'Manual Close',
  'Break Even',
  'Other',
];

const app = document.querySelector('#root');

function loadTrades() {
  const savedTrades = window.localStorage.getItem(STORAGE_KEY);
  if (!savedTrades) {
    return starterTrades;
  }

  const parsedTrades = JSON.parse(savedTrades);
  return Array.isArray(parsedTrades) ? parsedTrades : starterTrades;
}

function persistTrades(nextTrades, options = {}) {
  trades = nextTrades;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
  if (options.preserveTradeId) {
    renderPreservingTradePosition(options.preserveTradeId, options.renderOptions);
    return;
  }
  render();
}

function isTradeEditLocked() {
  return editingTradeId !== null;
}

function openTradeEdit(tradeId) {
  editingTradeId = tradeId;
  scheduleCTraderAutoSync();
  renderTradeCardInPlace(tradeId);
}

function closeTradeEdit() {
  editingTradeId = null;
  scheduleCTraderAutoSync();
}

function getTradeCardElement(tradeId) {
  return [...document.querySelectorAll('[data-trade-card]')]
    .find((tradeCard) => tradeCard.dataset.tradeCard === String(tradeId)) || null;
}

function getTradeById(tradeId) {
  return trades.find((trade) => String(trade.id) === String(tradeId)) || null;
}

function renderTradeCardInPlace(tradeId) {
  const trade = getTradeById(tradeId);
  const currentTradeCard = getTradeCardElement(tradeId);
  if (!trade || !currentTradeCard) {
    render({ force: true });
    return;
  }

  currentTradeCard.outerHTML = tradeCard(trade);
  const nextTradeCard = getTradeCardElement(tradeId);
  if (nextTradeCard) {
    bindTradeCardEvents(nextTradeCard);
  }
}

function captureTradeScrollAnchor(tradeId) {
  const tradeCard = getTradeCardElement(tradeId);
  return {
    scrollY: window.scrollY,
    top: tradeCard?.getBoundingClientRect().top ?? null,
  };
}

function restoreTradeScrollAnchor(tradeId, anchor) {
  const tradeCard = getTradeCardElement(tradeId);
  if (!tradeCard || anchor.top === null) {
    window.scrollTo({ top: anchor.scrollY, left: window.scrollX });
    return;
  }

  const nextTop = tradeCard.getBoundingClientRect().top;
  window.scrollTo({ top: window.scrollY + nextTop - anchor.top, left: window.scrollX });
}

function renderPreservingTradePosition(tradeId, renderOptions = {}) {
  const anchor = captureTradeScrollAnchor(tradeId);
  render(renderOptions);
  restoreTradeScrollAnchor(tradeId, anchor);
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
  return value === null || value === undefined ? '—' : `${value.toFixed(1)}%`;
}

function formatRiskPercent(value) {
  if (value === null || value === undefined) {
    return '—';
  }

  if (value > 0 && value < 0.1) {
    return '0.1%';
  }

  return `${value.toFixed(1)}%`;
}

function formatRMultiple(value) {
  return value === null || value === undefined ? '—' : `${value.toFixed(1)}R`;
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


function formatTradeTime(value) {
  if (!value) {
    return '—';
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    return '—';
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return '—';
  }

  return timestamp.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getTradeTimeDisplay(trade) {
  return formatTradeTime(trade.openTime || trade.time || trade.date);
}

function formatTradeTimestamp(value) {
  if (!value) {
    return '—';
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
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
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function cTraderTimeDetails(trade) {
  if (!isCTraderImportedTrade(trade)) {
    return '';
  }

  return `
        <span>Opened: ${escapeHtml(formatTradeTimestamp(trade.openTime))}</span>
        <span>Closed: ${escapeHtml(formatTradeTimestamp(trade.closeTime))}</span>`;
}

function isStopLossCloseReason(closeReason) {
  return String(closeReason || '').trim().toLowerCase() === 'stop loss';
}

function getStopLossHitPrice(trade) {
  return isStopLossCloseReason(trade.closeReason) ? toOptionalNumber(trade.exit) : null;
}

function getActiveStopLoss(trade) {
  return getStopLossHitPrice(trade) ?? toOptionalNumber(trade.adjustedStopLoss) ?? toOptionalNumber(trade.stopLoss);
}

function calculateRiskDollars(trade) {
  const entry = toOptionalNumber(trade.entry);
  const activeStopLoss = getActiveStopLoss(trade);
  const size = toOptionalNumber(trade.size);

  if (entry === null || activeStopLoss === null || size === null) {
    return null;
  }

  const riskPerUnit = trade.direction === 'Short'
    ? activeStopLoss - entry
    : entry - activeStopLoss;
  const riskDollars = riskPerUnit * size * getTradeContractSize(trade);
  return riskDollars > 0 ? riskDollars : null;
}

function getTradeContractSize(trade) {
  const explicitContractSize = toOptionalNumber(trade.contractSize ?? trade.lotSizeInUnits);
  if (explicitContractSize !== null && explicitContractSize > 0) {
    return explicitContractSize;
  }

  const size = toOptionalNumber(trade.size);
  const symbol = getTradeDisplaySymbol(trade).toUpperCase().replace(/[^A-Z]/g, '');

  // Manual trades historically used raw instrument units as size. Only infer a
  // lot contract when the stored size looks like a lot quantity, which is how
  // cTrader imports and manual lot-sized entries represent metals/FX.
  if (size !== null && size > 100) {
    return 1;
  }

  if (symbol === 'XAUUSD' || symbol.includes('GOLD')) {
    return 100;
  }

  if (/^[A-Z]{6}$/.test(symbol)) {
    return 100000;
  }

  return 1;
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
  return (gross * getTradeContractSize(trade)) - fees;
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

  if (period === 'year') {
    periodStart.setMonth(0, 1);
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
    { label: 'Yearly P&L', period: 'year', ...calculatePnlForPeriod(trades, 'year', referenceDate) },
  ];
}

function calculateBiggestWinner(tradeList) {
  const winningPnlValues = tradeList
    .filter((trade) => getTradeReportDate(trade) !== null)
    .map(calculatePnl)
    .filter((value) => Number.isFinite(value) && value > 0);

  return winningPnlValues.length ? Math.max(...winningPnlValues) : null;
}

function getSetupAnalytics() {
  const setupReports = new Map();

  trades.forEach((trade) => {
    const setupName = String(trade.setup ?? '').trim();
    if (!setupName) {
      return;
    }

    const pnl = calculatePnl(trade);
    const rMultiple = calculateRMultiple(trade);
    const report = setupReports.get(setupName) ?? {
      setupName,
      tradeCount: 0,
      winCount: 0,
      rCount: 0,
      totalR: 0,
      netPnl: 0,
    };

    report.tradeCount += 1;
    report.winCount += pnl > 0 ? 1 : 0;
    report.netPnl += pnl;

    if (rMultiple !== null) {
      report.rCount += 1;
      report.totalR += rMultiple;
    }

    setupReports.set(setupName, report);
  });

  return [...setupReports.values()]
    .map((report) => ({
      setupName: report.setupName,
      tradeCount: report.tradeCount,
      winRate: report.tradeCount ? (report.winCount / report.tradeCount) * 100 : 0,
      averageR: report.rCount ? report.totalR / report.rCount : null,
      netPnl: report.netPnl,
    }))
    .sort(compareSetupAnalyticsRows);
}

function compareSetupAnalyticsRows(firstRow, secondRow) {
  const direction = setupAnalyticsSort.direction === 'asc' ? 1 : -1;
  const firstValue = firstRow[setupAnalyticsSort.key];
  const secondValue = secondRow[setupAnalyticsSort.key];
  let result = 0;

  if (typeof firstValue === 'string' || typeof secondValue === 'string') {
    result = String(firstValue ?? '').localeCompare(String(secondValue ?? ''), undefined, { sensitivity: 'base' });
  } else {
    result = (firstValue ?? Number.NEGATIVE_INFINITY) - (secondValue ?? Number.NEGATIVE_INFINITY);
  }

  if (result === 0 && setupAnalyticsSort.key !== 'netPnl') {
    result = firstRow.netPnl - secondRow.netPnl;
  }

  return result * direction;
}

function renderSetupAnalytics() {
  const setupAnalytics = getSetupAnalytics();
  const sortLabels = { setupName: 'Setup Name', tradeCount: 'Number of Trades', winRate: 'Win Rate %', averageR: 'Average R', netPnl: 'Net P&L' };

  return `
      <section class="panel setup-analytics-panel" aria-label="Setup Analytics">
        <div class="setup-analytics-header">
          <div>
            <div class="section-title">${icon('chart')}<h2>Setup Analytics</h2></div>
            <p class="section-helper">Performance grouped by non-blank setup values across manual and cTrader-imported trades.</p>
          </div>
          <p class="setup-sort-helper">Sorted by ${escapeHtml(sortLabels[setupAnalyticsSort.key])} ${setupAnalyticsSort.direction === 'asc' ? 'ascending' : 'descending'}</p>
        </div>
        <div class="setup-analytics-table-wrap">
          <table class="setup-analytics-table">
            <thead>
              <tr>
                ${setupAnalyticsHeader('setupName', 'Setup Name')}
                ${setupAnalyticsHeader('tradeCount', 'Number of Trades')}
                ${setupAnalyticsHeader('winRate', 'Win Rate %')}
                ${setupAnalyticsHeader('averageR', 'Average R')}
                ${setupAnalyticsHeader('netPnl', 'Net P&L')}
              </tr>
            </thead>
            <tbody>
              ${setupAnalytics.length ? setupAnalytics.map(setupAnalyticsRow).join('') : '<tr><td colspan="5" class="empty-state">No setup analytics yet. Add Setup values to trades to see this report.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>`;
}

function setupAnalyticsHeader(key, label) {
  const isActive = setupAnalyticsSort.key === key;
  const nextDirection = isActive && setupAnalyticsSort.direction === 'desc' ? 'asc' : 'desc';
  const indicator = isActive ? (setupAnalyticsSort.direction === 'desc' ? ' ↓' : ' ↑') : '';

  return `<th scope="col"><button class="table-sort-button" type="button" data-setup-sort-key="${escapeHtml(key)}" data-setup-sort-direction="${nextDirection}" aria-label="Sort setup analytics by ${escapeHtml(label)} ${nextDirection}">${escapeHtml(label)}${indicator}</button></th>`;
}

function setupAnalyticsRow(report) {
  const pnlTone = report.netPnl >= 0 ? 'positive' : 'negative';
  const rTone = report.averageR === null || report.averageR >= 0 ? 'positive' : 'negative';

  return `
              <tr>
                <td>${escapeHtml(report.setupName)}</td>
                <td>${report.tradeCount}</td>
                <td>${formatPercent(report.winRate)}</td>
                <td class="${rTone}">${formatRMultiple(report.averageR)}</td>
                <td class="${pnlTone}">${currency(report.netPnl)}</td>
              </tr>`;
}

function getStats() {
  const pnlValues = trades.map(calculatePnl);
  const rValues = trades.map(calculateRMultiple).filter(Number.isFinite);
  const riskDollarValues = trades.map(calculateRiskDollars).filter(Number.isFinite);
  const riskPercentValues = trades.map(calculateRiskPercent).filter(Number.isFinite);
  const wins = pnlValues.filter((value) => value > 0);
  const losses = pnlValues.filter((value) => value < 0);
  const totalPnl = pnlValues.reduce((sum, value) => sum + value, 0);
  const averageWin = wins.length ? wins.reduce((sum, value) => sum + value, 0) / wins.length : 0;
  const averageLoss = losses.length ? losses.reduce((sum, value) => sum + value, 0) / losses.length : 0;
  const totalR = rValues.reduce((sum, value) => sum + value, 0);
  const averageR = rValues.length ? totalR / rValues.length : null;
  const averageRiskDollars = riskDollarValues.length
    ? riskDollarValues.reduce((sum, value) => sum + value, 0) / riskDollarValues.length
    : null;
  const averageRiskPercent = riskPercentValues.length
    ? riskPercentValues.reduce((sum, value) => sum + value, 0) / riskPercentValues.length
    : null;
  const biggestWinner = calculateBiggestWinner(trades);

  return {
    totalPnl,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    tradeCount: trades.length,
    averageWin,
    averageLoss,
    totalR: rValues.length ? totalR : null,
    averageR,
    averageRiskDollars,
    averageRiskPercent,
    biggestWinner,
  };
}

function getFilteredTrades() {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  if (!normalizedQuery) {
    return trades;
  }

  return trades.filter((trade) => {
    return [trade.symbol, trade.setup, trade.direction, trade.tags, trade.notes]
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
    minus: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
    calendar: '<svg viewBox="0 0 24 24"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
    image: '<svg viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>',
    refresh: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    save: '<svg viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>',
    share: '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98"/><path d="M15.41 6.51L8.59 10.49"/></svg>',
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

function openScreenshotLink(event) {
  const link = event.target.closest('.screenshot-link');
  if (!link) {
    return;
  }

  const imageUrl = link.getAttribute('href');
  if (!imageUrl?.startsWith('data:image/')) {
    return;
  }

  event.preventDefault();

  const fullSizeWindow = window.open('', '_blank');
  if (!fullSizeWindow) {
    return;
  }

  fullSizeWindow.opener = null;
  fullSizeWindow.document.write(`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${escapeHtml(link.getAttribute('aria-label') || 'Trade screenshot')}</title>
        <style>
          body { margin: 0; min-height: 100vh; background: #0f172a; display: grid; place-items: center; }
          img { max-width: 100%; height: auto; display: block; }
        </style>
      </head>
      <body>
        <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(link.querySelector('img')?.alt || 'Trade screenshot')}" />
      </body>
    </html>`);
  fullSizeWindow.document.close();
}

function screenshotPreview(trade) {
  return screenshotLink(trade.screenshot, trade.symbol);
}

function tradeCard(trade) {
  const displaySymbol = getTradeDisplaySymbol(trade);
  const pnl = calculatePnl(trade);
  const stopLoss = toOptionalNumber(trade.stopLoss);
  const activeStopLoss = getActiveStopLoss(trade);
  const riskDollars = calculateRiskDollars(trade);
  const riskPercent = calculateRiskPercent(trade);
  const rMultiple = calculateRMultiple(trade);
  const tone = pnl >= 0 ? 'positive' : 'negative';
  const rTone = rMultiple === null || rMultiple >= 0 ? 'positive' : 'negative';
  const importedTimeDetail = cTraderTimeDetails(trade);
  const tradeTime = getTradeTimeDisplay(trade);
  const tradeDuration = formatTradeDuration(trade.openTime, trade.closeTime);
  const setupName = String(trade.setup || '').trim();
  const setupBadge = setupName ? `<p class="trade-setup-row"><span class="trade-setup-badge">${escapeHtml(setupName)}</span></p>` : '';
  const isEditing = editingTradeId === trade.id;
  return `
    <article class="trade-card" data-trade-card="${escapeHtml(trade.id)}">
      <div class="trade-card-header">
        <div class="trade-card-heading">
          <div class="trade-title-row">
            <p class="trade-symbol">${escapeHtml(displaySymbol)}</p>
            <strong class="trade-pnl-badge ${tone}" aria-label="P&L ${currency(pnl)}">${currency(pnl)}</strong>
          </div>
          ${setupBadge}
          <p class="trade-meta trade-time-meta">
            <span>Date: ${escapeHtml(trade.date || '—')}</span>
            <span>Time: ${escapeHtml(tradeTime)}</span>
            <span>Duration: ${escapeHtml(tradeDuration)}</span>
            <span>${escapeHtml(trade.direction)}</span>
          </p>
        </div>
      </div>
      <div class="trade-details">
        <span>Entry: ${currency(Number(trade.entry))}</span>
        <span>Exit: ${currency(Number(trade.exit))}</span>
        <span>Size: ${escapeHtml(trade.size)}</span>
        <span>Original SL: ${stopLoss === null ? '—' : currency(stopLoss)}</span>
        ${activeStopLoss === null || activeStopLoss === stopLoss ? '' : `<span>Risk Stop: ${currency(activeStopLoss)}</span>`}
        <span>Risk $: ${riskDollars === null ? '—' : currency(riskDollars)}</span>
        <span>Risk %: ${formatRiskPercent(riskPercent)}</span>
        <span class="${rTone}">R: ${formatRMultiple(rMultiple)}</span>
        ${importedTimeDetail}
      </div>
      ${isEditing ? editTradeForm(trade) : tradeJournalDetails(trade)}
      ${!isEditing ? screenshotPreview(trade) : ''}
      ${!isEditing ? `
        <div class="trade-card-actions">
          <button class="edit-button" type="button" data-edit-trade="${escapeHtml(trade.id)}" aria-label="Edit journaling fields for ${escapeHtml(displaySymbol)} trade">${icon('edit')} Edit</button>
          <button class="icon-button" type="button" data-delete-trade="${escapeHtml(trade.id)}" aria-label="Delete ${escapeHtml(trade.symbol)} trade">
            ${icon('trash')} Delete
          </button>
        </div>` : ''}
    </article>
  `;
}

function tradeJournalDetails(trade) {
  return `
      ${trade.lossReason ? `<p class="loss-reason"><strong>Loss Reason:</strong> ${escapeHtml(trade.lossReason)}</p>` : ''}
      ${trade.closeReason ? `<p class="close-reason"><strong>Close Reason:</strong> ${escapeHtml(trade.closeReason)}</p>` : ''}
      ${trade.tags ? `<p class="tags">${escapeHtml(trade.tags)}</p>` : ''}
      ${trade.notes ? `<p class="notes">${escapeHtml(trade.notes)}</p>` : ''}`;
}

function renderSelectOption(option, selectedValue) {
  const selected = option === selectedValue ? ' selected' : '';
  return `<option value="${escapeHtml(option)}"${selected}>${escapeHtml(option)}</option>`;
}

function renderSetupOption(option, selectedValue) {
  return renderSelectOption(option, selectedValue);
}

function isPlayBookSetup(setup) {
  return PLAY_BOOK_SETUP_OPTIONS.includes(String(setup || '').trim());
}

function renderPlayBookSetupSelect(trade) {
  const currentSetup = String(trade.setup || '').trim();
  const selectedSetup = isPlayBookSetup(currentSetup) ? currentSetup : CUSTOM_SETUP_OPTION;
  const customValue = selectedSetup === CUSTOM_SETUP_OPTION ? currentSetup : '';
  const customHidden = selectedSetup === CUSTOM_SETUP_OPTION ? '' : ' hidden';
  return `
    <select name="setupChoice" data-setup-choice="${escapeHtml(trade.id)}" aria-label="Play Book setup">
      ${PLAY_BOOK_SETUP_OPTIONS.map((option) => renderSetupOption(option, selectedSetup)).join('')}
      ${renderSetupOption(CUSTOM_SETUP_OPTION, selectedSetup)}
    </select>
    <input name="setupCustom" value="${escapeHtml(customValue)}" placeholder="Custom setup name" data-custom-setup="${escapeHtml(trade.id)}"${customHidden} />
  `;
}

function renderLossReasonSelect(trade) {
  const currentLossReason = String(trade.lossReason || '').trim();
  const legacyLossReasonOption = currentLossReason && !LOSS_REASON_OPTIONS.includes(currentLossReason)
    ? renderSelectOption(currentLossReason, currentLossReason)
    : '';
  return `
    <select name="lossReason" aria-label="Loss Reason">
      <option value="">No loss reason</option>
      ${LOSS_REASON_OPTIONS.map((option) => renderSelectOption(option, currentLossReason)).join('')}
      ${legacyLossReasonOption}
    </select>
  `;
}

function renderCloseReasonSelect(trade) {
  const currentCloseReason = String(trade.closeReason || '').trim();
  return `
    <select name="closeReason" aria-label="Close Reason">
      <option value="">No close reason</option>
      ${CLOSE_REASON_OPTIONS.map((option) => renderSelectOption(option, currentCloseReason)).join('')}
    </select>
  `;
}

function getSetupFormValue(formData) {
  const setupChoice = String(formData.get('setupChoice') || '').trim();
  if (setupChoice === CUSTOM_SETUP_OPTION) {
    return String(formData.get('setupCustom')).trim() || 'Uncategorized setup';
  }

  return String(formData.get('setup') || '').trim() || setupChoice || 'Uncategorized setup';
}

function editTradeForm(trade) {
  const currentScreenshot = getEditScreenshotPreview(trade);
  const removeButton = currentScreenshot
    ? `<button class="secondary-button" type="button" data-remove-edit-screenshot="${escapeHtml(trade.id)}">${icon('trash')} Remove screenshot</button>`
    : '';
  return `
      <form class="edit-trade-form" data-edit-trade-form="${escapeHtml(trade.id)}">
        <div class="edit-form-row edit-price-row" aria-label="Trade prices">
          ${field('Entry Price', `<input name="entry" type="number" value="${escapeHtml(trade.entry)}" readonly />`)}
          ${field('Exit Price', `<input name="exit" type="number" value="${escapeHtml(trade.exit)}" readonly />`)}
          ${field('Original Stop Loss', `<input name="stopLoss" type="number" value="${escapeHtml(trade.stopLoss ?? '')}" readonly />`)}
          ${field('Risk Stop', `<input name="adjustedStopLoss" type="number" min="0" step="0.01" value="${escapeHtml(trade.adjustedStopLoss ?? '')}" placeholder="Optional" />`)}
        </div>
        <div class="edit-form-row edit-classification-row" aria-label="Trade classification">
          ${field('Setup', renderPlayBookSetupSelect(trade))}
          ${field('Close Reason', renderCloseReasonSelect(trade))}
          ${field('Loss Reason', renderLossReasonSelect(trade))}
        </div>
        <div class="edit-form-row edit-tags-row">
          ${field('Tags', `<input name="tags" value="${escapeHtml(trade.tags)}" placeholder="gap, reversal, A+" />`)}
        </div>
        <details class="edit-collapsible">
          <summary>${icon('book')} Notes</summary>
          ${field('Notes', `<textarea name="notes" rows="5" placeholder="What was the plan? What happened? What will you repeat or avoid?">${escapeHtml(trade.notes)}</textarea>`)}
        </details>
        <details class="edit-collapsible">
          <summary>${icon('image')} Screenshot Attachment</summary>
          <div class="screenshot-upload-field">
            <label class="screenshot-upload">
              <span>${icon('image')} Trade screenshot</span>
              <input name="editScreenshot" type="file" accept="image/*" data-edit-screenshot-input="${escapeHtml(trade.id)}" />
              <small>Optional. Upload or paste an image to attach it to this imported trade.</small>
              <small>Tip: Paste a screenshot with Ctrl+V / Cmd+V</small>
            </label>
            <div class="screenshot-field-preview" data-edit-screenshot-preview="${escapeHtml(trade.id)}" aria-live="polite">
              ${currentScreenshot ? screenshotLink(currentScreenshot, `${getTradeDisplaySymbol(trade)} trade screenshot`) : ''}
            </div>
            ${removeButton}
          </div>
        </details>
        <p class="edit-import-note">Imported cTrader execution fields are read-only and will be preserved when journaling edits are saved.</p>
        <div class="edit-form-actions">
          <button class="icon-button" type="button" data-delete-trade="${escapeHtml(trade.id)}" aria-label="Delete ${escapeHtml(trade.symbol)} trade">
            ${icon('trash')} Delete
          </button>
          <div class="edit-save-actions">
            <button class="secondary-button" type="button" data-cancel-edit-trade="${escapeHtml(trade.id)}">Cancel</button>
            <button class="primary-button" type="submit">${icon('save')} Save Changes</button>
          </div>
        </div>
      </form>`;
}

function getEditScreenshotDraft(tradeId) {
  return editScreenshotDrafts[tradeId] || {};
}

function getEditScreenshotPreview(trade) {
  const screenshotDraft = getEditScreenshotDraft(trade.id);
  if (screenshotDraft.removeScreenshot) {
    return null;
  }

  return screenshotDraft.selectedScreenshot || trade.screenshot || null;
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

function render(options = {}) {
  if (isTradeEditLocked() && !options.force) {
    return;
  }

  const stats = getStats();
  const pnlReports = getPnlReports();
  const [dailyPnl, weeklyPnl, monthlyPnl, yearlyPnl] = pnlReports;
  const dashboardCardRows = [
    {
      label: 'Overall Performance',
      cards: [
        statCard('trend', 'Net P&L', currency(stats.totalPnl), stats.totalPnl >= 0 ? 'positive' : 'negative'),
        statCard('target', 'Win Rate', formatPercent(stats.winRate)),
        statCard('chart', 'Trades Logged', stats.tradeCount),
        statCard('trend', 'Biggest Winner', stats.biggestWinner === null ? '—' : currency(stats.biggestWinner), stats.biggestWinner === null || stats.biggestWinner >= 0 ? 'positive' : 'negative'),
      ],
    },
    {
      label: 'Risk Metrics',
      cards: [
        statCard('line', 'Average Win / Loss', `${currency(stats.averageWin)} / ${currency(stats.averageLoss)}`),
        statCard('line', 'Average R', formatRMultiple(stats.averageR), stats.averageR === null || stats.averageR >= 0 ? 'positive' : 'negative'),
        statCard('target', 'Average Risk $', stats.averageRiskDollars === null ? '—' : currency(stats.averageRiskDollars)),
        statCard('target', 'Average Risk %', formatRiskPercent(stats.averageRiskPercent)),
      ],
    },
    {
      label: 'Time Performance',
      cards: [
        statCard('calendar', 'Daily P&L', currency(dailyPnl.pnl), dailyPnl.pnl >= 0 ? 'positive' : 'negative'),
        statCard('calendar', 'Weekly P&L', currency(weeklyPnl.pnl), weeklyPnl.pnl >= 0 ? 'positive' : 'negative'),
        statCard('calendar', 'Monthly P&L', currency(monthlyPnl.pnl), monthlyPnl.pnl >= 0 ? 'positive' : 'negative'),
        statCard('calendar', 'Yearly P&L', currency(yearlyPnl.pnl), yearlyPnl.pnl >= 0 ? 'positive' : 'negative'),
      ],
    },
  ];
  const filteredTrades = getFilteredTrades();
  const setupAnalyticsSection = renderSetupAnalytics();
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
          <button class="share-dashboard-button" type="button" id="shareDashboard">${icon('share')} Share Dashboard</button>
          ${renderCTraderConnectionCard()}
        </div>
      </section>

      <section class="dashboard-snapshot" id="dashboardSnapshot" aria-label="Dashboard share snapshot">
        <div class="dashboard-snapshot-header">
          <div>
            <p class="eyebrow">${icon('share')} Dashboard Snapshot</p>
            <h2>Jeremy Trading Journal Results</h2>
          </div>
          <p>Generated ${new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</p>
        </div>
        <section class="dashboard-card-groups" aria-label="Trading performance summary">
          ${dashboardCardRows.map((row) => `
            <section class="stats-grid dashboard-card-row" aria-label="${row.label}">
              ${row.cards.join('')}
            </section>`).join('')}
        </section>

        ${setupAnalyticsSection}
      </section>

      <section class="workspace-grid">
        <section class="panel journal-panel">
          <div class="journal-header">
            <div>
              <div class="section-title">${icon('calendar')}<h2>Journal entries</h2></div>
              <p class="section-helper">Review, search, and edit imported cTrader trades first. Manual entries are available below when needed.</p>
            </div>
            <input class="search-input" id="searchInput" placeholder="Search trades..." value="${escapeHtml(searchQuery)}" />
          </div>
          <div class="trade-list">
            ${filteredTrades.length ? filteredTrades.map(tradeCard).join('') : '<p class="empty-state">No trades match your search yet.</p>'}
          </div>
        </section>

        <section class="manual-trade-panel">
          <button class="secondary-button manual-trade-toggle" type="button" id="toggleManualTrade" aria-expanded="${isManualTradeFormOpen ? 'true' : 'false'}" aria-controls="tradeForm">
            ${icon(isManualTradeFormOpen ? 'minus' : 'plus')} ${isManualTradeFormOpen ? 'Hide Manual Trade Form' : '+ Add Manual Trade'}
          </button>
          ${isManualTradeFormOpen ? renderManualTradeForm(today) : '<p class="manual-trade-helper">Use this only for trades that did not come from cTrader import.</p>'}
        </section>
      </section>
    </main>
  `;

  bindEvents();
}

function renderManualTradeForm(today) {
  return `
    <form class="panel trade-form" id="tradeForm" aria-label="Add manual trade">
      <div class="section-title">${icon('plus')}<h2>Add manual trade</h2></div>
      <div class="form-grid">
        ${field('Date', '<input name="date" type="date" required value="' + today + '" />')}
        ${field('Symbol', '<input name="symbol" placeholder="SPY" required />')}
        ${field('Direction', '<select name="direction"><option>Long</option><option>Short</option></select>')}
        ${field('Setup', '<input name="setup" placeholder="Breakout, pullback, VWAP..." />')}
        ${field('Entry', '<input name="entry" type="number" min="0" step="0.01" required />')}
        ${field('Exit', '<input name="exit" type="number" min="0" step="0.01" required />')}
        ${field('Size', '<input name="size" type="number" min="0.01" step="0.01" required />')}
        ${field('Original Stop Loss', '<input name="stopLoss" type="number" min="0" step="0.01" placeholder="Optional" />')}
        ${field('Adjusted Stop Loss', '<input name="adjustedStopLoss" type="number" min="0" step="0.01" placeholder="Optional" />')}
        ${field('Account Size', '<input name="accountSize" type="number" min="0" step="0.01" placeholder="Optional" />')}
        ${field('Risk %', '<input name="riskPercent" type="number" min="0" step="0.01" placeholder="Calculated" readonly />')}
        ${field('Fees', '<input name="fees" type="number" min="0" step="0.01" value="0" />')}
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
  `;
}

function getInlineStylesheetText() {
  return [...document.styleSheets]
    .map((styleSheet) => {
      try {
        return [...styleSheet.cssRules].map((rule) => rule.cssText).join('\n');
      } catch {
        return '';
      }
    })
    .join('\n');
}

function downloadBlob(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Dashboard snapshot image could not be generated.'));
    image.src = src;
  });
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error('Dashboard snapshot PNG could not be created.'));
    }, 'image/png');
  });
}

async function shareDashboardSnapshot() {
  const dashboard = document.querySelector('#dashboardSnapshot');
  const shareButton = document.querySelector('#shareDashboard');
  if (!dashboard || !shareButton) {
    return;
  }

  const originalButtonText = shareButton.innerHTML;
  shareButton.disabled = true;
  shareButton.innerHTML = `${icon('download')} Preparing PNG...`;

  try {
    const exportWidth = 1200;
    const scale = 2;
    const clonedDashboard = dashboard.cloneNode(true);
    clonedDashboard.removeAttribute('id');
    clonedDashboard.classList.add('dashboard-snapshot-export');

    const wrapper = document.createElement('div');
    wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    wrapper.append(clonedDashboard);

    const height = Math.ceil(dashboard.scrollHeight * (exportWidth / dashboard.getBoundingClientRect().width));
    const serializedHtml = new XMLSerializer().serializeToString(wrapper);
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${exportWidth}" height="${height}" viewBox="0 0 ${exportWidth} ${height}">
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml">
            <style>${getInlineStylesheetText()}</style>
            ${serializedHtml}
          </div>
        </foreignObject>
      </svg>`;

    const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    const canvas = document.createElement('canvas');
    canvas.width = exportWidth * scale;
    canvas.height = height * scale;
    const context = canvas.getContext('2d');
    context.fillStyle = '#eef3fb';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.scale(scale, scale);
    context.drawImage(image, 0, 0);

    const pngBlob = await canvasToPngBlob(canvas);
    downloadBlob(pngBlob, `jeremy-dashboard-snapshot-${new Date().toISOString().slice(0, 10)}.png`);
  } finally {
    shareButton.disabled = false;
    shareButton.innerHTML = originalButtonText;
  }
}

function field(label, control) {
  return `<label class="field"><span>${label}</span>${control}</label>`;
}

function bindEvents() {
  const tradeForm = document.querySelector('#tradeForm');
  const screenshotInput = tradeForm?.querySelector('input[name="screenshot"]');

  document.querySelector('#toggleManualTrade').addEventListener('click', toggleManualTradeForm);
  document.querySelector('#shareDashboard').addEventListener('click', shareDashboardSnapshot);
  if (tradeForm) {
    tradeForm.addEventListener('submit', submitTrade);
    tradeForm.addEventListener('input', updateRiskPercentField);
    screenshotInput?.addEventListener('change', changeScreenshot);
  }

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
  document.querySelector('#connectCTrader')?.addEventListener('click', startCTraderOAuthFlow);
  document.querySelector('#syncCTrader').addEventListener('click', () => syncCTrader({ source: 'manual' }));
  document.querySelector('#deleteAllCTraderImports').addEventListener('click', deleteAllCTraderImports);
  document.querySelector('#exportTrades').addEventListener('click', exportTrades);
  document.querySelector('#importTrades').addEventListener('change', importTrades);
  document.querySelectorAll('[data-setup-sort-key]').forEach((button) => {
    button.addEventListener('click', () => {
      setupAnalyticsSort = {
        key: button.dataset.setupSortKey,
        direction: button.dataset.setupSortDirection,
      };
      render();
    });
  });

  updateScreenshotFieldPreview();
  if (tradeForm) {
    updateRiskPercentField({ currentTarget: tradeForm });
  }

  document.querySelectorAll('[data-trade-card]').forEach(bindTradeCardEvents);
}

function bindTradeCardEvents(tradeCardElement) {
  tradeCardElement.querySelectorAll('.screenshot-link').forEach((link) => {
    link.addEventListener('click', openScreenshotLink);
  });

  tradeCardElement.querySelectorAll('[data-edit-trade]').forEach((button) => {
    button.addEventListener('click', () => {
      openTradeEdit(button.dataset.editTrade);
    });
  });

  tradeCardElement.querySelectorAll('[data-cancel-edit-trade]').forEach((button) => {
    button.addEventListener('click', () => {
      const tradeId = button.dataset.cancelEditTrade;
      if (String(editingTradeId) === String(tradeId)) {
        closeTradeEdit();
      }
      renderTradeCardInPlace(tradeId);
    });
  });

  tradeCardElement.querySelectorAll('[data-edit-trade-form]').forEach((form) => {
    form.addEventListener('submit', submitTradeEdit);
  });

  tradeCardElement.querySelectorAll('[data-setup-choice]').forEach((select) => {
    select.addEventListener('change', changeEditSetupChoice);
  });

  tradeCardElement.querySelectorAll('[data-edit-screenshot-input]').forEach((input) => {
    input.addEventListener('change', changeEditScreenshot);
  });

  tradeCardElement.querySelectorAll('[data-remove-edit-screenshot]').forEach((button) => {
    button.addEventListener('click', removeEditScreenshot);
  });

  tradeCardElement.querySelectorAll('[data-delete-trade]').forEach((button) => {
    button.addEventListener('click', () => {
      const deletedTrade = getTradeById(button.dataset.deleteTrade);
      rememberDeletedCTraderSourceKey(deletedTrade);
      if (String(editingTradeId) === String(button.dataset.deleteTrade)) {
        editingTradeId = null;
      }
      persistTrades(trades.filter((trade) => String(trade.id) !== String(button.dataset.deleteTrade)));
    });
  });
}

function removeEditScreenshot(event) {
  const tradeId = event.currentTarget.dataset.removeEditScreenshot;
  editScreenshotDrafts = {
    ...editScreenshotDrafts,
    [tradeId]: {
      ...getEditScreenshotDraft(tradeId),
      selectedScreenshot: null,
      pastedScreenshotFile: null,
      removeScreenshot: true,
    },
  };
  updateEditScreenshotFieldPreview(tradeId);
}

function changeEditSetupChoice(event) {
  const customSetupInput = event.currentTarget.closest('form')?.querySelector('[data-custom-setup]');
  if (!customSetupInput) {
    return;
  }

  customSetupInput.hidden = event.currentTarget.value !== CUSTOM_SETUP_OPTION;
  if (!customSetupInput.hidden) {
    customSetupInput.focus();
  }
}

function toggleManualTradeForm() {
  isManualTradeFormOpen = !isManualTradeFormOpen;
  if (!isManualTradeFormOpen) {
    selectedScreenshot = null;
    pastedScreenshotFile = null;
  }
  render();
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
    adjustedStopLoss: toOptionalNumber(formData.get('adjustedStopLoss')),
    accountSize: toOptionalNumber(formData.get('accountSize')),
    riskPercent: calculateRiskPercent({
      direction: formData.get('direction'),
      entry: formData.get('entry'),
      stopLoss: formData.get('stopLoss'),
      adjustedStopLoss: formData.get('adjustedStopLoss'),
      size: formData.get('size'),
      accountSize: formData.get('accountSize'),
    }),
    fees: Number(formData.get('fees')) || 0,
    tags: String(formData.get('tags')).trim(),
    notes: String(formData.get('notes')).trim(),
    screenshot,
  };

  selectedScreenshot = null;
  pastedScreenshotFile = null;
  persistTrades([nextTrade, ...trades]);
}

async function submitTradeEdit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const tradeId = form.dataset.editTradeForm;
  const formData = new FormData(form);
  const screenshotDraft = getEditScreenshotDraft(tradeId);
  const uploadedScreenshot = formData.get('editScreenshot');
  const closeReason = String(formData.get('closeReason')).trim();
  const adjustedStopLoss = isStopLossCloseReason(closeReason)
    ? toOptionalNumber(formData.get('exit'))
    : toOptionalNumber(formData.get('adjustedStopLoss'));
  const journalingUpdates = {
    setup: getSetupFormValue(formData),
    lossReason: String(formData.get('lossReason')).trim(),
    closeReason,
    tags: String(formData.get('tags')).trim(),
    notes: String(formData.get('notes')).trim(),
    adjustedStopLoss,
  };
  const resolvedScreenshot = screenshotDraft.removeScreenshot
    ? null
    : screenshotDraft.selectedScreenshot ?? await readScreenshot(uploadedScreenshot || screenshotDraft.pastedScreenshotFile);
  const screenshotUpdate = screenshotDraft.removeScreenshot || resolvedScreenshot
    ? { screenshot: resolvedScreenshot }
    : {};

  closeTradeEdit();
  delete editScreenshotDrafts[tradeId];
  persistTrades(trades.map((trade) => (
    // Keep the existing cTrader execution payload first: ? { ...trade, ...journalingUpdates }
    String(trade.id) === String(tradeId)
      ? { ...trade, ...journalingUpdates, ...screenshotUpdate }
      : trade
  )), { preserveTradeId: tradeId, renderOptions: { force: true } });
}

function updateRiskPercentField(event) {
  const form = event.currentTarget;
  const riskPercentInput = form.querySelector('input[name="riskPercent"]');
  if (!riskPercentInput) {
    return;
  }

  const formData = new FormData(form);
  const riskPercent = calculateRiskPercent({
    direction: formData.get('direction'),
    entry: formData.get('entry'),
    stopLoss: formData.get('stopLoss'),
    adjustedStopLoss: formData.get('adjustedStopLoss'),
    size: formData.get('size'),
    accountSize: formData.get('accountSize'),
  });

  riskPercentInput.value = riskPercent === null ? '' : formatRiskPercent(riskPercent).replace('%', '');
}

async function changeScreenshot(event) {
  pastedScreenshotFile = null;
  selectedScreenshot = await readScreenshot(event.target.files?.[0]);
  updateScreenshotFieldPreview();
}

async function changeEditScreenshot(event) {
  const tradeId = event.target.dataset.editScreenshotInput;
  const selectedEditScreenshot = await readScreenshot(event.target.files?.[0]);
  editScreenshotDrafts = {
    ...editScreenshotDrafts,
    [tradeId]: {
      selectedScreenshot: selectedEditScreenshot,
      pastedScreenshotFile: null,
      removeScreenshot: false,
    },
  };
  updateEditScreenshotFieldPreview(tradeId);
}

async function pasteScreenshot(event) {
  const file = getClipboardImageFile(event.clipboardData);
  if (!file) {
    return;
  }

  event.preventDefault();
  const editForm = document.activeElement?.closest?.('[data-edit-trade-form]')
    || (editingTradeId ? document.querySelector(`[data-edit-trade-form="${cssEscape(editingTradeId)}"]`) : null);
  if (editForm) {
    const tradeId = editForm.dataset.editTradeForm;
    setFileInputFile(editForm.querySelector('input[name="editScreenshot"]'), file);
    editScreenshotDrafts = {
      ...editScreenshotDrafts,
      [tradeId]: {
        selectedScreenshot: await readScreenshot(file),
        pastedScreenshotFile: file,
        removeScreenshot: false,
      },
    };
    updateEditScreenshotFieldPreview(tradeId);
    return;
  }

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

function updateEditScreenshotFieldPreview(tradeId) {
  const preview = document.querySelector(`[data-edit-screenshot-preview="${cssEscape(tradeId)}"]`);
  const trade = getTradeById(tradeId);
  if (!preview || !trade) {
    return;
  }

  const screenshot = getEditScreenshotPreview(trade);
  preview.innerHTML = screenshot ? screenshotLink(screenshot, `${getTradeDisplaySymbol(trade)} trade screenshot`) : '';
}

function cssEscape(value) {
  return typeof CSS !== 'undefined' && CSS.escape
    ? CSS.escape(String(value))
    : String(value).replace(/["\\]/g, '\\$&');
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

function renderCTraderConnectionCard() {
  const selectedAccount = getSelectedCTraderAccount();
  const selectedAccountLabel = selectedAccount
    ? formatCTraderAccountLabel(selectedAccount)
    : (selectedCTraderAccountId ? `Selected account ID ${selectedCTraderAccountId}` : 'No account selected');

  const options = cTraderAccounts.map((account) => {
    const accountId = String(getCTraderAccountId(account));
    return `<option value="${escapeHtml(accountId)}" ${accountId === String(selectedCTraderAccountId) ? 'selected' : ''}>${escapeHtml(formatCTraderAccountLabel(account))}</option>`;
  }).join('');

  return `
    <section class="ctrader-connection-card" aria-label="cTrader connection">
      <div class="ctrader-card-header">
        <label class="auto-sync-toggle">
          <input type="checkbox" id="autoSyncCTrader" ${isCTraderAutoSyncEnabled ? 'checked' : ''} />
          <span>Auto Sync ${isCTraderAutoSyncEnabled ? 'ON' : 'OFF'}</span>
        </label>
        ${!isCTraderConnected ? `<button class="connect-button" type="button" id="connectCTrader" ${isCheckingCTraderConnection ? 'disabled' : ''}>Connect cTrader</button>` : ''}
      </div>
      <dl class="ctrader-connection-summary" aria-label="cTrader connection summary">
        <div>
          <dt>cTrader</dt>
          <dd class="connection-${isCTraderConnected ? 'connected' : 'disconnected'}">${isCTraderConnected ? 'Connected' : 'Not Connected'}</dd>
        </div>
        <div>
          <dt>Selected Account</dt>
          <dd>${escapeHtml(selectedAccountLabel)}</dd>
        </div>
        <div>
          <dt>Account Balance</dt>
          <dd>${escapeHtml(formatCTraderAccountBalance())}</dd>
        </div>
        <div>
          <dt>Last Sync Time</dt>
          <dd>${escapeHtml(formatSyncTime(cTraderLastSyncAt))}</dd>
        </div>
      </dl>
      <div class="ctrader-account-selector">
        <label class="field" for="cTraderAccountSelect">
          <span>Account selector</span>
          <select id="cTraderAccountSelect" ${isLoadingCTraderAccounts || !cTraderAccounts.length ? 'disabled' : ''}>
            ${cTraderAccounts.length ? options : '<option value="">Connect cTrader to load accounts</option>'}
          </select>
        </label>
        <button class="secondary-button" type="button" id="refreshCTraderAccounts" ${isLoadingCTraderAccounts ? 'disabled' : ''}>${isLoadingCTraderAccounts ? 'Loading accounts...' : 'Refresh Accounts'}</button>
      </div>
      ${cTraderSyncStatus ? `<p class="import-status ${escapeHtml(cTraderSyncStatus.tone)}" role="status">${escapeHtml(cTraderSyncStatus.message)}</p>` : ''}
      <div class="ctrader-card-actions">
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
      </div>
    </section>
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
    isCTraderConnected = false;
    const error = new Error(status.error || 'cTrader is not connected.');
    error.url = url;
    throw error;
  }

  setCTraderBackendDiagnostics({ connectionStatus: describeCTraderConnectionStatus(status), tone: 'success' });
  isCTraderConnected = true;
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
    isCTraderConnected = true;

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
    isCTraderConnected = false;
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

  if (!isCTraderAutoSyncEnabled || isTradeEditLocked()) {
    return;
  }

  cTraderAutoSyncTimer = window.setInterval(() => {
    syncCTraderOnStartup();
  }, AUTO_SYNC_INTERVAL_MS);
}

async function syncCTraderOnStartup() {
  if (isTradeEditLocked()) {
    return;
  }

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
    isCTraderConnected = false;
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
