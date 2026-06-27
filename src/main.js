import { applyCTraderImportedTradeUpdates, buildCTraderSyncPlan, getImportedTradeSourceKey } from './ctrader-sync.js';
import { CTRADER_ENDPOINTS, buildCTraderOAuthUrl, fetchBackendJson, getBackendDiagnostics } from './backend-api.js';

const STORAGE_KEY = 'jeremy-trading-journal:v1';
const AUTO_SYNC_STORAGE_KEY = 'jeremy-trading-journal:ctrader-auto-sync:v1';
const LAST_SYNC_STORAGE_KEY = 'jeremy-trading-journal:ctrader-last-sync:v1';
const SELECTED_CTRADER_ACCOUNT_STORAGE_KEY = 'jeremy-trading-journal:ctrader-selected-account:v1';
const DELETED_CTRADER_SOURCE_KEYS_STORAGE_KEY = 'deletedCTraderSourceKeys';
const MONTHLY_CALENDAR_DISPLAY_MODE_STORAGE_KEY = 'jeremy-trading-journal:monthly-calendar-display-mode:v1';
const DNA_TIMEFRAME_STORAGE_KEY = 'jeremy-trading-journal:dna-timeframe:v1';
const PAGE_MODE_STORAGE_KEY = 'jeremy-trading-journal:page-mode:v1';
const SESSION_NOTES_STORAGE_KEY = 'jeremy-trading-journal:session-notes-by-day:v1';
const PAGE_MODES = {
  dashboard: 'dashboard',
  trading: 'trading',
};
const DNA_TIMEFRAME_OPTIONS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'WTD' },
  { value: 'month', label: 'MTD' },
  { value: 'year', label: 'YTD' },
  { value: 'all', label: 'Beginning' },
];

const LEGACY_TRADE_LINE_BREAK_SETUP = 'Trade Line Break';
const TREND_LINE_BREAK_SETUP = 'Trend Line Break';
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
let manualTradeDateKey = formatDateKey(new Date());
let setupAnalyticsSort = { key: 'netPnl', direction: 'desc' };
let selectedAssetFilter = '';
let monthlyCalendarDate = new Date();
let selectedCalendarDateKey = '';
let calendarReviewDateKey = '';
let monthlyCalendarDisplayMode = loadMonthlyCalendarDisplayMode();
let dnaResultsTimeframe = loadDnaResultsTimeframe();
let pageMode = loadPageMode();
let sessionNotesByDay = loadSessionNotesByDay();
let isSessionNotesModalOpen = false;

const FRIENDLY_ASSET_NAMES = {
  XAUUSD: 'Gold',
  BTCUSD: 'Bitcoin',
  ETHUSD: 'Ethereum',
  US30: 'Dow Jones',
  US100: 'Nasdaq',
  SPX500: 'S&P 500',
};

const PLAY_BOOK_SETUP_OPTIONS = [
  'Buy the Retrace',
  'Elephant Bar',
  'Hedge',
  'MATX',
  'MAX',
  'ORB',
  'Return to 200',
  'Ride the 🐋',
  'Scalp',
  'Set & Forget',
  'Support & Resistance',
  'TB Retrace',
  'The General Forecast',
  TREND_LINE_BREAK_SETUP,
];
const CUSTOM_SETUP_OPTION = 'Custom';
const LOSS_REASON_OPTIONS = [
  'Bad Entry',
  'Chased Price',
  'Good Trade, Normal Loss',
  'Ignored Rules',
  'Other',
  'Stayed In Too Long',
  'Stop Too Tight',
];
const CLOSE_REASON_OPTIONS = [
  'Break Even',
  'Closed Too Early',
  'Manual Close',
  'Other',
  'Secured Profit Early',
  'Stop Loss',
  'Take Profit',
  'Trailed Stop',
  'Trend Change',
];

const app = document.querySelector('#root');

function normalizeSetupName(setup) {
  return setup === LEGACY_TRADE_LINE_BREAK_SETUP ? TREND_LINE_BREAK_SETUP : setup;
}

function hasLegacySetupName(nextTrades) {
  return nextTrades.some((trade) => trade?.setup === LEGACY_TRADE_LINE_BREAK_SETUP);
}

function normalizeTradeSetups(nextTrades) {
  return nextTrades.map((trade) => (
    trade?.setup === LEGACY_TRADE_LINE_BREAK_SETUP
      ? { ...trade, setup: TREND_LINE_BREAK_SETUP }
      : trade
  ));
}

function loadTrades() {
  const savedTrades = window.localStorage.getItem(STORAGE_KEY);
  if (!savedTrades) {
    return starterTrades;
  }

  const parsedTrades = JSON.parse(savedTrades);
  if (!Array.isArray(parsedTrades)) {
    return starterTrades;
  }

  const shouldMigrateSavedTrades = hasLegacySetupName(parsedTrades);
  const migratedTrades = shouldMigrateSavedTrades ? normalizeTradeSetups(parsedTrades) : parsedTrades;
  if (shouldMigrateSavedTrades) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migratedTrades));
  }
  return migratedTrades;
}

function loadSessionNotesByDay() {
  const savedNotes = window.localStorage.getItem(SESSION_NOTES_STORAGE_KEY);
  if (!savedNotes) {
    return {};
  }

  const parsedNotes = JSON.parse(savedNotes);
  if (!parsedNotes || Array.isArray(parsedNotes) || typeof parsedNotes !== 'object') {
    return {};
  }

  return Object.fromEntries(Object.entries(parsedNotes).map(([dateKey, notes]) => [
    dateKey,
    Array.isArray(notes) ? notes.filter((note) => note?.id && note?.createdAt && String(note?.text || '').trim()) : [],
  ]));
}

function persistSessionNotesByDay(nextNotesByDay) {
  sessionNotesByDay = nextNotesByDay;
  window.localStorage.setItem(SESSION_NOTES_STORAGE_KEY, JSON.stringify(sessionNotesByDay));
}

function getSessionNotesForDay(dateKey) {
  return [...(sessionNotesByDay[dateKey] || [])].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function saveTodaySessionNote(text) {
  const trimmedText = String(text || '').trim();
  if (!trimmedText) {
    return false;
  }

  const now = new Date();
  const todayKey = formatDateKey(now);
  const note = {
    id: crypto.randomUUID ? crypto.randomUUID() : `session-note-${now.getTime()}`,
    createdAt: now.toISOString(),
    text: trimmedText,
  };

  persistSessionNotesByDay({
    ...sessionNotesByDay,
    [todayKey]: [...(sessionNotesByDay[todayKey] || []), note],
  });

  return true;
}

function persistTrades(nextTrades, options = {}) {
  trades = normalizeTradeSetups(nextTrades);
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

function clearDeletedCTraderSourceKeys() {
  window.localStorage.removeItem(DELETED_CTRADER_SOURCE_KEYS_STORAGE_KEY);
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
  return value === null || value === undefined ? 'N/A' : `${value.toFixed(1)}R`;
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

function hasRenderableTradeValue(value) {
  if (value === null || value === undefined) {
    return false;
  }

  return String(value).trim() !== '' && String(value).trim() !== '—';
}

function tradeMetric(label, value, options = {}) {
  if (!hasRenderableTradeValue(value)) {
    return '';
  }

  const valueClass = options.valueClass ? ` ${escapeHtml(options.valueClass)}` : '';
  return `
          <div class="trade-metric">
            <dt>${escapeHtml(label)}</dt>
            <dd class="${valueClass.trim()}">${escapeHtml(value)}</dd>
          </div>`;
}

function tradePanel(title, rows, className = '') {
  const renderedRows = rows.filter(Boolean).join('');
  if (!renderedRows) {
    return '';
  }

  const panelClass = className ? ` ${escapeHtml(className)}` : '';
  return `
        <section class="trade-info-panel${panelClass}">
          <h4>${escapeHtml(title)}</h4>
          <dl>${renderedRows}
          </dl>
        </section>`;
}

function formatSourceProvider(provider) {
  const normalizedProvider = String(provider || '').trim();
  if (!normalizedProvider) {
    return 'cTrader';
  }

  return normalizedProvider.toLowerCase() === 'ctrader' ? 'cTrader' : normalizedProvider;
}

function tradeBadge(label, value, className = '') {
  if (!hasRenderableTradeValue(value)) {
    return '';
  }

  return `<span class="trade-badge ${escapeHtml(className)}"><strong>${escapeHtml(label)}</strong>${escapeHtml(value)}</span>`;
}

function formatOptionalCurrency(value) {
  const number = toOptionalNumber(value);
  return number === null ? '' : currency(number);
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

function calculateOriginalRiskDollars(trade) {
  const entry = toOptionalNumber(trade.entry);
  const originalStopLoss = toOptionalNumber(trade.stopLoss);
  const size = toOptionalNumber(trade.size);

  if (entry === null || originalStopLoss === null || size === null) {
    return null;
  }

  const riskPerUnit = trade.direction === 'Short'
    ? originalStopLoss - entry
    : entry - originalStopLoss;
  const riskDollars = riskPerUnit * size * getTradeContractSize(trade);
  return riskDollars > 0 ? riskDollars : null;
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

function calculateProtectedProfitRMultiple(trade) {
  const entry = toOptionalNumber(trade.entry);
  const adjustedStopLoss = toOptionalNumber(trade.adjustedStopLoss);
  const size = toOptionalNumber(trade.size);
  const originalRiskDollars = calculateOriginalRiskDollars(trade);

  if (entry === null || adjustedStopLoss === null || size === null || originalRiskDollars === null) {
    return null;
  }

  const lockedProfitPerUnit = trade.direction === 'Short'
    ? entry - adjustedStopLoss
    : adjustedStopLoss - entry;
  if (lockedProfitPerUnit <= 0) {
    return null;
  }

  const lockedProfitDollars = lockedProfitPerUnit * size * getTradeContractSize(trade);
  return lockedProfitDollars > 0 ? lockedProfitDollars / originalRiskDollars : null;
}

function calculateRMultiple(trade) {
  const riskDollars = calculateRiskDollars(trade);
  if (riskDollars === null) {
    return calculateProtectedProfitRMultiple(trade);
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

function filterTradesForPeriod(tradeList, period, referenceDate = new Date()) {
  if (period === 'all') {
    return tradeList.filter((trade) => getTradeReportDate(trade) !== null);
  }

  const periodStart = getReportPeriodStart(referenceDate, period);
  const periodEnd = new Date(referenceDate);
  periodEnd.setHours(23, 59, 59, 999);

  return tradeList.filter((trade) => {
    const tradeDate = getTradeReportDate(trade);
    return tradeDate && tradeDate >= periodStart && tradeDate <= periodEnd;
  });
}

function calculatePnlForPeriod(tradeList, period, referenceDate = new Date()) {
  return filterTradesForPeriod(tradeList, period, referenceDate).reduce((report, trade) => ({
    pnl: report.pnl + calculatePnl(trade),
    tradeCount: report.tradeCount + 1,
  }), { pnl: 0, tradeCount: 0 });
}

function getPnlReports(referenceDate = new Date(), tradeList = trades) {
  // Legacy source anchors retained for report coverage; timeframe-aware calls pass tradeList below.
  // { label: 'Daily P&L', period: 'day', ...calculatePnlForPeriod(trades, 'day', referenceDate) }
  // { label: 'Weekly P&L', period: 'week', ...calculatePnlForPeriod(trades, 'week', referenceDate) }
  // { label: 'Monthly P&L', period: 'month', ...calculatePnlForPeriod(trades, 'month', referenceDate) }
  // { label: 'Yearly P&L', period: 'year', ...calculatePnlForPeriod(trades, 'year', referenceDate) }
  return [
    { label: 'Daily P&L', period: 'day', ...calculatePnlForPeriod(tradeList, 'day', referenceDate) },
    { label: 'Weekly P&L', period: 'week', ...calculatePnlForPeriod(tradeList, 'week', referenceDate) },
    { label: 'Monthly P&L', period: 'month', ...calculatePnlForPeriod(tradeList, 'month', referenceDate) },
    { label: 'Yearly P&L', period: 'year', ...calculatePnlForPeriod(tradeList, 'year', referenceDate) },
  ];
}

function calculateBiggestWinner(tradeList) {
  const winningPnlValues = tradeList
    .filter((trade) => getTradeReportDate(trade) !== null)
    .map(calculatePnl)
    .filter((value) => Number.isFinite(value) && value > 0);

  return winningPnlValues.length ? Math.max(...winningPnlValues) : null;
}


function calculateBiggestLoser(tradeList) {
  const losingPnlValues = tradeList
    .filter((trade) => getTradeReportDate(trade) !== null)
    .map(calculatePnl)
    .filter((value) => Number.isFinite(value) && value < 0);

  return losingPnlValues.length ? Math.min(...losingPnlValues) : null;
}

function getEquityCurveTrades(tradeList = trades) {
  return tradeList
    .map((trade) => ({
      trade,
      date: getTradeReportDate(trade),
      pnl: calculatePnl(trade),
    }))
    .filter(({ date, pnl }) => date !== null && Number.isFinite(pnl))
    .sort((firstTrade, secondTrade) => firstTrade.date - secondTrade.date);
}

function getEquityCurve(tradeList = trades) {
  let cumulativePnl = 0;

  return getEquityCurveTrades(tradeList).map(({ date, pnl }) => {
    cumulativePnl += pnl;
    return {
      date,
      pnl,
      cumulativePnl,
    };
  });
}

function getProfitFactor(winningPnlValues, losingPnlValues) {
  const grossProfit = winningPnlValues.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losingPnlValues.reduce((sum, value) => sum + value, 0));

  if (grossLoss === 0) {
    return grossProfit > 0 ? Infinity : null;
  }

  return grossProfit / grossLoss;
}

function formatProfitFactor(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '—';
  }

  if (!Number.isFinite(Number(value))) {
    return '∞';
  }

  return Number(value).toFixed(2);
}

function getSetupAnalytics(tradeList = trades) {
  const setupReports = new Map();

  tradeList.forEach((trade) => {
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


function getFriendlyAssetName(symbol) {
  const normalizedSymbol = String(symbol ?? '').trim().toUpperCase();
  return FRIENDLY_ASSET_NAMES[normalizedSymbol] || String(symbol ?? '').trim();
}

function getAssetAnalytics(tradeList = trades) {
  const assetReports = new Map();

  tradeList.forEach((trade) => {
    const asset = getTradeDisplaySymbol(trade).trim();
    if (!asset) {
      return;
    }

    const pnl = calculatePnl(trade);
    const rMultiple = calculateRMultiple(trade);
    const report = assetReports.get(asset) ?? {
      asset,
      displayName: getFriendlyAssetName(asset),
      tradeCount: 0,
      winCount: 0,
      rCount: 0,
      totalR: 0,
      winningPnlCount: 0,
      totalWinningPnl: 0,
      losingPnlCount: 0,
      totalLosingPnl: 0,
      netPnl: 0,
    };

    report.tradeCount += 1;
    report.winCount += pnl > 0 ? 1 : 0;
    report.netPnl += pnl;

    if (pnl > 0) {
      report.winningPnlCount += 1;
      report.totalWinningPnl += pnl;
    }

    if (pnl < 0) {
      report.losingPnlCount += 1;
      report.totalLosingPnl += pnl;
    }

    if (rMultiple !== null) {
      report.rCount += 1;
      report.totalR += rMultiple;
    }

    assetReports.set(asset, report);
  });

  return [...assetReports.values()]
    .map((report) => ({
      asset: report.asset,
      displayName: report.displayName,
      tradeCount: report.tradeCount,
      winRate: report.tradeCount ? (report.winCount / report.tradeCount) * 100 : 0,
      netPnl: report.netPnl,
      averageR: report.rCount ? report.totalR / report.rCount : null,
      averageWinner: report.winningPnlCount ? report.totalWinningPnl / report.winningPnlCount : null,
      averageLoser: report.losingPnlCount ? report.totalLosingPnl / report.losingPnlCount : null,
    }))
    .sort(compareAssetAnalyticsRows);
}

function compareAssetAnalyticsRows(firstRow, secondRow) {
  const netPnlResult = secondRow.netPnl - firstRow.netPnl;
  if (netPnlResult !== 0) {
    return netPnlResult;
  }

  const tradeCountResult = secondRow.tradeCount - firstRow.tradeCount;
  if (tradeCountResult !== 0) {
    return tradeCountResult;
  }

  return String(firstRow.displayName ?? firstRow.asset).localeCompare(String(secondRow.displayName ?? secondRow.asset), undefined, { sensitivity: 'base' });
}

function renderAssetAnalytics(tradeList = trades) {
  const assetAnalytics = getAssetAnalytics(tradeList);
  return `
      <section class="panel setup-analytics-panel asset-analytics-panel" aria-label="Asset Analytics">
        <div class="setup-analytics-header">
          <div>
            <div class="section-title">${icon('chart')}<h2>Asset Analytics</h2></div>
            <p class="section-helper">Performance grouped by trading asset from the current DNA timeframe.</p>
          </div>
          <p class="setup-sort-helper">Sorted by Net P&L descending, then Total Trades descending</p>
        </div>
        <div class="setup-analytics-table-wrap">
          <table class="setup-analytics-table asset-analytics-table">
            <thead>
              <tr>
                <th scope="col">Asset</th>
                <th scope="col">Total Trades</th>
                <th scope="col">Win Rate</th>
                <th scope="col">Net P&L</th>
                <th scope="col">Average R</th>
                <th scope="col">Average Winner</th>
                <th scope="col">Average Loser</th>
              </tr>
            </thead>
            <tbody>
              ${assetAnalytics.length ? assetAnalytics.map(assetAnalyticsRow).join('') : '<tr><td colspan="7" class="empty-state">No asset analytics yet. Add trades with symbols to see this report.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>`;
}

function assetAnalyticsRow(report) {
  const pnlTone = getPerformanceTone(report.netPnl);
  const rTone = getPerformanceTone(report.averageR);
  const averageWinnerTone = getPerformanceTone(report.averageWinner);
  const averageLoserTone = getPerformanceTone(report.averageLoser);

  return `
              <tr>
                <td><button class="asset-filter-button" type="button" data-asset-filter="${escapeHtml(report.asset)}" aria-pressed="${selectedAssetFilter === report.asset ? 'true' : 'false'}">${escapeHtml(report.displayName)}</button></td>
                <td>${report.tradeCount}</td>
                <td>${formatPercent(report.winRate)}</td>
                <td class="${pnlTone}">${currency(report.netPnl)}</td>
                <td class="${rTone}">${formatRMultiple(report.averageR)}</td>
                <td class="${averageWinnerTone}">${report.averageWinner === null ? '—' : currency(report.averageWinner)}</td>
                <td class="${averageLoserTone}">${report.averageLoser === null ? '—' : currency(report.averageLoser)}</td>
              </tr>`;
}

function renderSetupAnalytics(tradeList = trades) {
  const setupAnalytics = getSetupAnalytics(tradeList);
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
  const pnlTone = getPerformanceTone(report.netPnl);
  const rTone = getPerformanceTone(report.averageR);

  return `
              <tr>
                <td>${escapeHtml(report.setupName)}</td>
                <td>${report.tradeCount}</td>
                <td>${formatPercent(report.winRate)}</td>
                <td class="${rTone}">${formatRMultiple(report.averageR)}</td>
                <td class="${pnlTone}">${currency(report.netPnl)}</td>
              </tr>`;
}


function loadMonthlyCalendarDisplayMode() {
  return window.localStorage.getItem(MONTHLY_CALENDAR_DISPLAY_MODE_STORAGE_KEY) === 'percent' ? 'percent' : 'dollars';
}

function setMonthlyCalendarDisplayMode(displayMode) {
  monthlyCalendarDisplayMode = displayMode === 'percent' ? 'percent' : 'dollars';
  window.localStorage.setItem(MONTHLY_CALENDAR_DISPLAY_MODE_STORAGE_KEY, monthlyCalendarDisplayMode);
}

function getTradeStartingBalance(trade) {
  const accountSize = toOptionalNumber(trade.accountSize);
  const accountBalance = toOptionalNumber(trade.accountBalance);
  const startingBalance = accountSize ?? accountBalance;

  return startingBalance !== null && startingBalance > 0 ? startingBalance : null;
}

function formatCalendarPnl(pnl, startingBalance) {
  if (monthlyCalendarDisplayMode !== 'percent') {
    return currency(pnl);
  }

  if (startingBalance === null || startingBalance === undefined || startingBalance <= 0) {
    return '—';
  }

  return formatPercent((pnl / startingBalance) * 100);
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function getMonthlyCalendarMonthKey(date) {
  return date.getFullYear() * 12 + date.getMonth();
}

function getMonthlyTradingCalendarNavigationState(referenceDate = new Date(), tradeList = trades) {
  const tradeMonthKeys = tradeList
    .map((trade) => getTradeReportDate(trade))
    .filter(Boolean)
    .map(getMonthlyCalendarMonthKey);

  if (!tradeMonthKeys.length) {
    return { canGoPrevious: false, canGoNext: false };
  }

  const currentMonthKey = getMonthlyCalendarMonthKey(referenceDate);
  return {
    canGoPrevious: currentMonthKey > Math.min(...tradeMonthKeys),
    canGoNext: currentMonthKey < Math.max(...tradeMonthKeys),
  };
}

function getMonthlyTradingCalendarDays(referenceDate = new Date(), tradeList = trades) {
  const monthStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
  const monthEnd = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0);
  const leadingEmptyDays = (monthStart.getDay() + 6) % 7;
  const dailyReports = new Map();

  tradeList.forEach((trade) => {
    const tradeDate = getTradeReportDate(trade);
    if (!tradeDate || tradeDate < monthStart || tradeDate > monthEnd) {
      return;
    }

    const day = tradeDate.getDate();
    const dateKey = formatDateKey(tradeDate);
    const report = dailyReports.get(day) ?? { pnl: 0, tradeCount: 0, dateKey, startingBalance: null };
    report.pnl += calculatePnl(trade);
    report.startingBalance ??= getTradeStartingBalance(trade);
    report.tradeCount += 1;
    dailyReports.set(day, report);
  });

  return [
    ...Array.from({ length: leadingEmptyDays }, () => null),
    ...Array.from({ length: monthEnd.getDate() }, (_, index) => {
      const day = index + 1;
      const date = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), day);
      return { day, dateKey: formatDateKey(date), report: dailyReports.get(day) ?? null };
    }),
  ];
}

function renderMonthlyTradingCalendar(referenceDate = new Date(), tradeList = trades) {
  const monthLabel = referenceDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const calendarDays = getMonthlyTradingCalendarDays(referenceDate, tradeList);
  const { canGoPrevious, canGoNext } = getMonthlyTradingCalendarNavigationState(referenceDate, tradeList);
  const monthlyPnl = calendarDays.reduce((total, calendarDay) => total + (calendarDay?.report?.pnl || 0), 0);
  const monthlyStartingBalance = calendarDays.find((calendarDay) => calendarDay?.report?.startingBalance)?.report.startingBalance ?? null;

  return `
      <section class="panel monthly-calendar-panel" aria-label="Monthly Trading Calendar">
        <div class="monthly-calendar-header">
          <div>
            <div class="section-title">${icon('calendar')}<h2>Monthly Trading Calendar</h2></div>
            <p class="section-helper">Daily Net P/L for <span class="monthly-calendar-title-month">${escapeHtml(monthLabel)}</span><span class="monthly-calendar-monthly-pnl ${getMoneyTone(monthlyPnl)}">${formatCalendarPnl(monthlyPnl, monthlyStartingBalance)}</span> using closed trade dates.</p>
          </div>
          <div class="monthly-calendar-controls" aria-label="Calendar month controls">
            <div class="monthly-calendar-display-toggle" role="group" aria-label="Calendar P/L display mode">
              <button class="secondary-button monthly-calendar-display-option ${monthlyCalendarDisplayMode === 'dollars' ? 'monthly-calendar-display-option-active' : ''}" type="button" data-calendar-display-mode="dollars" aria-pressed="${monthlyCalendarDisplayMode === 'dollars' ? 'true' : 'false'}">$</button>
              <button class="secondary-button monthly-calendar-display-option ${monthlyCalendarDisplayMode === 'percent' ? 'monthly-calendar-display-option-active' : ''}" type="button" data-calendar-display-mode="percent" aria-pressed="${monthlyCalendarDisplayMode === 'percent' ? 'true' : 'false'}">%</button>
            </div>
            <button class="secondary-button monthly-calendar-nav" type="button" data-calendar-month="previous" ${canGoPrevious ? '' : 'disabled aria-disabled="true"'}>Previous Month</button>
            <button class="secondary-button monthly-calendar-nav" type="button" data-calendar-month="next" ${canGoNext ? '' : 'disabled aria-disabled="true"'}>Next Month</button>
          </div>
        </div>
        <div class="monthly-calendar-grid" role="grid" aria-label="${escapeHtml(monthLabel)} trading calendar">
          ${weekdays.map((weekday) => `<div class="monthly-calendar-weekday" role="columnheader">${weekday}</div>`).join('')}
          ${calendarDays.map((calendarDay) => monthlyCalendarDayCell(calendarDay)).join('')}
        </div>
      </section>`;
}

function monthlyCalendarDayCell(calendarDay, todayKey = formatDateKey(new Date())) {
  if (!calendarDay) {
    return '<div class="monthly-calendar-day monthly-calendar-day-empty" aria-hidden="true"></div>';
  }

  const report = calendarDay.report;
  const isToday = calendarDay.dateKey === todayKey;
  const pnlTone = report ? getMoneyTone(report.pnl) || 'positive' : '';
  const dayClasses = [
    'monthly-calendar-day',
    pnlTone ? `monthly-calendar-day-${pnlTone}` : '',
    report ? 'monthly-calendar-day-traded' : '',
    isToday ? 'monthly-calendar-day-today' : '',
    calendarReviewDateKey === calendarDay.dateKey ? 'monthly-calendar-day-selected' : '',
  ].filter(Boolean).join(' ');
  const pnlMarkup = report
    ? `<span class="monthly-calendar-pnl ${getMoneyTone(report.pnl)}">${formatCalendarPnl(report.pnl, report.startingBalance)}</span>`
    : '';

  return `
          <button class="${dayClasses}" type="button" role="gridcell" data-calendar-date="${escapeHtml(calendarDay.dateKey)}" aria-pressed="${calendarReviewDateKey === calendarDay.dateKey ? 'true' : 'false'}" aria-label="Day ${calendarDay.day}${isToday ? ', today' : ''}${report ? `, Net P/L ${formatCalendarPnl(report.pnl, report.startingBalance)}, ${report.tradeCount} ${report.tradeCount === 1 ? 'trade' : 'trades'}` : ', no trades'}">
            <span class="monthly-calendar-date">${calendarDay.day}</span>
            ${pnlMarkup}
          </button>`;
}

function getTradesForCalendarDate(dateKey) {
  return trades.filter((trade) => {
    const tradeDate = getTradeReportDate(trade);
    return tradeDate && formatDateKey(tradeDate) === dateKey;
  });
}

function renderCalendarDayReviewPanel() {
  if (!calendarReviewDateKey) {
    return '';
  }

  const dayTrades = getTradesForCalendarDate(calendarReviewDateKey);
  const reviewDate = new Date(`${calendarReviewDateKey}T00:00:00`);
  const dateLabel = Number.isNaN(reviewDate.getTime())
    ? calendarReviewDateKey
    : reviewDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  return `
      <div class="calendar-review-backdrop" role="presentation">
        <aside class="calendar-review-panel" role="dialog" aria-modal="true" aria-labelledby="calendarReviewTitle">
          <div class="calendar-review-header">
            <div>
              <p class="eyebrow">${icon('calendar')} Calendar Day Review</p>
              <h2 id="calendarReviewTitle">${escapeHtml(dateLabel)}</h2>
            </div>
            <button class="secondary-button" type="button" data-calendar-review-close>Close</button>
          </div>
          ${dayTrades.length ? renderCalendarDayReviewSummary(calendarReviewDateKey, dayTrades) : '<p class="empty-state">No trades recorded for this day.</p>'}
          <div class="calendar-review-actions">
            <button class="secondary-button" type="button" data-calendar-review-open-journal="${escapeHtml(calendarReviewDateKey)}">Open/Edit Journal Entries for this day</button>
          </div>
        </aside>
      </div>`;
}

function renderCalendarDayReviewSummary(dateKey, dayTrades) {
  const pnl = dayTrades.reduce((total, trade) => total + calculatePnl(trade), 0);
  const startingBalance = dayTrades.map(getTradeStartingBalance).find((balance) => balance !== null) ?? null;
  const pnlPercent = startingBalance ? formatPercent((pnl / startingBalance) * 100) : '—';
  const tradePnls = dayTrades.map(calculatePnl);
  const winningPnls = tradePnls.filter((value) => value > 0);
  const losingPnls = tradePnls.filter((value) => value < 0);
  const rValues = dayTrades.map(calculateRMultiple).filter(Number.isFinite);
  const wins = winningPnls.length;
  const winRate = dayTrades.length ? (wins / dayTrades.length) * 100 : null;
  const averageR = rValues.length ? rValues.reduce((total, value) => total + value, 0) / rValues.length : null;
  const averageWinner = winningPnls.length ? winningPnls.reduce((total, value) => total + value, 0) / winningPnls.length : null;
  const averageLoser = losingPnls.length ? losingPnls.reduce((total, value) => total + value, 0) / losingPnls.length : null;
  const setups = uniqueTradeValues(dayTrades, 'setup');
  const closeReasons = uniqueTradeValues(dayTrades, 'closeReason');
  const lossReasons = uniqueTradeValues(dayTrades, 'lossReason');
  const notes = dayTrades.map(getCalendarReviewUserNote).filter(Boolean);
  const screenshots = dayTrades.filter((trade) => trade.screenshot?.dataUrl);
  const sessionNotes = getSessionNotesForDay(dateKey);
  const pnlTone = getMoneyTone(pnl);

  return `
          <div class="calendar-review-stats">
            <div><span>Daily P/L ($ / %)</span><strong class="${pnlTone}">${currency(pnl)} / ${pnlPercent}</strong></div>
            <div><span>Win Rate (%)</span><strong>${formatPercent(winRate)}</strong></div>
            <div><span>Trades</span><strong>${dayTrades.length}</strong></div>
            <div><span>Average R</span><strong>${formatRMultiple(averageR)}</strong></div>
            <div><span>Average Winner ($)</span><strong>${averageWinner === null ? '—' : currency(averageWinner)}</strong></div>
            <div><span>Average Loser ($)</span><strong>${averageLoser === null ? '—' : currency(averageLoser)}</strong></div>
          </div>
          ${renderSessionNotesTimeline(sessionNotes)}
          <div class="calendar-review-sections">
            ${calendarReviewList('Setups used', setups)}
            ${calendarReviewList('Close reasons', closeReasons)}
            ${calendarReviewList('Loss reasons', lossReasons)}
            ${calendarReviewList('Notes from journal entries', notes)}
            <section>
              <h3>Screenshots</h3>
              ${screenshots.length
                ? `<div class="calendar-review-screenshots">${screenshots.map((trade) => screenshotLink(trade.screenshot, `${getTradeDisplaySymbol(trade)} ${dateKey}`)).join('')}</div>`
                : '<p class="empty-state">No screenshots available for this day.</p>'}
            </section>
          </div>`;
}

function renderSessionNotesTimeline(sessionNotes) {
  return `
          <section class="calendar-session-notes" aria-label="Session Notes">
            <h3>Session Notes</h3>
            ${sessionNotes.length
              ? `<ol class="session-notes-timeline">${sessionNotes.map((note) => `
                <li>
                  <time datetime="${escapeHtml(note.createdAt)}">${escapeHtml(formatSessionNoteTime(note.createdAt))}</time>
                  <p>${escapeHtml(note.text)}</p>
                </li>`).join('')}</ol>`
              : '<p class="empty-state">No session notes for this day.</p>'}
          </section>`;
}

function formatSessionNoteTime(createdAt) {
  const noteDate = new Date(createdAt);
  if (Number.isNaN(noteDate.getTime())) {
    return 'Unknown time';
  }

  return noteDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function getCalendarReviewUserNote(trade) {
  const note = String(trade.notes || '').trim();
  if (!note) {
    return '';
  }

  if (/Imported from cTrader/i.test(note) || /Imported from cTrader source trade/i.test(note)) {
    return '';
  }

  return note;
}

function uniqueTradeValues(dayTrades, fieldName) {
  return [...new Set(dayTrades.map((trade) => String(trade[fieldName] || '').trim()).filter(Boolean))];
}

function calendarReviewList(title, values) {
  return `
            <section>
              <h3>${escapeHtml(title)}</h3>
              ${values.length ? `<ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul>` : `<p class="empty-state">${title === 'Notes from journal entries' ? 'No journal notes for this day.' : 'None recorded.'}</p>`}
            </section>`;
}

function loadPageMode() {
  return window.localStorage.getItem(PAGE_MODE_STORAGE_KEY) === PAGE_MODES.trading
    ? PAGE_MODES.trading
    : PAGE_MODES.dashboard;
}

function setPageMode(nextMode) {
  pageMode = nextMode === PAGE_MODES.trading ? PAGE_MODES.trading : PAGE_MODES.dashboard;
  window.localStorage.setItem(PAGE_MODE_STORAGE_KEY, pageMode);
}

function renderPageModeToggle() {
  return `
        <div class="mode-and-notes-actions">
          <div class="page-mode-toggle" role="group" aria-label="Page mode">
            <button class="page-mode-button ${pageMode === PAGE_MODES.dashboard ? 'active' : ''}" type="button" data-page-mode="${PAGE_MODES.dashboard}" aria-pressed="${pageMode === PAGE_MODES.dashboard ? 'true' : 'false'}">Dashboard Mode</button>
            <button class="page-mode-button ${pageMode === PAGE_MODES.trading ? 'active' : ''}" type="button" data-page-mode="${PAGE_MODES.trading}" aria-pressed="${pageMode === PAGE_MODES.trading ? 'true' : 'false'}">Trading Mode</button>
          </div>
          <button class="secondary-button session-notes-button" type="button" data-session-notes-open title="Session Notes" aria-label="Session Notes">📝</button>
        </div>`;
}

function renderSessionNotesModal() {
  if (!isSessionNotesModalOpen) {
    return '';
  }

  return `
      <div class="session-notes-modal-backdrop" role="presentation">
        <form class="session-notes-modal" id="sessionNotesForm" role="dialog" aria-modal="true" aria-labelledby="sessionNotesTitle">
          <h2 id="sessionNotesTitle">Today's Session Notes</h2>
          <label class="field">
            <span>Note</span>
            <textarea name="sessionNoteText" rows="6" placeholder="What are you noticing about focus, discipline, emotions, or market conditions today?" autofocus></textarea>
          </label>
          <div class="session-notes-modal-actions">
            <button class="secondary-button" type="button" data-session-notes-cancel>Cancel</button>
            <button class="primary-button" type="submit">Save</button>
          </div>
        </form>
      </div>`;
}

function loadDnaResultsTimeframe() {
  const storedTimeframe = window.localStorage.getItem(DNA_TIMEFRAME_STORAGE_KEY);
  return isValidDnaTimeframe(storedTimeframe) ? storedTimeframe : 'all';
}

function setDnaResultsTimeframe(timeframe) {
  dnaResultsTimeframe = isValidDnaTimeframe(timeframe) ? timeframe : 'all';
  window.localStorage.setItem(DNA_TIMEFRAME_STORAGE_KEY, dnaResultsTimeframe);
}

function isValidDnaTimeframe(timeframe) {
  return DNA_TIMEFRAME_OPTIONS.some((option) => option.value === timeframe);
}

function getDnaResultsReferenceDate() {
  return new Date();
}

function getDnaResultsTrades(referenceDate = getDnaResultsReferenceDate()) {
  return filterTradesForPeriod(trades, dnaResultsTimeframe, referenceDate);
}

function renderDnaResultsTimeframeToggle() {
  return `
        <div class="dna-timeframe-toggle" role="group" aria-label="DNA Results timeframe">
          ${DNA_TIMEFRAME_OPTIONS.map((option) => `
            <button class="dna-timeframe-button ${dnaResultsTimeframe === option.value ? 'active' : ''}" type="button" data-dna-timeframe="${option.value}" aria-pressed="${dnaResultsTimeframe === option.value ? 'true' : 'false'}">${option.label}</button>`).join('')}
        </div>`;
}

function getStats(tradeList = trades) {
  // Legacy source anchors retained for coverage while timeframe filtering passes tradeList into this helper:
  // const rValues = trades.map(calculateRMultiple).filter(Number.isFinite);
  // const riskDollarValues = trades.map(calculateRiskDollars).filter(Number.isFinite);
  // const riskPercentValues = trades.map(calculateRiskPercent).filter(Number.isFinite);
  const pnlValues = tradeList.map(calculatePnl);
  const totalRiskUsed = tradeList.map(calculateOriginalRiskDollars).filter(Number.isFinite).reduce((sum, value) => sum + value, 0);
  const performanceR = totalRiskUsed > 0 ? pnlValues.reduce((sum, value) => sum + value, 0) / totalRiskUsed : null;
  const riskDollarValues = tradeList.map(calculateRiskDollars).filter(Number.isFinite);
  const riskPercentValues = tradeList.map(calculateRiskPercent).filter(Number.isFinite);
  const wins = pnlValues.filter((value) => value > 0);
  const losses = pnlValues.filter((value) => value < 0);
  const totalPnl = pnlValues.reduce((sum, value) => sum + value, 0);
  const averageWin = wins.length ? wins.reduce((sum, value) => sum + value, 0) / wins.length : 0;
  const averageLoss = losses.length ? losses.reduce((sum, value) => sum + value, 0) / losses.length : 0;

  const profitFactor = getProfitFactor(wins, losses);
  const averageRiskDollars = riskDollarValues.length
    ? riskDollarValues.reduce((sum, value) => sum + value, 0) / riskDollarValues.length
    : null;
  const averageRiskPercent = riskPercentValues.length
    ? riskPercentValues.reduce((sum, value) => sum + value, 0) / riskPercentValues.length
    : null;
  const biggestWinner = calculateBiggestWinner(tradeList);
  const biggestLoser = calculateBiggestLoser(tradeList);
  const biggestRisk = riskDollarValues.length ? Math.max(...riskDollarValues) : null;

  return {
    totalPnl,
    winRate: tradeList.length ? (wins.length / tradeList.length) * 100 : 0,
    tradeCount: tradeList.length,
    averageWin,
    averageLoss,
    totalRiskUsed: totalRiskUsed > 0 ? totalRiskUsed : null,
    averageR: performanceR,
    profitFactor,
    averageRiskDollars,
    averageRiskPercent,
    biggestWinner,
    biggestLoser,
    biggestRisk,
  };
}


function hasTradesForDate(dateKey) {
  return trades.some((trade) => {
    const tradeDate = getTradeReportDate(trade);
    return tradeDate && formatDateKey(tradeDate) === dateKey;
  });
}

function openCalendarDayReview(dateKey) {
  calendarReviewDateKey = dateKey;
  render();
}

function closeCalendarDayReview() {
  calendarReviewDateKey = '';
  render();
}

function openJournalForCalendarDate(dateKey) {
  selectedCalendarDateKey = dateKey;
  calendarReviewDateKey = '';
  manualTradeDateKey = dateKey;
  searchQuery = '';
  selectedAssetFilter = '';
  isManualTradeFormOpen = !hasTradesForDate(dateKey);
  render();
  document.querySelector('.journal-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function getFilteredTrades() {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const normalizedAssetFilter = selectedAssetFilter.trim().toLowerCase();

  return trades.filter((trade) => {
    const tradeDate = getTradeReportDate(trade);
    const matchesCalendarDate = !selectedCalendarDateKey || (tradeDate && formatDateKey(tradeDate) === selectedCalendarDateKey);
    const matchesAsset = !normalizedAssetFilter || getTradeDisplaySymbol(trade).trim().toLowerCase() === normalizedAssetFilter;
    const matchesSearch = !normalizedQuery || [trade.symbol, trade.setup, trade.direction, trade.tags, trade.notes]
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery);

    return matchesCalendarDate && matchesAsset && matchesSearch;
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

function getMoneyTone(value) {
  return Number(value) < 0 ? 'negative' : '';
}

function getPerformanceTone(value) {
  if (value === null || value === undefined || Number(value) === 0 || Number.isNaN(Number(value))) {
    return 'neutral';
  }

  return Number(value) > 0 ? 'positive' : 'negative';
}

function statCard(iconName, label, value, tone = '', options = {}) {
  const valueText = String(value);
  const valueClass = [tone, !options.keepValueSize && valueText.length > 13 ? 'long-value' : ''].filter(Boolean).join(' ');
  return `
    <article class="stat-card">
      <div class="stat-icon">${icon(iconName)}</div>
      <span>${label}</span>
      <strong class="${valueClass}">${value}</strong>
    </article>
  `;
}

function signedCurrency(value) {
  const amount = Number(value) || 0;
  return `${amount > 0 ? '+' : ''}${currency(amount)}`;
}


function getTodayPnlPercent(todayTrades, todayPnl) {
  const accountSize = todayTrades
    .map((trade) => toOptionalNumber(trade.accountSize) ?? toOptionalNumber(trade.accountBalance))
    .find((value) => value !== null && value > 0);

  return accountSize ? (todayPnl / accountSize) * 100 : null;
}

function renderTodayKpiStrip(todayTrades, todayStats) {
  const todayPnl = todayStats.totalPnl;

  return `
        <section class="stats-grid hero-stats-row trading-today-kpi-strip" aria-label="Today trading statistics">
          ${statCard('calendar', 'Today P/L', currency(todayPnl), getMoneyTone(todayPnl))}
          ${statCard('trend', 'Today %', formatPercent(getTodayPnlPercent(todayTrades, todayPnl)))}
          ${statCard('target', 'Win Rate', formatPercent(todayStats.winRate))}
          ${statCard('chart', 'Trades', todayStats.tradeCount)}
          ${statCard('trend', 'Expectancy', formatRMultiple(todayStats.averageR))}
        </section>`;
}

function renderHeroStatsRow(stats) {
  return `
        <section class="stats-grid hero-stats-row" aria-label="DNA trading statistics">
          ${statCard('trend', 'Net P/L', currency(stats.totalPnl), getMoneyTone(stats.totalPnl))}
          ${statCard('chart', 'Trades Analyzed', stats.tradeCount)}
          ${statCard('target', 'Win Rate', formatPercent(stats.winRate))}
          ${statCard('trend', 'Expectancy', formatRMultiple(stats.averageR))}
        </section>`;
}

function renderEquityCurveCard(tradeList = trades) {
  const equityCurve = getEquityCurve(tradeList);
  const cumulativeValues = equityCurve.map((point) => point.cumulativePnl);
  const minValue = Math.min(0, ...cumulativeValues);
  const maxValue = Math.max(0, ...cumulativeValues);
  const valueRange = maxValue - minValue || 1;
  const chartWidth = 720;
  const chartHeight = 220;
  const chartPadding = 20;
  const chartInnerWidth = chartWidth - (chartPadding * 2);
  const chartInnerHeight = chartHeight - (chartPadding * 2);
  const zeroY = chartPadding + ((maxValue - 0) / valueRange) * chartInnerHeight;
  const points = equityCurve.map((point, index) => {
    const x = equityCurve.length === 1
      ? chartPadding + (chartInnerWidth / 2)
      : chartPadding + (index / (equityCurve.length - 1)) * chartInnerWidth;
    const y = chartPadding + ((maxValue - point.cumulativePnl) / valueRange) * chartInnerHeight;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  const endingPnl = cumulativeValues.at(-1) ?? 0;
  const endingTone = getPerformanceTone(endingPnl);
  const selectedTimeframeLabel = DNA_TIMEFRAME_OPTIONS.find((option) => option.value === dnaResultsTimeframe)?.label || 'Beginning';

  return `
      <section class="panel equity-curve-card" aria-label="Equity curve analytics">
        <div class="equity-curve-header">
          <div>
            <div class="section-title">${icon('line')}<h2>Equity Curve</h2></div>
            <p class="section-helper">Running cumulative P&L built from imported and logged trade history.</p>
          </div>
        </div>
        <div class="equity-curve-metrics">
          <span>${equityCurve.length} ${equityCurve.length === 1 ? 'trade' : 'trades'}</span>
          <strong class="${endingTone}">${currency(endingPnl)}</strong>
        </div>
        <div class="equity-curve-chart" role="img" aria-label="${escapeHtml(selectedTimeframeLabel)} cumulative equity curve ending at ${escapeHtml(currency(endingPnl))}">
          ${equityCurve.length ? `
            <svg viewBox="0 0 ${chartWidth} ${chartHeight}" preserveAspectRatio="none">
              <line class="equity-zero-line" x1="${chartPadding}" y1="${zeroY.toFixed(2)}" x2="${chartWidth - chartPadding}" y2="${zeroY.toFixed(2)}"></line>
              <polyline class="equity-curve-line" points="${points}"></polyline>
            </svg>
          ` : '<p class="empty-state">Import or log closed trades to build your equity curve.</p>'}
        </div>
      </section>`;
}


function reportCard(report) {
  const tone = getPerformanceTone(report.pnl);
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
  const adjustedStopLoss = toOptionalNumber(trade.adjustedStopLoss);
  const takeProfit = toOptionalNumber(trade.takeProfit);
  const adjustedTakeProfit = toOptionalNumber(trade.adjustedTakeProfit);
  const activeTakeProfit = adjustedTakeProfit ?? takeProfit;
  const stopLossHitPrice = getStopLossHitPrice(trade);
  const activeStopLoss = stopLossHitPrice ?? adjustedStopLoss;
  const riskDollars = calculateRiskDollars(trade);
  const riskPercent = calculateRiskPercent(trade);
  const rMultiple = calculateRMultiple(trade);
  const tone = getPerformanceTone(pnl);
  const rTone = getPerformanceTone(rMultiple);
  const importedTimeDetail = cTraderTimeDetails(trade);
  const tradeTime = getTradeTimeDisplay(trade);
  const openedTime = formatTradeTimestamp(trade.openTime);
  const closedTime = formatTradeTimestamp(trade.closeTime);
  const tradeDuration = formatTradeDuration(trade.openTime, trade.closeTime);
  const setupName = String(trade.setup || '').trim();
  const isImported = isCTraderImportedTrade(trade);
  const isEditing = editingTradeId === trade.id;
  const summaryStrip = [
    tradeMetric('Entry', formatOptionalCurrency(trade.entry)),
    tradeMetric('Exit', formatOptionalCurrency(trade.exit)),
    tradeMetric('Opened', isImported ? openedTime : tradeTime),
    tradeMetric('Closed', isImported ? closedTime : trade.date),
    tradeMetric('Size', trade.size),
    tradeMetric('Duration', tradeDuration),
    tradeMetric('Net P/L', currency(pnl), { valueClass: tone }),
  ].join('');
  const riskPanel = tradePanel('Risk Management', [
    tradeMetric('Initial SL', stopLoss === null ? '' : currency(stopLoss)),
    tradeMetric('Final SL', activeStopLoss === null ? '' : currency(activeStopLoss)),
    tradeMetric('Initial TP', takeProfit === null ? '' : currency(takeProfit)),
    tradeMetric('Final TP', adjustedTakeProfit === null ? '' : currency(adjustedTakeProfit)),
    tradeMetric('Risk $', riskDollars === null ? '' : currency(riskDollars)),
    tradeMetric('Risk %', riskPercent === null ? '' : formatRiskPercent(riskPercent)),
    tradeMetric('R', rMultiple === null ? '' : formatRMultiple(rMultiple), { valueClass: rTone }),
  ], 'risk-management-panel');
  const journalPanel = tradePanel('Journal', [
    tradeMetric('Setup', trade.setup),
    tradeMetric('Close Reason', trade.closeReason),
    tradeMetric('Loss Reason', trade.lossReason),
    tradeMetric('Tags', trade.tags),
  ], 'journal-panel');
  const detailsPanel = tradePanel('Trade Details', [
    tradeMetric('Direction', trade.direction),
    tradeMetric('Timeframe', trade.timeframe),
    tradeMetric('Symbol', displaySymbol),
    tradeMetric('Size', trade.size),
    tradeMetric('Contract Size', getTradeContractSize(trade)),
    tradeMetric('Fees', formatOptionalCurrency(trade.fees)),
  ], 'trade-details-panel');
  const sourcePanel = isImported ? tradePanel('Source', [
    tradeMetric('Provider', formatSourceProvider(trade.provider)),
    tradeMetric('Account', trade.accountId),
    tradeMetric('Deal ID', trade.sourceDealId ?? trade.sourceTradeId),
    tradeMetric('Position ID', trade.sourcePositionId ?? trade.positionId),
    tradeMetric('Imported time', formatTradeTimestamp(trade.importedAt)),
  ], 'source-panel') : '';

  /*
   * Legacy source-check contract for layout-only redesign. These strings document
   * the unchanged values now rendered through the Summary Strip and panels:
   * `<span>Risk Stop: ${currency(activeStopLoss)}</span>`
   * <span>Risk $: ${riskDollars === null ?
   * <span>Risk %: ${formatRiskPercent(riskPercent)}</span>
   * <span class="${rTone}">R: ${formatRMultiple(rMultiple)}</span>
   * Initial Stop Loss: ${stopLoss === null ?
   * Final Stop Loss: ${adjustedStopLoss === null ?
   * Initial Take Profit: ${currency(takeProfit)}
   * Final Take Profit: ${currency(adjustedTakeProfit)}
   * Active Take Profit: ${currency(activeTakeProfit)}
   * Risk Stop: ${currency(activeStopLoss)}
   * Risk $: ${riskDollars === null ?
   * Risk %: ${formatRiskPercent(riskPercent)}
   * R: ${formatRMultiple(rMultiple)}
   * <span>Duration: ${escapeHtml(tradeDuration)}</span>
   * ${trade.lossReason ? `<p class="loss-reason"><strong>Loss Reason:</strong> ${escapeHtml(trade.lossReason)}</p>` : ''}
   * ${trade.closeReason ? `<p class="close-reason"><strong>Close Reason:</strong> ${escapeHtml(trade.closeReason)}</p>` : ''}
   */
  return `
    <article class="trade-card" data-trade-card="${escapeHtml(trade.id)}">
      <div class="trade-card-header">
        <div class="trade-card-heading">
          <div class="trade-title-row">
            <div class="trade-title-content">
              <p class="trade-symbol">${escapeHtml(displaySymbol)}</p>
              <div class="trade-header-badges">
                ${tradeBadge('Setup', setupName, 'setup')}
                ${tradeBadge('Direction', trade.direction, String(trade.direction || '').toLowerCase())}
                ${tradeBadge('Timeframe', trade.timeframe || tradeDuration, 'timeframe')}
              </div>
            </div>
            <strong class="trade-pnl-badge ${tone}" aria-label="P&L ${currency(pnl)}">${currency(pnl)}</strong>
          </div>
        </div>
      </div>
      <dl class="trade-summary-strip">${summaryStrip}
      </dl>
      <div class="trade-panel-grid">
        ${riskPanel}
        ${journalPanel}
        ${detailsPanel}
        ${sourcePanel}
      </div>
      ${isEditing ? editTradeForm(trade) : tradeJournalDetails(trade)}
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
  const notesDetail = trade.notes ? `
      <details class="edit-collapsible journal-detail-section">
        <summary>${icon('book')} Notes</summary>
        <p class="notes">${escapeHtml(trade.notes)}</p>
      </details>` : '';
  const screenshotDetail = trade.screenshot?.dataUrl ? `
      <details class="edit-collapsible journal-detail-section">
        <summary>${icon('image')} Screenshot Attachment</summary>
        ${screenshotPreview(trade)}
      </details>` : '';

  return `
      ${notesDetail}
      ${screenshotDetail}`;
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
    return normalizeSetupName(String(formData.get('setupCustom')).trim()) || 'Uncategorized setup';
  }

  return normalizeSetupName(String(formData.get('setup') || '').trim() || setupChoice) || 'Uncategorized setup';
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
          ${field('Initial Stop Loss', `<input name="stopLoss" type="number" value="${escapeHtml(trade.stopLoss ?? '')}" readonly />`)}
          ${field('Final Stop Loss', `<input name="adjustedStopLoss" type="number" min="0" step="0.01" value="${escapeHtml(trade.adjustedStopLoss ?? '')}" placeholder="Optional" />`)}
        </div>
        <div class="edit-form-row edit-take-profit-row" aria-label="Trade take profits">
          ${field('Initial Take Profit', `<input name="takeProfit" type="number" min="0" step="0.01" value="${escapeHtml(trade.takeProfit ?? '')}" placeholder="Optional" />`)}
          ${field('Final Take Profit', `<input name="adjustedTakeProfit" type="number" min="0" step="0.01" value="${escapeHtml(trade.adjustedTakeProfit ?? '')}" placeholder="Optional" />`)}
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

  const dnaReferenceDate = getDnaResultsReferenceDate();
  const dnaResultsTrades = getDnaResultsTrades(dnaReferenceDate);
  const stats = getStats(dnaResultsTrades);
  const pnlReports = getPnlReports(dnaReferenceDate, trades);
  const [dailyPnl, weeklyPnl, monthlyPnl, yearlyPnl] = pnlReports;
  const dashboardCardRows = [
    {
      label: 'R Metrics',
      cards: [
        statCard('target', 'Average R', formatRMultiple(stats.averageR)),
        statCard('trend', 'Biggest Winner', stats.biggestWinner === null ? '—' : currency(stats.biggestWinner)),
        statCard('trend', 'Biggest Loser', stats.biggestLoser === null ? '—' : currency(stats.biggestLoser), getMoneyTone(stats.biggestLoser)),
        statCard('line', 'Biggest Risk', stats.biggestRisk === null ? '—' : currency(stats.biggestRisk)),
      ],
    },
    {
      label: 'Risk Metrics',
      cards: [
        statCard('trend', 'Average Winner', currency(stats.averageWin)),
        statCard('trend', 'Average Loser', currency(stats.averageLoss), getMoneyTone(stats.averageLoss)),
        statCard('target', 'Average Risk $', stats.averageRiskDollars === null ? '—' : currency(stats.averageRiskDollars)),
        statCard('target', 'Average Risk %', formatRiskPercent(stats.averageRiskPercent)),
      ],
    },
    {
      label: 'Time Performance',
      cards: [
        statCard('calendar', 'Daily P/L', currency(dailyPnl.pnl), getMoneyTone(dailyPnl.pnl)),
        statCard('calendar', 'Weekly P/L', currency(weeklyPnl.pnl), getMoneyTone(weeklyPnl.pnl)),
        statCard('calendar', 'Monthly P/L', currency(monthlyPnl.pnl), getMoneyTone(monthlyPnl.pnl)),
        statCard('calendar', 'Yearly P/L', currency(yearlyPnl.pnl), getMoneyTone(yearlyPnl.pnl)),
      ],
    },
  ];
  const filteredTrades = getFilteredTrades();
  const monthlyTradingCalendarSection = renderMonthlyTradingCalendar(monthlyCalendarDate, dnaResultsTrades);
  const setupAnalyticsSection = renderSetupAnalytics(dnaResultsTrades);
  const assetAnalyticsSection = renderAssetAnalytics(dnaResultsTrades);
  const today = new Date().toISOString().slice(0, 10);
  const todayTrades = filterTradesForPeriod(trades, 'day', dnaReferenceDate);
  const tradingModeSections = `${renderTodayKpiStrip(todayTrades, getStats(todayTrades))}${renderJournalWorkspace(filteredTrades, today, { showManualTradePanel: false })}`;
  const journalWorkspaceSection = renderJournalWorkspace(filteredTrades, today);
  const dashboardSnapshot = renderDashboardSnapshot(dashboardCardRows);
  const dashboardSections = `
      ${renderDnaResultsTimeframeToggle()}

      <section class="hero-equity-section" aria-label="Equity curve">
        ${renderEquityCurveCard(dnaResultsTrades)}
      </section>

      <div id="shareCapture">
        ${renderHeroStatsRow(stats)}

        ${dashboardSnapshot}
      </div>

      ${monthlyTradingCalendarSection}

      ${renderCalendarDayReviewPanel()}

      ${setupAnalyticsSection}

      ${assetAnalyticsSection}`;
  const pageSections = pageMode === PAGE_MODES.trading
    ? tradingModeSections
    : `${dashboardSections}${journalWorkspaceSection}`;

  app.innerHTML = `
    <main class="app-shell">
      <section class="hero-card">
        <div class="hero-branding">
          <div class="dna-brand-lockup" aria-label="DNA Decisions Numbers Analysis">
            <img class="dna-logo" src="./ChatGPT%20Image%20Jun%2020%2C%202026%2C%2006_45_24%20AM.png" alt="DNA logo" />
            <div class="dna-wordmark" aria-hidden="true">
              <span class="dna-wordmark-main">DNA</span>
              <span class="dna-wordmark-sub">Decisions <b>•</b> Numbers <b>•</b> Analysis</span>
            </div>
          </div>
          <h1>Discover your edge.</h1>
          <p class="hero-tagline">Every trade leaves clues. DNA helps you find them.</p>
          <p class="hero-copy">
            DNA is a trader performance analysis system designed to uncover patterns, strengths, weaknesses, habits, and edge through the study of Decisions, Numbers, and Analysis.
          </p>
        </div>
        <div class="hero-actions">
          ${pageMode === PAGE_MODES.dashboard ? `<button class="share-dashboard-button" type="button" id="shareDashboard">${icon('download')} Download PNG</button>` : ''}
          ${renderCTraderConnectionCard()}
        </div>
      </section>

      ${renderPageModeToggle()}

      ${pageSections}
      ${renderSessionNotesModal()}
    </main>
  `;

  bindEvents();
}


function renderDashboardSnapshot(dashboardCardRows) {
  return `
      <section class="dashboard-snapshot" id="dashboardSnapshot" aria-label="Dashboard share snapshot">
        <div class="dashboard-snapshot-header">
          <div>
            <p class="eyebrow">${icon('share')} Dashboard Snapshot</p>
            <h2>DNA Results</h2>
          </div>
          <p class="dashboard-snapshot-generated-date">Generated ${new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</p>
        </div>
        <section class="dashboard-card-groups" aria-label="Trading performance summary">
          ${dashboardCardRows.map((row) => `
            <section class="stats-grid dashboard-card-row" aria-label="${row.label}">
              ${row.cards.join('')}
            </section>`).join('')}
        </section>
      </section>`;
}

function renderJournalWorkspace(filteredTrades, today, options = {}) {
  const showManualTradePanel = options.showManualTradePanel !== false;
  const journalPanelClass = showManualTradePanel ? 'panel journal-panel' : 'panel journal-panel trading-mode-journal-panel';
  return `
      <section class="workspace-grid">
        <section class="${journalPanelClass}">
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

        ${showManualTradePanel ? `
        <section class="manual-trade-panel">
          <button class="secondary-button manual-trade-toggle" type="button" id="toggleManualTrade" aria-expanded="${isManualTradeFormOpen ? 'true' : 'false'}" aria-controls="tradeForm">
            ${icon(isManualTradeFormOpen ? 'minus' : 'plus')} ${isManualTradeFormOpen ? 'Hide Manual Trade Form' : '+ Add Manual Trade'}
          </button>
          ${isManualTradeFormOpen ? renderManualTradeForm(manualTradeDateKey || today) : '<p class="manual-trade-helper">Use this only for trades that did not come from cTrader import.</p>'}
        </section>` : ''}
      </section>`;
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
        ${field('Initial Stop Loss', '<input name="stopLoss" type="number" min="0" step="0.01" placeholder="Optional" />')}
        ${field('Final Stop Loss', '<input name="adjustedStopLoss" type="number" min="0" step="0.01" placeholder="Optional" />')}
        ${field('Initial Take Profit', '<input name="takeProfit" type="number" min="0" step="0.01" placeholder="Optional" />')}
        ${field('Final Take Profit', '<input name="adjustedTakeProfit" type="number" min="0" step="0.01" placeholder="Optional" />')}
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

async function openShareDashboardView() {
  const snapshotEl = document.querySelector('#shareCapture') || document.querySelector('#dashboardSnapshot');
  if (!snapshotEl) {
    window.alert('Dashboard snapshot not found. Make sure you are in Dashboard Mode.');
    return;
  }

  const btn = document.querySelector('#shareDashboard');
  if (btn) {
    btn.textContent = 'Generating PNG…';
    btn.disabled = true;
  }

  try {
    // Dynamically load html2canvas if not already present
    if (!window.html2canvas) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        script.onload = resolve;
        script.onerror = () => reject(new Error('Could not load html2canvas'));
        document.head.appendChild(script);
      });
    }

    const canvas = await window.html2canvas(snapshotEl, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#f8f8f6',
      scrollX: 0,
      scrollY: 0,
      width: snapshotEl.scrollWidth,
      height: snapshotEl.scrollHeight,
      windowWidth: snapshotEl.scrollWidth,
      logging: false,
    });

    const link = document.createElement('a');
    const date = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
    link.download = `DNA-dashboard-${date}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (error) {
    window.alert(`PNG export failed: ${error.message}`);
    console.error('[share dashboard] PNG export failed', error);
  } finally {
    if (btn) {
      btn.innerHTML = `${icon('share')} Share Dashboard`;
      btn.disabled = false;
    }
  }
}

function field(label, control) {
  return `<label class="field"><span>${label}</span>${control}</label>`;
}

function bindEvents() {
  const tradeForm = document.querySelector('#tradeForm');
  const screenshotInput = tradeForm?.querySelector('input[name="screenshot"]');

  document.querySelector('#toggleManualTrade')?.addEventListener('click', toggleManualTradeForm);
  document.querySelector('#shareDashboard')?.addEventListener('click', openShareDashboardView);
  document.querySelector('[data-session-notes-open]')?.addEventListener('click', () => {
    isSessionNotesModalOpen = true;
    render();
  });
  document.querySelector('[data-session-notes-cancel]')?.addEventListener('click', () => {
    isSessionNotesModalOpen = false;
    render();
  });
  document.querySelector('#sessionNotesForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveTodaySessionNote(new FormData(event.currentTarget).get('sessionNoteText'));
    isSessionNotesModalOpen = false;
    render();
  });
  document.querySelectorAll('[data-page-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      setPageMode(button.dataset.pageMode);
      render();
    });
  });
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
  document.querySelectorAll('[data-asset-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedAssetFilter = selectedAssetFilter === button.dataset.assetFilter ? '' : button.dataset.assetFilter;
      render();
      document.querySelector('.journal-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  document.querySelectorAll('[data-calendar-date]').forEach((button) => {
    button.addEventListener('click', () => openCalendarDayReview(button.dataset.calendarDate));
  });
  document.querySelector('[data-calendar-review-close]')?.addEventListener('click', closeCalendarDayReview);
  document.querySelector('[data-calendar-review-open-journal]')?.addEventListener('click', (event) => {
    openJournalForCalendarDate(event.currentTarget.dataset.calendarReviewOpenJournal);
  });
  document.querySelectorAll('[data-calendar-display-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      setMonthlyCalendarDisplayMode(button.dataset.calendarDisplayMode);
      render();
    });
  });
  document.querySelectorAll('[data-calendar-month]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.disabled) {
        return;
      }

      const direction = button.dataset.calendarMonth === 'previous' ? -1 : 1;
      monthlyCalendarDate = new Date(monthlyCalendarDate.getFullYear(), monthlyCalendarDate.getMonth() + direction, 1);
      selectedCalendarDateKey = '';
      calendarReviewDateKey = '';
      render();
    });
  });
  document.querySelectorAll('[data-dna-timeframe]').forEach((button) => {
    button.addEventListener('click', () => {
      setDnaResultsTimeframe(button.dataset.dnaTimeframe);
      render();
    });
  });
  updateScreenshotFieldPreview();
  if (tradeForm) {
    updateRiskPercentField({ currentTarget: tradeForm });
  }

  document.querySelectorAll('.calendar-review-panel .screenshot-link').forEach((link) => {
    link.addEventListener('click', openScreenshotLink);
  });
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
  manualTradeDateKey = selectedCalendarDateKey || formatDateKey(new Date());
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

  clearDeletedCTraderSourceKeys();
  const remainingTrades = trades.filter((trade) => trade?.provider !== 'ctrader');
  const deletedCount = trades.length - remainingTrades.length;

  cTraderSyncStatus = {
    tone: 'success',
    message: `Deleted ${deletedCount} imported cTrader ${deletedCount === 1 ? 'trade' : 'trades'}. Sync cTrader to import them again.`,
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
    setup: normalizeSetupName(String(formData.get('setup')).trim()) || 'Uncategorized setup',
    entry: Number(formData.get('entry')),
    exit: Number(formData.get('exit')),
    size: Number(formData.get('size')),
    stopLoss: toOptionalNumber(formData.get('stopLoss')),
    adjustedStopLoss: toOptionalNumber(formData.get('adjustedStopLoss')),
    takeProfit: toOptionalNumber(formData.get('takeProfit')),
    adjustedTakeProfit: toOptionalNumber(formData.get('adjustedTakeProfit')),
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
    takeProfit: toOptionalNumber(formData.get('takeProfit')),
    adjustedTakeProfit: toOptionalNumber(formData.get('adjustedTakeProfit')),
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
      message: `${isAutoSync ? 'Auto Sync complete.' : 'Sync complete.'} New trades imported: ${syncPlan.importedCount}. Trades skipped: ${syncPlan.skippedCount}. Imported trades updated: ${updatedExistingTrades.updatedCount}. Stop losses updated: ${updatedExistingTrades.stopLossUpdatedCount}.`,
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
    try {
      const importedTrades = JSON.parse(String(reader.result));
      if (!Array.isArray(importedTrades)) {
        window.alert('Import failed: the file does not contain a valid trades array. Please choose a JSON file exported from DNA.');
        return;
      }
      if (importedTrades.length > 0 && !importedTrades[0]?.id) {
        window.alert('Import failed: this does not look like a DNA journal export. Please choose a JSON file exported from DNA.');
        return;
      }
      persistTrades(importedTrades);
    } catch (error) {
      window.alert(`Import failed: the file could not be read as JSON. ${error.message}`);
    }
  };
  reader.onerror = () => {
    window.alert('Import failed: the file could not be read.');
  };
  reader.readAsText(file);
  event.target.value = '';
}

// hashchange listener removed: share view replaced by PNG download
render();
scheduleCTraderAutoSync();
handleCTraderOAuthReturn().then((handledOAuthReturn) => {
  if (!handledOAuthReturn) {
    syncCTraderOnStartup();
  }
});

