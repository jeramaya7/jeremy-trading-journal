import { applyCTraderImportedTradeUpdates, buildCTraderSyncPlan, getImportedTradeSourceKey } from './ctrader-sync.js';
import { CTRADER_ENDPOINTS, buildCTraderOAuthUrl, fetchBackendJson, getBackendDiagnostics, getConfiguredBackendBaseUrl } from './backend-api.js';

const STORAGE_KEY = 'jeremy-trading-journal:v1';
const AUTO_SYNC_STORAGE_KEY = 'jeremy-trading-journal:ctrader-auto-sync:v1';
const LAST_SYNC_STORAGE_KEY = 'jeremy-trading-journal:ctrader-last-sync:v1';
const SELECTED_CTRADER_ACCOUNT_STORAGE_KEY = 'jeremy-trading-journal:ctrader-selected-account:v1';
const DELETED_CTRADER_SOURCE_KEYS_STORAGE_KEY = 'deletedCTraderSourceKeys';
const MONTHLY_CALENDAR_DISPLAY_MODE_STORAGE_KEY = 'jeremy-trading-journal:monthly-calendar-display-mode:v1';
const DNA_TIMEFRAME_STORAGE_KEY = 'jeremy-trading-journal:dna-timeframe:v1';
const PAGE_MODE_STORAGE_KEY = 'jeremy-trading-journal:page-mode:v1';
const SESSION_NOTES_STORAGE_KEY = 'jeremy-trading-journal:session-notes-by-day:v1';
const STARTING_ACCOUNT_BALANCE_STORAGE_KEY = 'jeremy-trading-journal:starting-account-balance:v1';
const DEFAULT_STARTING_ACCOUNT_BALANCE = 5600;
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

// Legacy Setup names (renamed or retired from the current Play Book list)
// mapped to their current canonical name. Unknown legacy/custom setup values
// fall through unchanged and render as Custom... so saved data is preserved.
const LEGACY_SETUP_NAME_MAP = {
  // Older typo/alias names (pre-existing entries, repointed at the new list)
  'Elephant Bar': 'Momentum / Breakout',
  'Buy the Retrace': 'RBI / GBI Retrace',
  GBI: 'RBI / GBI Retrace',
  'GBI / RBI': 'RBI / GBI Retrace',
  'Momentum Bar': 'Momentum / Breakout',
  RBI: 'RBI / GBI Retrace',
  'Support/Resistance': 'Support & Resistance',
  'The General Forecast': 'Other',
  'X Confirm': 'Momentum / Breakout',
  // Previous (DNA 25) 12-option Play Book list, migrated to the new 8 options
  'Enter Retrace': 'RBI / GBI Retrace',
  'General Forecast': 'Other',
  'Scalping': 'Other',
  Breakout: 'Momentum / Breakout',
  Momentum: 'Momentum / Breakout',
  Confirmation: 'Momentum / Breakout',
  Retrace: 'RBI / GBI Retrace',
  'RBI / GBI': 'RBI / GBI Retrace',
  'S&R': 'Support & Resistance',
};
const MARKET_STATE_OPTIONS = [
  'Trending',
  'Countertrend',
  'Channel',
  'Compressed',
];
const DEFAULT_MARKET_STATE = MARKET_STATE_OPTIONS[0];
const LEGACY_MARKET_STATE_MAP = {
  'Choppy': 'Channel',
  'Consolidating': 'Channel',
  'Flat & Narrow': 'Channel',
  'Trending Down': 'Trending',
  'Trending Up': 'Trending',
  'Counter Trend': 'Countertrend',
};
// Was 60s. Nothing in this codebase enforces a longer delay — no server-side
// rate limiter or cache sits in front of /api/ctrader/journal-preview (see
// getCtraderJournalPreview in src/server.js), and the access-token cache
// (STATE_TTL_MS/REFRESH_BUFFER_MS) only affects OAuth refresh timing, not
// polling frequency. The only real guard was this client-side interval.
// Lowered to 12s (within the requested 10-15s window). Overlapping requests
// were already prevented before this change and remain prevented: both
// syncCTrader() and syncCTraderOnStartup() no-op immediately if
// isSyncingCTrader (or isCheckingCTraderConnection) is already true, so a
// tick that fires while a sync is still in flight is simply skipped rather
// than starting a second, overlapping request.
const AUTO_SYNC_INTERVAL_MS = 12 * 1000;

// Fields the backend persists to Supabase for cross-device annotation sync.
// Must match JOURNAL_ANNOTATION_FIELDS in src/server.js.
const JOURNAL_ANNOTATION_FIELDS = ['setup', 'state', 'timeframe', 'protected', 'tradeManagement', 'grade', 'closeReason', 'lossReason', 'tags', 'notes', 'adjustedStopLoss', 'adjustedTakeProfit', 'takeProfit', 'stopLoss', 'outcomeOverride'];

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
let bindEventsController = null; // AbortController to prevent duplicate event listeners
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
// Multiple trade cards can be open in Edit mode at the same time, each
// keeping its own independent unsaved form state. editingTradeIds tracks
// which cards are currently open; editingTradeModeByTradeId tracks each
// open card's mode ('full' renders the existing Review edit form, 'quick'
// renders the compact Quick Edit layout — DNA 23 handoff) independently,
// since two open cards can be in different modes at once. Same trade data +
// save logic either way. dirtyTradeIds tracks which open cards actually
// have unsaved changes (a card can be open but untouched) — this drives the
// "Save All Changes" button and the leave/refresh warning below.
let editingTradeIds = new Set();
let editingTradeModeByTradeId = new Map();
let dirtyTradeIds = new Set();
let isManualTradeFormOpen = false;
// Trash / Undo Delete. Deleting a trade sets `deletedAt` on the trade object
// instead of removing it from `trades` — see softDeleteTrade() and
// getActiveTrades() below. `trades` itself (localStorage, export, sync
// dedup) still holds every trade, deleted or not; getActiveTrades() is the
// single place that excludes deleted ones, and every dashboard/journal read
// path was switched to it so a deleted trade disappears everywhere at once.
let isTrashOpen = false;
let recentlyDeletedTrade = null; // { id, symbol, direction } while the Undo toast is showing
let undoToastTimer = null;
const UNDO_TOAST_DURATION_MS = 6000;
// Cross-device annotation refresh: guards for the focus/visibility-triggered
// re-fetch added below. See maybeRefreshCloudAnnotations().
let isSyncingCloudAnnotations = false;
let lastCloudAnnotationsSyncAt = 0;
const CLOUD_ANNOTATIONS_MIN_REFRESH_INTERVAL_MS = 20 * 1000;
const pendingAnnotationPushes = new Set();
let manualTradeDateKey = formatDateKey(new Date());
let setupAnalyticsSort = { key: 'netPnl', direction: 'desc' };
let selectedAssetFilter = '';
let monthlyCalendarDate = new Date();
let selectedCalendarDateKey = '';
let calendarReviewDateKey = '';
let monthlyCalendarDisplayMode = loadMonthlyCalendarDisplayMode();
let dnaResultsTimeframe = loadDnaResultsTimeframe();
let startingAccountBalance = loadStartingAccountBalance();
let pageMode = loadPageMode();
let sessionNotesByDay = loadSessionNotesByDay();
let isSessionNotesModalOpen = false;
let isSettingsModalOpen = false;
let dnaDoctorState = {
  status: 'idle',
  report: null,
  error: null,
  dismissError: false,
  fullReportOpen: false
};

const FRIENDLY_ASSET_NAMES = {
  XAUUSD: 'Gold',
  BTCUSD: 'Bitcoin',
  ETHUSD: 'Ethereum',
  US30: 'Dow Jones',
  US100: 'Nasdaq',
  SPX500: 'S&P 500',
};

const PLAY_BOOK_SETUP_OPTIONS = [
  'Trend Continuation',
  'Momentum / Breakout',
  'RBI / GBI Retrace',
  'Support & Resistance',
  'Scalp',
];
const CUSTOM_SETUP_OPTION = 'Custom...';
const LOSS_REASON_OPTIONS = [
  'Normal Loss',
  'Stop Too Tight',
  'Chased Price',
  'Broke Rules',
  'Other',
];
const CLOSE_REASON_OPTIONS = [
  'Take Profit',
  'Stop Loss',
  'Trail Stop',
  'Manual Exit',
  'Other',
];
const TRADE_TIMEFRAME_OPTIONS = [
  '1m',
  '2m',
  '5m',
  '15m',
  '30m',
  '1H',
  '4H',
  'Daily',
];
const TRADE_PROTECTED_OPTIONS = [
  'Yes',
  'No',
];
const GRADE_OPTIONS = [
  'A+',
  'A',
  'B',
  'C',
  'D',
  'F',
];
const TRADE_MANAGEMENT_OPTIONS = [
  'Set & Forget',
  'Trail Stop',
  'Break Even',
  'Stop Loss',
  'Manual Exit',
  'Other',
];
// Protected is fully derived from Trade Management (Smart Protected) — this
// map is the single source of truth for that derivation, used both to
// render the read-only Protected value and to update it live when Trade
// Management changes (see renderProtectedDisplay/getSmartProtectedValue and
// the tradeManagement change listener in bindTradeCardEvents). Any Trade
// Management value not listed here (including blank/None) defaults to 'No'.
// Same Yes/No logic as before DNA 26's option cleanup: Trail Stop and Break
// Even are the only two that mean risk was actually removed from the trade.
const TRADE_MANAGEMENT_PROTECTED_MAP = {
  'Trail Stop': 'Yes',
  'Break Even': 'Yes',
  'Set & Forget': 'No',
  'Stop Loss': 'No',
  'Manual Exit': 'No',
  'Other': 'No',
};

function getSmartProtectedValue(tradeManagement) {
  return TRADE_MANAGEMENT_PROTECTED_MAP[String(tradeManagement || '').trim()] || 'No';
}

const TRADE_MANAGEMENT_CLOSE_REASON_MAP = {
  'Trail Stop': 'Trail Stop',
  'Stop Loss': 'Stop Loss',
  'Manual Exit': 'Manual Exit',
  'Other': 'Other',
};

const LEGACY_SMART_CLOSE_REASON_MAP = {
  'Trail Stop': ['Trailed Stop'],
};

function getSmartCloseReasonValue(tradeManagement) {
  return TRADE_MANAGEMENT_CLOSE_REASON_MAP[String(tradeManagement || '').trim()] || '';
}

function isSmartCloseReasonValue(closeReason, tradeManagement) {
  const smartValue = getSmartCloseReasonValue(tradeManagement);
  const trimmedCloseReason = String(closeReason || '').trim();
  return !trimmedCloseReason
    || trimmedCloseReason === smartValue
    || (LEGACY_SMART_CLOSE_REASON_MAP[smartValue] || []).includes(trimmedCloseReason);
}

const app = document.querySelector('#root');

function normalizeSetupName(setup) {
  return Object.prototype.hasOwnProperty.call(LEGACY_SETUP_NAME_MAP, setup) ? LEGACY_SETUP_NAME_MAP[setup] : setup;
}

function hasLegacySetupName(nextTrades) {
  return nextTrades.some((trade) => Object.prototype.hasOwnProperty.call(LEGACY_SETUP_NAME_MAP, trade?.setup));
}

function normalizeTradeSetups(nextTrades) {
  return nextTrades.map((trade) => (
    Object.prototype.hasOwnProperty.call(LEGACY_SETUP_NAME_MAP, trade?.setup)
      ? { ...trade, setup: LEGACY_SETUP_NAME_MAP[trade.setup] }
      : trade
  ));
}

function normalizeMarketState(raw) {
  const trimmed = String(raw || '').trim();
  return LEGACY_MARKET_STATE_MAP[trimmed] ?? (trimmed || DEFAULT_MARKET_STATE);
}

function hasMigratableMarketState(nextTrades) {
  return nextTrades.some((trade) => normalizeMarketState(trade?.state) !== trade?.state);
}

function normalizeTradeMarketStates(nextTrades) {
  return nextTrades.map((trade) => {
    const state = normalizeMarketState(trade?.state);
    return state === trade?.state ? trade : { ...trade, state };
  });
}

function loadTrades() {
  const savedTrades = window.localStorage.getItem(STORAGE_KEY);
  if (!savedTrades) {
    return normalizeTradeMarketStates(starterTrades);
  }

  let parsedTrades;
  try {
    parsedTrades = JSON.parse(savedTrades);
  } catch {
    console.error('[DNA] localStorage trade data is corrupted and could not be parsed. Falling back to starter trades.');
    return normalizeTradeMarketStates(starterTrades);
  }
  if (!Array.isArray(parsedTrades)) {
    return normalizeTradeMarketStates(starterTrades);
  }

  const shouldMigrateSavedTrades = hasLegacySetupName(parsedTrades) || hasMigratableMarketState(parsedTrades);
  const migratedTrades = shouldMigrateSavedTrades
    ? normalizeTradeMarketStates(normalizeTradeSetups(parsedTrades))
    : parsedTrades;
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
  trades = normalizeTradeMarketStates(normalizeTradeSetups(nextTrades));
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
  if (options.preserveTradeId) {
    renderPreservingTradePosition(options.preserveTradeId, options.renderOptions);
    return;
  }
  render();
}

// Keeps only the fields the backend/Supabase are allowed to store, so we
// never send unrelated trade data (price, size, screenshot, etc.) up.
function extractAnnotationFields(source) {
  const fields = {};
  for (const field of JOURNAL_ANNOTATION_FIELDS) {
    if (source && Object.prototype.hasOwnProperty.call(source, field)) {
      fields[field] = source[field];
    }
  }
  return fields;
}

// Fire-and-forget push of one trade's annotation fields to the cloud so
// other devices can pick them up. Never blocks the UI and never throws:
// if the backend/Supabase is unreachable, the edit is still saved locally.
// The trade id is tracked in pendingAnnotationPushes for the duration of the
// request so a concurrent cloud refresh (see maybeRefreshCloudAnnotations)
// knows not to merge in a possibly-stale server snapshot over this edit.
async function pushTradeAnnotationToCloud(tradeId, annotationFields) {
  const key = String(tradeId);
  pendingAnnotationPushes.add(key);
  try {
    await fetchBackendJson(`/api/journal/annotations/${encodeURIComponent(key)}`, {
      fetchOptions: {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(annotationFields),
      },
    });
  } catch (error) {
    console.warn('[DNA] Could not sync trade annotation to the cloud (saved locally only):', error.message);
  } finally {
    pendingAnnotationPushes.delete(key);
  }
}

// Pulls every saved annotation from the cloud and merges it into local
// trades by id. Cloud fields win for the fields it knows about; anything not
// covered by JOURNAL_ANNOTATION_FIELDS (price, screenshot, etc.) is left
// untouched. Called once on startup, and again whenever the tab regains
// focus (see maybeRefreshCloudAnnotations) so a second device's edits show
// up without polling.
//
// Two trades are deliberately skipped so this never clobbers a newer local
// edit: the trade currently open in the edit form (its fields aren't saved
// to `trades` yet, so there's nothing cloud data should overwrite), and any
// trade with a push still in flight (its local edit may not have reached
// the server yet, so the fetched snapshot could be stale relative to it).
async function loadCloudAnnotationsAndMerge() {
  try {
    const { body } = await fetchBackendJson('/api/journal/annotations');
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return;
    }

    let didMergeAnyTrade = false;
    const mergedTrades = trades.map((trade) => {
      const tradeKey = String(trade.id);
      if (editingTradeIds.has(tradeKey) || pendingAnnotationPushes.has(tradeKey)) {
        return trade;
      }
      const cloudFields = body[tradeKey];
      if (!cloudFields || typeof cloudFields !== 'object') {
        return trade;
      }
      didMergeAnyTrade = true;
      return { ...trade, ...extractAnnotationFields(cloudFields) };
    });

    if (didMergeAnyTrade) {
      trades = normalizeTradeMarketStates(normalizeTradeSetups(mergedTrades));
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
      render();
    }
  } catch (error) {
    console.warn('[DNA] Could not load cloud annotations (using local data only):', error.message);
  }
}

// Re-runs loadCloudAnnotationsAndMerge() when the tab regains focus, so a
// change made on another device shows up without the user having to reload.
// No polling: this only ever fires from the focus/visibilitychange listeners
// registered at startup. Two guards keep server requests to a minimum and
// prevent duplicate concurrent fetches:
// - isSyncingCloudAnnotations: skips if a refresh is already in flight
//   (e.g. both 'focus' and 'visibilitychange' fire for the same tab switch).
// - lastCloudAnnotationsSyncAt: skips if the last refresh was very recent
//   (e.g. rapid alt-tabbing), so switching back and forth doesn't spam
//   the backend.
async function maybeRefreshCloudAnnotations() {
  if (isSyncingCloudAnnotations) {
    return;
  }
  if (Date.now() - lastCloudAnnotationsSyncAt < CLOUD_ANNOTATIONS_MIN_REFRESH_INTERVAL_MS) {
    return;
  }

  isSyncingCloudAnnotations = true;
  try {
    await loadCloudAnnotationsAndMerge();
  } finally {
    lastCloudAnnotationsSyncAt = Date.now();
    isSyncingCloudAnnotations = false;
  }
}

// Root cause of the Manual Trade data-loss bug: this lock originally only
// covered the trade-card edit form (editingTradeId). render() rebuilds the
// entire DOM from scratch (app.innerHTML = ...) every time it runs, and the
// Manual Trade form's Entry/Exit/Symbol/etc. fields are plain uncontrolled
// <input> elements — their typed values live only in the DOM, not in any
// JS state — so any render() while the form was open silently wiped
// whatever the user had typed. This was never specific to the 12s cTrader
// Auto Sync interval: syncCTrader() calls render() at the start and end of
// every sync (and persistTrades()/loadCloudAnnotationsAndMerge() call
// render() too), so the exact same data loss could already happen at the
// old 60s interval, or from a cloud-annotation refresh, or the app was even
// just sitting on a slow connection. Shortening the interval only raised
// how often a render landed while someone was mid-form.
//
// Fix: the lock now also covers the Manual Trade form. Every render() call
// already funnels through this one check (see `if (isTradeEditLocked() &&
// !options.force)` in render()), and syncCTraderOnStartup()/
// scheduleCTraderAutoSync() already skip syncing entirely while locked — so
// this one change also stops Auto Sync from even attempting a background
// sync while the form is open, regardless of whether it polls every 12s,
// 60s, or anything else.
function isTradeEditLocked() {
  return editingTradeIds.size > 0 || isManualTradeFormOpen;
}

function openTradeEdit(tradeId, mode = 'full') {
  const key = String(tradeId);
  editingTradeIds.add(key);
  editingTradeModeByTradeId.set(key, mode === 'quick' ? 'quick' : 'full');
  scheduleCTraderAutoSync();
  renderTradeCardInPlace(tradeId);
}

// Closes edit mode for exactly one card, leaving every other open card (and
// its unsaved form state) untouched — Set.delete()/Map.delete() are no-ops
// for a tradeId that isn't open, so this is always safe to call.
function closeTradeEdit(tradeId) {
  const key = String(tradeId);
  editingTradeIds.delete(key);
  editingTradeModeByTradeId.delete(key);
  dirtyTradeIds.delete(key);
  scheduleCTraderAutoSync();
  updateSaveAllButtonVisibility();
}

function getTradeCardElement(tradeId) {
  return [...document.querySelectorAll('[data-trade-card]')]
    .find((tradeCard) => tradeCard.dataset.tradeCard === String(tradeId)) || null;
}

function getTradeById(tradeId) {
  return trades.find((trade) => String(trade.id) === String(tradeId)) || null;
}

// The one place "deleted" is excluded. `trades` (the module-level array,
// localStorage, export/import, and cTrader sync dedup) always holds every
// trade regardless of deletedAt — only reads that feed the journal list and
// dashboard stats go through this filter.
function getActiveTrades() {
  return trades.filter((trade) => !trade.deletedAt);
}

function getDeletedTrades() {
  return trades.filter((trade) => Boolean(trade.deletedAt));
}

function trashedTradeCount() {
  return getDeletedTrades().length;
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

// Restoring a soft-deleted cTrader-imported trade un-blocks it from
// rememberDeletedCTraderSourceKey() above, so it behaves exactly as if it
// had never been deleted (Auto Sync won't skip it, and it won't get
// re-added as a duplicate — its source key already matches the restored
// trade still sitting in `trades`).
function forgetDeletedCTraderSourceKey(trade) {
  const sourceKey = getImportedTradeSourceKey(trade);
  if (!sourceKey) {
    return;
  }

  const deletedSourceKeys = loadDeletedCTraderSourceKeys();
  if (deletedSourceKeys.delete(sourceKey)) {
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

  // Use the entry-to-stop distance as a magnitude, not a signed value. A
  // stop that's been trailed to (or past) breakeven still represents a
  // real, if small, risk distance from entry — treating it as "no risk"
  // (null) made R-multiple uncomputable for those trades, which broke the
  // ±0.1R Breakeven Buffer classification for them (they fell back to a
  // raw P/L-sign check with no breakeven band at all).
  const riskPerUnit = Math.abs(trade.direction === 'Short'
    ? originalStopLoss - entry
    : entry - originalStopLoss);
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

  // Same magnitude fix as calculateOriginalRiskDollars above, applied to the
  // active (current/trailed) stop loss.
  const riskPerUnit = Math.abs(trade.direction === 'Short'
    ? activeStopLoss - entry
    : entry - activeStopLoss);
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

// A trade this close to flat in real dollar terms counts as Breakeven rather
// than a Win or a Loss. This only changes which bucket a trade is counted in
// for win-rate style stats — it never changes the trade's actual P/L or R
// value. Fixed at $1.00: P/L at or beyond +/-$1.00 is a Win/Loss; anything
// strictly inside that band (-$0.99 to +$0.99) is Breakeven. (Replaces the
// earlier +/-0.1R-based rule, which classified by risk multiple rather than
// a flat dollar amount.)
const OUTCOME_DOLLAR_THRESHOLD = 1.00;

// Outcome Override: lets a trade's Win/Loss/Breakeven bucket be manually
// forced (e.g. a tiny slippage/commission loss the trader wants treated as
// Breakeven, or manual journaling classification), instead of always
// following the automatic dollar-threshold rule below. 'Auto' (blank/no
// override) is the default for every trade, existing and new, so nothing
// changes unless a trade is explicitly overridden.
const OUTCOME_OVERRIDE_OPTIONS = ['Win', 'Breakeven', 'Loss'];
const OUTCOME_OVERRIDE_LABEL_TO_KEY = { Win: 'win', Breakeven: 'breakeven', Loss: 'loss' };

// Single shared classification used everywhere wins/losses are counted
// (dashboard stats, setup/asset/session analytics, calendar day review,
// trade card, exports) so a trade is never a Win in one report and
// Breakeven in another. When a trade has a valid Outcome Override, that
// value wins outright and the automatic pnl-based rule below is skipped
// entirely — every call site passes trade.outcomeOverride as the second
// argument so this is the one and only place the override is applied.
function classifyTradeOutcome(pnl, outcomeOverride) {
  const overrideKey = OUTCOME_OVERRIDE_LABEL_TO_KEY[String(outcomeOverride || '').trim()];
  if (overrideKey) {
    return overrideKey;
  }

  if (pnl >= OUTCOME_DOLLAR_THRESHOLD) return 'win';
  if (pnl <= -OUTCOME_DOLLAR_THRESHOLD) return 'loss';
  return 'breakeven';
}

// Display labels for classifyTradeOutcome()'s result. Kept next to the
// classifier so there's one place that owns both the bucket and its label —
// display code should never re-derive win/loss/breakeven from pnl or R
// itself.
const TRADE_OUTCOME_LABELS = { win: 'Win', loss: 'Loss', breakeven: 'Breakeven' };

// Win Rate = Wins ÷ (Wins + Losses). Breakeven trades (per
// classifyTradeOutcome() above) are excluded entirely — not counted as a
// win, and not counted in the denominator either — so a day, setup, asset,
// or session full of scratch trades doesn't drag Win Rate toward 0%. If
// there are no decided (win or loss) trades at all, Win Rate is undefined
// (null) rather than 0%. Single shared formula for every place Win Rate is
// reported (dashboard, setup analytics, asset analytics, session stats,
// calendar day review) so none of them can drift out of sync.
function calculateWinRate(winCount, lossCount) {
  const decidedCount = winCount + lossCount;
  return decidedCount > 0 ? (winCount / decidedCount) * 100 : null;
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

// Bug fix: manual trades only ever set `trade.date` as a plain "YYYY-MM-DD"
// string (no `closeTime`). JS parses date-only strings as UTC midnight, but
// this function's result is always compared against locally-constructed
// Date objects (see getReportPeriodStart/filterTradesForPeriod below). In
// any timezone behind UTC (all of the Americas), UTC midnight on a given
// date is still the *previous* calendar day locally, so a manual trade
// dated "today" was silently read back as dated "yesterday" everywhere
// this function is used — which is every dashboard stat and period filter
// (Net P/L, Trades, Win Rate, Protected %, ROI, Profit Factor, the
// day/week/month/year/all toggle, the monthly calendar, and setup/asset/
// time-of-day analytics all call this one shared helper). Imported cTrader
// trades are unaffected: `trade.closeTime` is always a full ISO timestamp
// (e.g. "2026-07-16T20:49:53.000Z"), which JS already parses as an absolute
// instant and converts to local time correctly — that branch is untouched.
function getTradeReportDate(trade) {
  const dateValue = trade.closeTime || trade.date;
  if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    const [year, month, day] = dateValue.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

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
  const periodTrades = filterTradesForPeriod(tradeList, period, referenceDate);
  const baseReport = periodTrades.reduce((report, trade) => ({
    pnl: report.pnl + calculatePnl(trade),
    tradeCount: report.tradeCount + 1,
  }), { pnl: 0, tradeCount: 0 });

  // Capital Efficiency for this same period-filtered trade set — see
  // getCapitalExposureWalk/calculateCapitalEfficiency above. Drives the
  // Daily/Weekly/Monthly/Yearly CE metrics under DNA Results.
  return { ...baseReport, capitalEfficiency: calculateCapitalEfficiency(periodTrades) };
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

// Capital Efficiency (CE) — DNA 27.
//
// CE measures how efficiently capital was used during a period: Net Profit
// divided by Maximum Capital Exposure, the single highest amount of
// capital that was ever genuinely "on the line" at any point while working
// through that period's trades in the order they actually closed.
//
// This journal only ever stores already-closed trades (every trade has
// both an entry and an exit) — there is no live open-position tracking —
// so Maximum Capital Exposure is built purely from realized history:
// walk every closed trade in chronological close order (oldest to newest,
// via getEquityCurveTrades — the same ordering the equity curve chart
// uses) while tracking the running realized P/L, and for each trade:
//
//   Capital Exposure (this trade) = max(0, -RunningPnLBeforeThisTrade) + RiskDollars(trade)
//
// In words: whatever is currently down (a realized drawdown not yet
// recovered) adds directly to this trade's exposure, on top of the $ risk
// being taken on the trade itself — e.g. down $50 and risking $22 on the
// next trade means $72 is on the line. Running profit, on the other hand,
// only ever acts as a cushion: it can reduce the drawdown contribution to
// zero, but it can never make exposure less than the trade's own Risk $ —
// e.g. up $200 and risking $50 is $50 of exposure, not less. Maximum
// Capital Exposure is the largest single-trade exposure value reached
// anywhere in the period. Net Profit is the sum of P/L across that exact
// same chronological, valid-date trade set (via getEquityCurveTrades), so
// the numerator and denominator can never drift apart from mismatched
// trade filtering.
//
// A trade with no computable Risk $ (missing entry/stop/size) contributes
// $0 of its own risk to the walk — it still affects the running P/L used
// by later trades, it just adds no exposure of its own.
//
// This is deterministic and independent of input ordering: the same set
// of closed trades for a period always produces the same result, no
// matter what order the caller's array is in, because getEquityCurveTrades
// always re-sorts by close date first.
function getCapitalExposureWalk(tradeList) {
  const chronological = getEquityCurveTrades(tradeList);
  let runningPnl = 0;
  let maxExposure = 0;

  chronological.forEach(({ trade, pnl }) => {
    const riskDollars = calculateRiskDollars(trade) ?? 0;
    const exposureBeforeThisTrade = Math.max(0, -runningPnl) + riskDollars;
    if (exposureBeforeThisTrade > maxExposure) {
      maxExposure = exposureBeforeThisTrade;
    }
    runningPnl += pnl;
  });

  return { maxExposure, netProfit: runningPnl };
}

// Maximum Capital Exposure alone (see getCapitalExposureWalk above) —
// exposed separately so it can be reasoned about/tested independently of
// the CE ratio itself.
function calculateMaxCapitalExposure(tradeList) {
  return getCapitalExposureWalk(tradeList).maxExposure;
}

// CE = Net Profit ÷ Maximum Capital Exposure. Returns null (rendered as
// "—" by formatCapitalEfficiency) when Maximum Capital Exposure is 0 —
// e.g. no trades in the period, or every trade had $0 risk and the period
// never went into a realized drawdown — since dividing by zero exposure is
// meaningless, not infinitely efficient.
function calculateCapitalEfficiency(tradeList) {
  const { maxExposure, netProfit } = getCapitalExposureWalk(tradeList);
  return maxExposure > 0 ? netProfit / maxExposure : null;
}

// Two decimal places with a "×" suffix (e.g. "3.14×"), matching how a
// capital-efficiency multiple is conventionally displayed. "—" for null/
// non-finite input (zero exposure, or no data).
function formatCapitalEfficiency(value) {
  return value === null || value === undefined || !Number.isFinite(Number(value))
    ? '—'
    : `${Number(value).toFixed(2)}×`;
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
    const outcome = classifyTradeOutcome(pnl, trade.outcomeOverride);
    const report = setupReports.get(setupName) ?? {
      setupName,
      tradeCount: 0,
      winCount: 0,
      lossCount: 0,
      breakevenCount: 0,
      rCount: 0,
      totalR: 0,
      netPnl: 0,
    };

    report.tradeCount += 1;
    report.winCount += outcome === 'win' ? 1 : 0;
    report.lossCount += outcome === 'loss' ? 1 : 0;
    report.breakevenCount += outcome === 'breakeven' ? 1 : 0;
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
      winRate: calculateWinRate(report.winCount, report.lossCount),
      breakevenCount: report.breakevenCount,
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
    const outcome = classifyTradeOutcome(pnl, trade.outcomeOverride);
    const report = assetReports.get(asset) ?? {
      asset,
      displayName: getFriendlyAssetName(asset),
      tradeCount: 0,
      winCount: 0,
      breakevenCount: 0,
      rCount: 0,
      totalR: 0,
      winningPnlCount: 0,
      totalWinningPnl: 0,
      losingPnlCount: 0,
      totalLosingPnl: 0,
      netPnl: 0,
    };

    report.tradeCount += 1;
    report.winCount += outcome === 'win' ? 1 : 0;
    report.breakevenCount += outcome === 'breakeven' ? 1 : 0;
    report.netPnl += pnl;

    if (outcome === 'win') {
      report.winningPnlCount += 1;
      report.totalWinningPnl += pnl;
    }

    if (outcome === 'loss') {
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
      winRate: calculateWinRate(report.winCount, report.losingPnlCount),
      breakevenCount: report.breakevenCount,
      netPnl: report.netPnl,
      averageR: report.rCount ? report.totalR / report.rCount : null,
      averageWinner: report.winningPnlCount ? report.totalWinningPnl / report.winningPnlCount : null,
      averageLoser: report.losingPnlCount ? report.totalLosingPnl / report.losingPnlCount : null,
    }))
    .sort(compareAssetAnalyticsRows);
}

// ─── Trading Session Analysis ──────────────────────────────────────────

// ─── DNA Doctor ──────────────────────────────────────────────────────

// Abstraction layer — swap provider without touching UI
const DNA_DOCTOR_PROVIDERS = {
  claude: callClaudeDnaDoctor,
};

async function runDnaDoctor(tradeList = trades) {
  const provider = 'claude'; // future: load from settings
  const fn = DNA_DOCTOR_PROVIDERS[provider];
  if (!fn) throw new Error(`Unknown DNA Doctor provider: ${provider}`);
  return fn(buildDnaScanPayload(tradeList));
}

function buildDnaScanPayload(tradeList) {
  const stats = getStats(tradeList);
  const assetRows = getAssetAnalytics(tradeList);
  const setupRows = getSetupAnalytics(tradeList);
  const sessionRows = getTimeOfDayAnalytics(tradeList);

  return {
    tradeCount: stats.tradeCount,
    winRate: stats.winRate,
    totalPnl: stats.totalPnl,
    averageWin: stats.averageWin,
    averageLoss: stats.averageLoss,
    averageR: stats.averageR,
    profitFactor: stats.profitFactor,
    biggestWinner: stats.biggestWinner,
    biggestLoser: stats.biggestLoser,
    averageRiskDollars: stats.averageRiskDollars,
    averageRiskPercent: stats.averageRiskPercent,
    assets: assetRows.map((r) => ({ symbol: r.asset, trades: r.tradeCount, winRate: r.winRate, netPnl: r.netPnl, averageR: r.averageR })),
    setups: setupRows.map((r) => ({ name: r.setupName, trades: r.tradeCount, winRate: r.winRate, averageR: r.averageR, netPnl: r.netPnl })),
    sessions: sessionRows.map((r) => ({ session: r.label, trades: r.tradeCount, winRate: r.winRate, netPnl: r.netPnl, averageR: r.averageR, profitFactor: r.profitFactor })),
  };
}

async function callClaudeDnaDoctor(payload) {
  const backendUrl = getConfiguredBackendBaseUrl();
  if (!backendUrl) {
    throw new Error('Backend is not configured. Set the backend URL to use DNA Doctor.');
  }

  const response = await fetch(`${backendUrl}/api/dna-doctor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Server error ${response.status}`);
  }

  return data;
}

const DNA_DOCTOR_LOADING_STEPS = [
  '🧬 Extracting trading DNA...',
  '📊 Analyzing statistics...',
  '🔎 Detecting patterns...',
  '⚠️ Looking for weaknesses...',
  '💊 Preparing prescription...',
  '🩺 Finalizing diagnosis...',
];

function renderDnaDoctor(tradeList = trades) {
  const fullReportOpen = dnaDoctorState.fullReportOpen;
  const { status, report, error, dismissError } = dnaDoctorState;
  const isLoading = status === 'loading';

  const errorBanner = (status === 'error' && error && !dismissError) ? `
    <div class="dna-doctor-error-banner" id="dnaDoctorErrorBanner">
      <div class="dna-doctor-error-content">
        <span>⚠️ ${escapeHtml(error)}</span>
        <span class="dna-doctor-error-hint">Check your connection and try again.</span>
      </div>
      <button class="dna-doctor-error-dismiss" type="button" id="dnaDoctorDismissError" aria-label="Dismiss">✕</button>
    </div>` : '';

  const loadingHtml = isLoading ? `
    <div class="dna-doctor-loading" aria-live="polite">
      <div class="dna-doctor-spinner"></div>
      <p id="dnaDoctorLoadingStep">${DNA_DOCTOR_LOADING_STEPS[0]}</p>
    </div>` : '';

  const reportHtml = report ? `
    <div class="dna-doctor-report-wrap ${status === 'done' ? 'dna-doctor-fadein' : ''}">
     ${renderDnaDoctorReport(report, fullReportOpen)}
    </div>` : '';

  return `
    <section class="panel dna-doctor-panel" aria-label="DNA Doctor">

      <!-- Branded idle state — mirrors hero quality -->
      <div class="dna-doctor-branded">

        <!-- Left: logo + copy + pills -->
        <div class="dna-doctor-brand-left">
          <div class="dna-doctor-heading-row">
            <img class="dna-doctor-icon" src="./Icon_circular_logo.png" alt="DNA Doctor icon" />
            <h2 class="dna-doctor-title">DNA DOCTOR</h2>
          </div>
          <p class="dna-doctor-subtitle">AI-powered trading diagnosis based on your journal data.</p>

          <div class="dna-doctor-pills">
            <div class="dna-doctor-pill">
              ${icon('target')}
              <div>
                <strong>Analyze Patterns</strong>
                <span>Discover what's really happening in your trades</span>
              </div>
            </div>
            <div class="dna-doctor-pill">
              ${icon('chart')}
              <div>
                <strong>Find Strengths</strong>
                <span>Identify your profit drivers</span>
              </div>
            </div>
            <div class="dna-doctor-pill">
              ${icon('trend')}
              <div>
                <strong>Spot Weaknesses</strong>
                <span>Uncover leaks in your strategy</span>
              </div>
            </div>
            <div class="dna-doctor-pill">
              ${icon('book')}
              <div>
                <strong>Get Prescription</strong>
                <span>Actionable steps to improve</span>
              </div>
            </div>
            <div class="dna-doctor-pill">
              ${icon('refresh')}
              <div>
                <strong>Track Progress</strong>
                <span>Scan regularly and see improvement</span>
              </div>
            </div>
          </div>

          <div class="dna-doctor-privacy">
            ${icon('book')}
            <div>
              <strong>Your data is private and secure.</strong>
              <span>We only use your journal data to generate your DNA Doctor report. Nothing is stored or shared.</span>
            </div>
          </div>
        </div>

        <!-- Right: scan button -->
        <div class="dna-doctor-brand-right">
          <button class="dna-doctor-scan-btn" type="button" id="runDnaDoctor" ${isLoading ? 'disabled' : ''}>
            ${isLoading ? '<span class="dna-doctor-btn-spinner"></span>' : icon('trend')}
            ${isLoading ? '🧬 Scanning...' : 'Run DNA Scan'}
          </button>
        </div>

      </div>

      ${errorBanner}
      ${loadingHtml}
      ${reportHtml}
    </section>`;
}

function renderDnaDoctorReport(report, fullReportOpen = false) {
  const score = report.score || 0;
  const gradeClass = report.grade?.startsWith('A') ? 'positive' : report.grade?.startsWith('B') ? 'neutral' : 'negative';
  const barClass = score >= 70 ? 'positive' : score >= 40 ? 'neutral' : 'negative';
  const scoreBar = Math.min(100, Math.max(0, score));
  const biggestRisk = (report.riskFactors || [])[0] || null;
  const biggestIssue = (report.weaknesses || [])[0] || null;
  const statusLabel = score >= 70 ? 'Healthy' : score >= 40 ? 'Needs Attention' : 'Critical';
  const statusClass = score >= 70 ? 'positive' : score >= 40 ? 'neutral' : 'negative';
  const scannedAt = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  const warningSigns = (report.weaknesses || []).length ? report.weaknesses : (report.riskFactors || []);
const tomorrowFocus = 'Tomorrow, follow your planned stop on every trade.';

  return `
    <div class="dna-doctor-report">

      <div class="dna-doctor-divider">
        <span class="dna-doctor-divider-label">🩺 DNA Doctor Report</span>
      </div>

      <div class="dna-doctor-hero">
        <div class="dna-doctor-score-block">
          <div class="dna-doctor-score-ring ${gradeClass}">
            <span class="dna-doctor-score-number">${score}</span>
            <span class="dna-doctor-score-denom">/100</span>
          </div>
          <div class="dna-doctor-score-meta">
            <span class="dna-doctor-score-grade ${gradeClass}">${report.grade}</span>
            <span class="dna-doctor-status-badge ${statusClass}">${statusLabel}</span>
          </div>
        </div>
        <div class="dna-doctor-executive-summary">
          <div class="dna-doctor-score-bar-row">
            <div class="dna-doctor-score-bar">
              <div class="dna-doctor-score-bar-fill ${barClass}" style="width:${scoreBar}%"></div>
            </div>
            <span class="dna-doctor-scan-time">Last scan: ${scannedAt}</span>
          </div>
          <p class="dna-doctor-summary-text">${escapeHtml(report.diagnosis)}</p>
          ${biggestIssue ? `<p class="dna-doctor-biggest-issue"><strong>Biggest issue:</strong> ${escapeHtml(biggestIssue)}</p>` : ''}
        </div>
      </div>

      <div class="dna-doctor-section dna-doctor-diagnosis">
        <div class="dna-doctor-section-label">
          <span class="dna-doctor-section-icon">🔬</span><h4>Diagnosis</h4>
        </div>
        <p>${escapeHtml(report.diagnosis)}</p>
      </div>

      <div class="dna-doctor-section dna-doctor-strengths">
        <div class="dna-doctor-section-label">
          <span class="dna-doctor-section-icon">✅</span><h4>Healthy Habits</h4>
        </div>
        <ul>${(report.strengths || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
      </div>

      <div class="dna-doctor-section dna-doctor-weaknesses">
        <div class="dna-doctor-section-label">
          <span class="dna-doctor-section-icon">⚠️</span><h4>Warning Signs</h4>
        </div>
        <ul>${(warningSigns || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
      </div>

      <div class="dna-doctor-section dna-doctor-prescription">
        <div class="dna-doctor-section-label">
          <span class="dna-doctor-section-icon">💊</span><h4>Prescription</h4>
        </div>
        <ul>${(report.prescription || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
      </div>

      <div class="dna-doctor-section dna-doctor-focus">
        <div class="dna-doctor-section-label">
          <span class="dna-doctor-section-icon">🌅</span><h4>Tomorrow's Focus</h4>
        </div>
        <p>${escapeHtml(tomorrowFocus)}</p>
      </div>

    </div>`;
}

function getTimeOfDayBucket(openTime) {
  if (!openTime) return 'Unknown';
  const date = new Date(openTime);
  if (isNaN(date.getTime())) return 'Unknown';
  const hour = parseInt(date.toLocaleString('en-US', { hour: 'numeric', hour12: false }), 10);
  if (hour >= 6 && hour < 12) return 'Morning';
  if (hour >= 12 && hour < 18) return 'Afternoon';
  if (hour >= 18 && hour < 23) return 'Evening';
  return 'Night';
}

const TIME_OF_DAY_ORDER = ['Morning', 'Afternoon', 'Evening', 'Night', 'Unknown'];

// Generic session stats builder — reusable for hourly/day-of-week/market session analysis
function buildSessionStats(tradeList, labelFn, labelOrder) {
  const buckets = new Map();
  labelOrder.forEach((label) => {
    buckets.set(label, {
      label,
      tradeCount: 0,
      winCount: 0,
      breakevenCount: 0,
      rCount: 0,
      totalR: 0,
      winningPnl: [],
      losingPnl: [],
      netPnl: 0,
    });
  });

  tradeList.forEach((trade) => {
    const label = labelFn(trade);
    const report = buckets.get(label);
    if (!report) return;
    const pnl = calculatePnl(trade);
    const rMultiple = calculateRMultiple(trade);
    const outcome = classifyTradeOutcome(pnl, trade.outcomeOverride);
    report.tradeCount += 1;
    report.netPnl += pnl;
    if (outcome === 'win') { report.winCount += 1; report.winningPnl.push(pnl); }
    if (outcome === 'loss') { report.losingPnl.push(pnl); }
    if (outcome === 'breakeven') { report.breakevenCount += 1; }
    if (rMultiple !== null) { report.rCount += 1; report.totalR += rMultiple; }
  });

  return [...buckets.values()]
    .filter((r) => r.tradeCount > 0)
    .map((r) => ({
      label: r.label,
      tradeCount: r.tradeCount,
      breakevenCount: r.breakevenCount,
      winRate: calculateWinRate(r.winCount, r.losingPnl.length),
      netPnl: r.netPnl,
      totalR: r.rCount ? r.totalR : null,
      averageR: r.rCount ? r.totalR / r.rCount : null,
      profitFactor: getProfitFactor(r.winningPnl, r.losingPnl),
    }));
}

function getTimeOfDayAnalytics(tradeList = trades) {
  return buildSessionStats(
    tradeList,
    (trade) => getTimeOfDayBucket(trade.openTime),
    TIME_OF_DAY_ORDER,
  ).sort((a, b) => b.netPnl - a.netPnl);
}

function getSessionVerdict(rows) {
  if (rows.length < 2) return new Map();
  const byPnl = [...rows].sort((a, b) => b.netPnl - a.netPnl);
  const byPf = [...rows].filter((r) => r.profitFactor !== null).sort((a, b) => b.profitFactor - a.profitFactor);
  const verdicts = new Map();
  rows.forEach((r) => verdicts.set(r.label, 'average'));
  if (byPnl[0]) verdicts.set(byPnl[0].label, 'best');
  if (byPnl[byPnl.length - 1] && byPnl[byPnl.length - 1].netPnl < 0) {
    verdicts.set(byPnl[byPnl.length - 1].label, 'weak');
  }
  if (byPf.length && byPf[byPf.length - 1]?.profitFactor < 1.0) {
    const weakLabel = byPf[byPf.length - 1].label;
    if (verdicts.get(weakLabel) !== 'best') verdicts.set(weakLabel, 'weak');
  }
  return verdicts;
}

function getProfitFactorTone(value) {
  if (value === null || value === undefined) return 'neutral';
  if (!Number.isFinite(value)) return 'positive';
  if (value >= 1.5) return 'positive';
  if (value >= 1.0) return 'neutral';
  return 'negative';
}

function renderSessionInsight(rows) {
  if (rows.length < 2) return '';
  const sorted = [...rows].sort((a, b) => b.netPnl - a.netPnl);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const highestWr = [...rows].sort((a, b) => b.winRate - a.winRate)[0];
  const lowestPf = [...rows]
    .filter((r) => r.profitFactor !== null && Number.isFinite(r.profitFactor))
    .sort((a, b) => a.profitFactor - b.profitFactor)[0];

  const avoidLine = worst && worst.netPnl < 0
    ? `<li>Consider avoiding new trades during <strong>${escapeHtml(worst.label)}</strong>.</li>`
    : '';

  return `
    <div class="session-insight-card">
      <div class="session-insight-header">${icon('target')}<strong>DNA Insight</strong></div>
      <ul class="session-insight-list">
        <li>Best session: <strong>${escapeHtml(best.label)}</strong> (${currency(best.netPnl)})</li>
        ${worst.label !== best.label ? `<li>Worst session: <strong>${escapeHtml(worst.label)}</strong> (${currency(worst.netPnl)})</li>` : ''}
        <li>Highest win rate: <strong>${escapeHtml(highestWr.label)}</strong> (${formatPercent(highestWr.winRate)})</li>
        ${lowestPf ? `<li>Lowest profit factor: <strong>${escapeHtml(lowestPf.label)}</strong> (${formatProfitFactor(lowestPf.profitFactor)})</li>` : ''}
        ${avoidLine}
      </ul>
    </div>`;
}

function tradingSessionRow(r, verdicts) {
  const verdict = verdicts.get(r.label) || 'average';
  const verdictIcon = verdict === 'best' ? '🟢' : verdict === 'weak' ? '🔴' : '🟡';
  const verdictLabel = verdict === 'best' ? 'Best' : verdict === 'weak' ? 'Weak' : 'Average';
  const pnlTone = getPerformanceTone(r.netPnl);
  const rTone = getPerformanceTone(r.averageR);
  const totalRTone = getPerformanceTone(r.totalR);
  const pfTone = getProfitFactorTone(r.profitFactor);

  return `
    <tr>
      <td><strong>${escapeHtml(r.label)}</strong></td>
      <td>${r.tradeCount}</td>
      <td>${formatPercent(r.winRate)}</td>
      <td class="${pnlTone}">${currency(r.netPnl)}</td>
      <td class="${totalRTone}">${r.totalR !== null ? formatRMultiple(r.totalR) : '—'}</td>
      <td class="${rTone}">${formatRMultiple(r.averageR)}</td>
      <td class="${pfTone}">${formatProfitFactor(r.profitFactor)}</td>
      <td><span class="verdict-badge verdict-${verdict}">${verdictIcon} ${verdictLabel}</span></td>
    </tr>`;
}

function renderTimeOfDayAnalytics(tradeList = trades) {
  const rows = getTimeOfDayAnalytics(tradeList);
  if (!rows.length) return '';
  const verdicts = getSessionVerdict(rows);

  return `
    <section class="panel setup-analytics-panel asset-analytics-panel" aria-label="Trading Session Analysis">
      <div class="setup-analytics-header">
        <div>
          <div class="section-title">${icon('calendar')}<h2>Trading Session Analysis</h2></div>
          <p class="section-helper">Performance grouped by trade open time in your device timezone.</p>
        </div>
        <p class="setup-sort-helper">Sorted by Net P&amp;L descending</p>
      </div>
      <div class="setup-analytics-table-wrap">
        <table class="setup-analytics-table asset-analytics-table">
          <thead>
            <tr>
              <th scope="col">Trading Session</th>
              <th scope="col">Trades</th>
              <th scope="col">Win Rate</th>
              <th scope="col">Net P&amp;L</th>
              <th scope="col">Total R</th>
              <th scope="col">Average R</th>
              <th scope="col">Profit Factor</th>
              <th scope="col">Verdict</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => tradingSessionRow(r, verdicts)).join('')}
          </tbody>
        </table>
      </div>
      ${renderSessionInsight(rows)}
    </section>`;
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
  return getActiveTrades().filter((trade) => {
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
  const tradeOutcomes = dayTrades.map((trade, index) => classifyTradeOutcome(tradePnls[index], trade.outcomeOverride));
  const winningPnls = tradePnls.filter((value, index) => tradeOutcomes[index] === 'win');
  const losingPnls = tradePnls.filter((value, index) => tradeOutcomes[index] === 'loss');
  const breakevenCount = tradeOutcomes.filter((outcome) => outcome === 'breakeven').length;
  const rValues = dayTrades.map(calculateRMultiple).filter(Number.isFinite);
  const wins = winningPnls.length;
  const winRate = calculateWinRate(wins, losingPnls.length);
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

const STORAGE_LIMIT_BYTES = 5 * 1024 * 1024; // 5MB standard limit
const STORAGE_WARN_THRESHOLD = 0.80; // warn at 80%
const STORAGE_WARNING_DISMISSED_KEY = 'dna-storage-warning-dismissed-v1';

function getStorageUsageBytes() {
  try {
    return JSON.stringify(localStorage).length * 2;
  } catch {
    return 0;
  }
}

function getStorageUsagePercent() {
  return getStorageUsageBytes() / STORAGE_LIMIT_BYTES;
}

function isStorageWarningDismissed() {
  try {
    const dismissed = localStorage.getItem(STORAGE_WARNING_DISMISSED_KEY);
    if (!dismissed) return false;
    const dismissedAt = parseInt(dismissed, 10);
    const hours24 = 24 * 60 * 60 * 1000;
    return Date.now() - dismissedAt < hours24;
  } catch {
    return false;
  }
}

function dismissStorageWarning() {
  try {
    localStorage.setItem(STORAGE_WARNING_DISMISSED_KEY, String(Date.now()));
  } catch {
    // If localStorage is full we can't store the dismissal — just hide the banner
  }
  const banner = document.querySelector('#storage-warning-banner');
  if (banner) banner.remove();
}

function renderUndoDeleteToast() {
  if (!recentlyDeletedTrade) {
    return '';
  }

  return `
    <div id="undo-delete-toast" class="undo-delete-toast" role="status">
      <span>${icon('trash')} Deleted ${escapeHtml(recentlyDeletedTrade.symbol || 'trade')}.</span>
      <button class="undo-delete-button" type="button" data-undo-delete>Undo</button>
    </div>`;
}

function renderStorageWarning() {
  const usagePct = getStorageUsagePercent();
  if (usagePct < STORAGE_WARN_THRESHOLD) return '';
  if (isStorageWarningDismissed()) return '';

  const usedMB = (getStorageUsageBytes() / (1024 * 1024)).toFixed(1);
  const pct = Math.round(usagePct * 100);

  return `
    <div id="storage-warning-banner" class="storage-warning-banner" role="alert">
      <div class="storage-warning-content">
        ${icon('trend')}
        <div>
          <strong>Storage almost full (${pct}% used — ${usedMB}MB of ~5MB)</strong>
          <span>Your browser storage is running low. Export a JSON backup now to avoid losing data.</span>
        </div>
      </div>
      <div class="storage-warning-actions">
        <button class="storage-warning-export" type="button" id="storageWarnExport">${icon('download')} Export Backup</button>
        <button class="storage-warning-dismiss" type="button" id="storageWarnDismiss" aria-label="Dismiss warning">✕</button>
      </div>
    </div>`;
}

function renderPageModeToggle() {
  return `
        <div class="mode-and-notes-actions">
          <div class="page-mode-toggle" role="group" aria-label="Page mode">
            <button class="page-mode-button ${pageMode === PAGE_MODES.dashboard ? 'active' : ''}" type="button" data-page-mode="${PAGE_MODES.dashboard}" aria-pressed="${pageMode === PAGE_MODES.dashboard ? 'true' : 'false'}">Dashboard Mode</button>
            <button class="page-mode-button ${pageMode === PAGE_MODES.trading ? 'active' : ''}" type="button" data-page-mode="${PAGE_MODES.trading}" aria-pressed="${pageMode === PAGE_MODES.trading ? 'true' : 'false'}">Trading Mode</button>
          </div>
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

function renderSettingsModal() {
  if (!isSettingsModalOpen) {
    return '';
  }

  return `
      <div class="settings-modal-backdrop" role="presentation">
        <form class="settings-modal" id="settingsForm" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
          <h2 id="settingsTitle">Settings</h2>
          <label class="field">
            <span>Starting Account Balance</span>
            <input name="startingAccountBalance" type="number" min="0" step="0.01" value="${escapeHtml(String(startingAccountBalance))}" aria-label="Starting Account Balance" autofocus />
          </label>
          <p class="settings-field-helper">Used to calculate ROI % on the DNA Results dashboard.</p>
          <div class="settings-modal-actions">
            <button class="secondary-button" type="button" data-settings-cancel>Cancel</button>
            <button class="primary-button" type="submit">Save</button>
          </div>
        </form>
      </div>`;
}

function loadDnaResultsTimeframe() {
  const storedTimeframe = window.localStorage.getItem(DNA_TIMEFRAME_STORAGE_KEY);
  return isValidDnaTimeframe(storedTimeframe) ? storedTimeframe : 'all';
}

function loadStartingAccountBalance() {
  const stored = toOptionalNumber(window.localStorage.getItem(STARTING_ACCOUNT_BALANCE_STORAGE_KEY));
  return stored !== null && stored > 0 ? stored : DEFAULT_STARTING_ACCOUNT_BALANCE;
}

function setStartingAccountBalance(rawValue) {
  const parsed = toOptionalNumber(rawValue);
  startingAccountBalance = parsed !== null && parsed > 0 ? parsed : DEFAULT_STARTING_ACCOUNT_BALANCE;
  window.localStorage.setItem(STARTING_ACCOUNT_BALANCE_STORAGE_KEY, String(startingAccountBalance));
}

// ROI % = period P/L ÷ Account Balance at the start of that period × 100.
// Recalculated on every render from the current stats.totalPnl, so it always
// reflects the latest P/L automatically — never stored or cached separately.
function calculateRoiPercent(totalPnl, accountBalance) {
  return accountBalance > 0 ? (totalPnl / accountBalance) * 100 : null;
}

// The ROI card follows the same DNA Results period selector as the rest of
// the dashboard (Day / WTD / MTD / YTD / Beginning). Each period's ROI is
// measured against the account balance as of the *start* of that period,
// not the flat Starting Account Balance setting — except Beginning, which
// by definition has no prior trades and uses the Starting Account Balance
// itself.
//
// Balance at start of period = Starting Account Balance + the net P/L of
// every trade that closed strictly before that period began. This is a
// pure derivation from existing data (never stored), so it can't drift out
// of sync with the trade list.
function calculateAccountBalanceAtPeriodStart(period, referenceDate, allTrades, startingBalance) {
  if (period === 'all') {
    return startingBalance;
  }

  const periodStart = getReportPeriodStart(referenceDate, period);
  const priorPnl = allTrades.reduce((sum, trade) => {
    const tradeDate = getTradeReportDate(trade);
    return tradeDate && tradeDate < periodStart ? sum + calculatePnl(trade) : sum;
  }, 0);

  return startingBalance + priorPnl;
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
  return filterTradesForPeriod(getActiveTrades(), dnaResultsTimeframe, referenceDate);
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
  const outcomes = tradeList.map((trade, index) => classifyTradeOutcome(pnlValues[index], trade.outcomeOverride));
  const totalRiskUsed = tradeList.map(calculateOriginalRiskDollars).filter(Number.isFinite).reduce((sum, value) => sum + value, 0);
  const performanceR = totalRiskUsed > 0 ? pnlValues.reduce((sum, value) => sum + value, 0) / totalRiskUsed : null;
  const riskDollarValues = tradeList.map(calculateRiskDollars).filter(Number.isFinite);
  const riskPercentValues = tradeList.map(calculateRiskPercent).filter(Number.isFinite);
  const wins = pnlValues.filter((value, index) => outcomes[index] === 'win');
  const losses = pnlValues.filter((value, index) => outcomes[index] === 'loss');
  const breakevenCount = outcomes.filter((outcome) => outcome === 'breakeven').length;
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
  // Protected % = Protected trades marked Yes ÷ all completed trades × 100.
  // Every trade passed into getStats() is a completed (closed) trade — there
  // is no open-position concept yet — so tradeList.length is the denominator.
  const protectedYesCount = tradeList.filter((trade) => String(trade.protected || '').trim() === 'Yes').length;
  const protectedPercent = tradeList.length ? (protectedYesCount / tradeList.length) * 100 : null;
  // Capital Efficiency (CE) — see getCapitalExposureWalk/calculateCapitalEfficiency
  // above for the full explanation. Computed from this same tradeList, so it
  // always reflects whatever period/filter the caller already applied.
  const capitalEfficiency = calculateCapitalEfficiency(tradeList);

  return {
    totalPnl,
    winRate: calculateWinRate(wins.length, losses.length),
    breakevenCount,
    tradeCount: tradeList.length,
    averageWin,
    averageLoss,
    totalRiskUsed: totalRiskUsed > 0 ? totalRiskUsed : null,
    averageR: performanceR,
    profitFactor,
    protectedPercent,
    averageRiskDollars,
    averageRiskPercent,
    biggestWinner,
    biggestLoser,
    biggestRisk,
    capitalEfficiency,
  };
}


function hasTradesForDate(dateKey) {
  return getActiveTrades().some((trade) => {
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
  scheduleCTraderAutoSync();
  // force: true — this can set isManualTradeFormOpen itself, and
  // isTradeEditLocked() now includes it, so a plain render() here would
  // otherwise silently no-op and never show the calendar-filtered journal.
  render({ force: true });
  document.querySelector('.journal-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function getFilteredTrades() {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const normalizedAssetFilter = selectedAssetFilter.trim().toLowerCase();

  return getActiveTrades().filter((trade) => {
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
    tag: '<svg viewBox="0 0 24 24"><path d="M20.59 13.41L11 3.83A2 2 0 0 0 9.5 3H4a1 1 0 0 0-1 1v5.5a2 2 0 0 0 .59 1.41l9.58 9.58a2 2 0 0 0 2.83 0l4.59-4.59a2 2 0 0 0 0-2.83z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
    settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
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

function renderRoiCard(roiPercent) {
  const valueClass = getPerformanceTone(roiPercent);
  return `
    <article class="stat-card roi-stat-card">
      <div class="stat-icon">${icon('target')}</div>
      <span>ROI %</span>
      <strong class="${valueClass}">${formatPercent(roiPercent)}</strong>
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
        <div class="journal-header-actions trading-today-actions">
          <button class="secondary-button" type="button" id="dailyExport">🧬 Daily Export</button>
        </div>
        <section class="stats-grid hero-stats-row trading-today-kpi-strip" aria-label="Today trading statistics">
          ${statCard('calendar', 'Today P/L', currency(todayPnl), getMoneyTone(todayPnl))}
          ${statCard('trend', 'Today %', formatPercent(getTodayPnlPercent(todayTrades, todayPnl)))}
          ${statCard('target', 'Win Rate', formatPercent(todayStats.winRate))}
          ${statCard('chart', 'Trades', todayStats.tradeCount)}
          ${statCard('line', 'Profit Factor', formatProfitFactor(todayStats.profitFactor), getProfitFactorTone(todayStats.profitFactor))}
          ${statCard('line', 'CE', formatCapitalEfficiency(todayStats.capitalEfficiency), getPerformanceTone(todayStats.capitalEfficiency))}
        </section>`;
}

function renderHeroStatsRow(stats) {
  return `
        <section class="stats-grid hero-stats-row" aria-label="DNA trading statistics">
          ${statCard('trend', 'Net P/L', currency(stats.totalPnl), getMoneyTone(stats.totalPnl))}
          ${statCard('chart', 'Trades', stats.tradeCount)}
          ${statCard('target', 'Win Rate', formatPercent(stats.winRate))}
          ${statCard('line', 'Profit Factor', formatProfitFactor(stats.profitFactor), getProfitFactorTone(stats.profitFactor))}
          ${statCard('line', 'CE', formatCapitalEfficiency(stats.capitalEfficiency), getPerformanceTone(stats.capitalEfficiency))}
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
  const tradeOutcomeLabel = TRADE_OUTCOME_LABELS[classifyTradeOutcome(pnl, trade.outcomeOverride)] || '';
  const tone = getPerformanceTone(pnl);
  const rTone = getPerformanceTone(rMultiple);
  const importedTimeDetail = cTraderTimeDetails(trade);
  const tradeTime = getTradeTimeDisplay(trade);
  const openedTime = formatTradeTimestamp(trade.openTime);
  const closedTime = formatTradeTimestamp(trade.closeTime);
  const tradeDuration = formatTradeDuration(trade.openTime, trade.closeTime);
  const setupName = String(trade.setup || '').trim();
  const isImported = isCTraderImportedTrade(trade);
  const isEditing = editingTradeIds.has(String(trade.id));
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
    tradeMetric('State', trade.state),
    tradeMetric('Protected', trade.protected),
    tradeMetric('Exit Reason', trade.closeReason),
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
  const dirLabel = String(trade.direction || '');
  const dirClass = dirLabel.toLowerCase();
  const dirArrow = dirClass === 'short' ? '▼' : '▲';
  return `
    <article class="trade-card${isEditing ? ' trade-card--editing' : ''}" data-trade-card="${escapeHtml(trade.id)}">
      <div class="tc-hero">
        <div class="tc-hero-left">
          <span class="tc-direction ${dirClass}">${dirArrow} ${escapeHtml(dirLabel || 'Long')}</span>
          <p class="trade-symbol">${escapeHtml(displaySymbol)}</p>
          ${setupName && !isEditing ? `<span class="tc-setup">${escapeHtml(setupName)}</span>` : ''}
        </div>
        <strong class="trade-pnl-badge ${tone}" aria-label="P&L ${currency(pnl)}">${currency(pnl)}</strong>
      </div>
      <div class="tc-metrics">
        <div class="tc-mc"><span class="tc-ml">Entry</span><span class="tc-mv">${formatOptionalCurrency(trade.entry) || '—'}</span></div>
        <div class="tc-md" aria-hidden="true"></div>
        <div class="tc-mc"><span class="tc-ml">Stop</span><span class="tc-mv">${activeStopLoss !== null ? currency(activeStopLoss) : (stopLoss !== null ? currency(stopLoss) : '—')}</span></div>
        <div class="tc-md" aria-hidden="true"></div>
        <div class="tc-mc"><span class="tc-ml">Exit</span><span class="tc-mv">${formatOptionalCurrency(trade.exit) || '—'}</span></div>
        <div class="tc-md" aria-hidden="true"></div>
        <div class="tc-mc"><span class="tc-ml">Risk $</span><span class="tc-mv">${riskDollars !== null ? currency(riskDollars) : '—'}</span></div>
        <div class="tc-md" aria-hidden="true"></div>
        <div class="tc-mc"><span class="tc-ml">Risk %</span><span class="tc-mv">${riskPercent !== null ? formatRiskPercent(riskPercent) : '—'}</span></div>
        <div class="tc-md" aria-hidden="true"></div>
        <div class="tc-mc"><span class="tc-ml">P/L</span><span class="tc-mv ${tone}">${currency(pnl)}</span></div>
      </div>
      <div class="tc-meta">
        ${[
          isImported ? openedTime : tradeTime,
          tradeDuration,
          trade.timeframe,
          trade.size,
        ].filter(v => v && String(v).trim()).map(v => `<span class="tc-pill">${escapeHtml(String(v))}</span>`).join('')}
      </div>
      ${[
        tradeOutcomeLabel,
        trade.state ? normalizeMarketState(trade.state) : '',
        trade.timeframe,
        trade.tradeManagement,
        trade.grade,
        trade.closeReason,
        trade.lossReason,
      ].filter(v => v && String(v).trim()).length ? `
      <div class="tc-analysis">
        <span class="tc-analysis-label">Analysis</span>
        <div class="tc-analysis-pills">
          ${[
            tradeOutcomeLabel,
            trade.state ? normalizeMarketState(trade.state) : '',
            trade.timeframe,
            trade.tradeManagement,
            trade.grade,
            trade.closeReason,
            trade.lossReason,
          ].filter(v => v && String(v).trim()).map(v => `<span class="tc-pill tc-pill--analysis">${escapeHtml(String(v))}</span>`).join('')}
        </div>
      </div>` : ''}
      ${!isEditing ? `
      <details class="tc-expander">
        <summary class="tc-expander-summary">Risk, journal &amp; details</summary>
        <div class="tc-expander-body">
          <div class="trade-panel-grid">
            ${riskPanel}
            ${journalPanel}
            ${detailsPanel}
            ${sourcePanel}
          </div>
          ${tradeJournalDetails(trade)}
        </div>
      </details>` : (editingTradeModeByTradeId.get(String(trade.id)) === 'quick' ? editTradeFormQuickEdit(trade) : editTradeForm(trade))}
      ${!isEditing ? `
        <div class="trade-card-actions">
          <button class="edit-button" type="button" data-edit-trade="${escapeHtml(trade.id)}" aria-label="Edit journaling fields for ${escapeHtml(displaySymbol)} trade">${icon('edit')} Edit</button>
          <button class="edit-button quick-edit-button" type="button" data-quick-edit-trade="${escapeHtml(trade.id)}" aria-label="Quick edit ${escapeHtml(displaySymbol)} trade">${icon('edit')} Quick Edit</button>
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
  const tagsDetail = trade.tags ? `
      <details class="edit-collapsible journal-detail-section">
        <summary>${icon('tag')} Tags</summary>
        <p class="notes">${escapeHtml(trade.tags)}</p>
      </details>` : '';

  return `
      ${notesDetail}
      ${screenshotDetail}
      ${tagsDetail}`;
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
  const selectedSetup = currentSetup === 'Uncategorized setup' ? '' : normalizeSetupName(currentSetup);
  const isCustomSetup = selectedSetup && !isPlayBookSetup(selectedSetup);
  const selectedChoice = isCustomSetup ? CUSTOM_SETUP_OPTION : selectedSetup;
  return `
    <select name="setupChoice" aria-label="Play Book setup">
      <option value=""${selectedChoice === '' ? ' selected' : ''} hidden disabled></option>
      ${PLAY_BOOK_SETUP_OPTIONS.map((option) => renderSetupOption(option, selectedChoice)).join('')}
      ${renderSetupOption(CUSTOM_SETUP_OPTION, selectedChoice)}
    </select>
    <input name="setupCustom" data-custom-setup placeholder="Custom setup" value="${escapeHtml(isCustomSetup ? selectedSetup : '')}"${isCustomSetup ? '' : ' hidden'} />
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
  const legacyCloseReasonOption = currentCloseReason && !CLOSE_REASON_OPTIONS.includes(currentCloseReason)
    ? renderSelectOption(currentCloseReason, currentCloseReason)
    : '';
  return `
    <select name="closeReason" aria-label="Exit Reason">
      <option value="">No close reason</option>
      ${CLOSE_REASON_OPTIONS.map((option) => renderSelectOption(option, currentCloseReason)).join('')}
      ${legacyCloseReasonOption}
    </select>
  `;
}

function renderMarketStateSelect(trade) {
  const current = normalizeMarketState(trade.state);
  const legacyMarketStateOption = current && !MARKET_STATE_OPTIONS.includes(current)
    ? renderSelectOption(current, current)
    : '';
  return `
    <select name="state" aria-label="Market State">
      ${MARKET_STATE_OPTIONS.map((option) => renderSelectOption(option, current)).join('')}
      ${legacyMarketStateOption}
    </select>
  `;
}

function renderTimeframeSelect(trade) {
  const current = String(trade.timeframe || '').trim();
  return `
    <select name="timeframe" aria-label="Timeframe">
      <option value="">None</option>
      ${TRADE_TIMEFRAME_OPTIONS.map((option) => renderSelectOption(option, current)).join('')}
    </select>
  `;
}

// Protected is no longer independently editable — it's calculated
// automatically from Trade Management (see TRADE_MANAGEMENT_PROTECTED_MAP
// above). Rendered as a readonly text input (not a disabled <select>) so its
// value still submits normally via FormData, exactly like the readonly
// Entry/Exit Price inputs above. The tradeManagement change listener in
// bindTradeCardEvents keeps this input's value in sync immediately whenever
// Trade Management changes, before the trade is saved.
function renderProtectedDisplay(trade) {
  const value = getSmartProtectedValue(trade.tradeManagement);
  return `<input name="protected" type="text" value="${escapeHtml(value)}" readonly aria-label="Protected (calculated automatically from Trade Management)" />`;
}

function renderGradeSelect(trade) {
  const current = String(trade.grade || '').trim();
  return `
    <select name="grade" aria-label="Grade">
      <option value="">Not Graded</option>
      ${GRADE_OPTIONS.map((option) => renderSelectOption(option, current)).join('')}
    </select>
  `;
}

// Blank/"Auto" is the default for every trade (existing and new) — the
// automatic classifyTradeOutcome() dollar-threshold rule applies exactly as
// before. Picking Win/Breakeven/Loss here overrides that everywhere the
// trade's outcome is used (trade card, dashboard, statistics, exports).
function renderOutcomeOverrideSelect(trade) {
  const current = String(trade.outcomeOverride || '').trim();
  return `
    <select name="outcomeOverride" aria-label="Outcome Override">
      <option value="">Auto</option>
      ${OUTCOME_OVERRIDE_OPTIONS.map((option) => renderSelectOption(option, current)).join('')}
    </select>
  `;
}

function renderTradeManagementSelect(trade) {
  const current = String(trade.tradeManagement || '').trim();
  return `
    <select name="tradeManagement" aria-label="Trade Management">
      <option value="">None</option>
      ${TRADE_MANAGEMENT_OPTIONS.map((option) => renderSelectOption(option, current)).join('')}
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

function toggleCustomSetupInput(select) {
  const customInput = select.closest('form')?.querySelector('[data-custom-setup]');
  if (customInput) {
    customInput.hidden = select.value !== CUSTOM_SETUP_OPTION;
  }
}

function editTradeForm(trade) {
  const currentScreenshot = getEditScreenshotPreview(trade);
  const removeButton = currentScreenshot
    ? `<button class="secondary-button" type="button" data-remove-edit-screenshot="${escapeHtml(trade.id)}">${icon('trash')} Remove screenshot</button>`
    : '';
  // Loss Reason only applies to trades that actually closed as a Loss —
  // reuses the same shared classifier as everywhere else Win/Loss/Breakeven
  // is decided, so it can never disagree with the trade card's own outcome.
  const isLossOutcome = classifyTradeOutcome(calculatePnl(trade), trade.outcomeOverride) === 'loss';
  return `
      <form class="edit-trade-form" data-edit-trade-form="${escapeHtml(trade.id)}">
        <div class="edit-mode-banner" aria-label="Edit mode active">
          ✏️ EDIT MODE
        </div>
        <div class="edit-form-section">
          <h4 class="edit-form-section-label">Trade Plan</h4>
          <div class="edit-form-row edit-price-row" aria-label="Trade prices and take profits">
            ${field('Entry Price', `<input name="entry" type="number" value="${escapeHtml(trade.entry)}" readonly />`)}
            ${field('Exit Price', `<input name="exit" type="number" value="${escapeHtml(trade.exit)}" readonly />`)}
            ${field('Initial Stop Loss', `<input name="stopLoss" type="number" value="${escapeHtml(trade.stopLoss ?? '')}" readonly />`)}
            ${field('Final Stop Loss', `<input name="adjustedStopLoss" type="number" min="0" step="0.01" value="${escapeHtml(trade.adjustedStopLoss ?? '')}" placeholder="Optional" />`)}
            ${field('Initial Take Profit', `<input name="takeProfit" type="number" min="0" step="0.01" value="${escapeHtml(trade.takeProfit ?? '')}" placeholder="Optional" />`)}
            ${field('Final Take Profit', `<input name="adjustedTakeProfit" type="number" min="0" step="0.01" value="${escapeHtml(trade.adjustedTakeProfit ?? '')}" placeholder="Optional" />`)}
          </div>
        </div>
        <div class="edit-form-section">
          <h4 class="edit-form-section-label">Setup</h4>
          <div class="edit-form-row edit-journal-row" aria-label="Setup context">
            ${field('State', renderMarketStateSelect(trade))}
            ${field('Setup', renderPlayBookSetupSelect(trade))}
            ${field('Timeframe', renderTimeframeSelect(trade))}
          </div>
        </div>
        <div class="edit-form-section">
          <h4 class="edit-form-section-label">Trade Review</h4>
          <div class="edit-form-row edit-review-row" aria-label="Trade review">
            ${field('Trade Management', renderTradeManagementSelect(trade))}
            ${field('Protected', renderProtectedDisplay(trade))}
            ${field('Exit Reason', renderCloseReasonSelect(trade))}
            <div class="edit-loss-reason-field"${isLossOutcome ? '' : ' hidden'}>
              ${field('Loss Reason', renderLossReasonSelect(trade))}
            </div>
          </div>
          <div class="edit-form-row edit-review-row" aria-label="Trade grade and outcome override">
            ${field('Grade', renderGradeSelect(trade))}
            ${field('Outcome Override', renderOutcomeOverrideSelect(trade))}
          </div>
        </div>
        <div class="edit-form-section">
          <h4 class="edit-form-section-label">Journal</h4>
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
        </div>
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

// DNA 23 Quick Edit v1.1 — compact two-column-where-it-helps layout, tuned
// to fit a 400–450px split-screen panel with little or no scrolling. Still
// reuses the exact same field components, input names, and submitTradeEdit
// save logic as editTradeForm() above: no new database fields, no new
// validation, no new calculations. Loss Reason is kept (hidden for
// non-loss trades, same as Review) purely so its form field stays present —
// submitTradeEdit() reads formData.get('lossReason') unconditionally, so
// omitting the field would overwrite saved data with the literal string
// "null". Screenshot is collapsed by default behind a Show/Hide toggle to
// save vertical space; it uses the same <details> pattern as the Review
// form's collapsible sections.
function editTradeFormQuickEdit(trade) {
  const currentScreenshot = getEditScreenshotPreview(trade);
  const removeButton = currentScreenshot
    ? `<button class="secondary-button" type="button" data-remove-edit-screenshot="${escapeHtml(trade.id)}">${icon('trash')} Remove screenshot</button>`
    : '';
  const isLossOutcome = classifyTradeOutcome(calculatePnl(trade), trade.outcomeOverride) === 'loss';
  return `
      <form class="edit-trade-form quick-edit-form" data-edit-trade-form="${escapeHtml(trade.id)}">
        <div class="edit-mode-banner quick-edit-banner" aria-label="Quick Edit mode active">
          ⚡ QUICK EDIT
        </div>
        <div class="edit-form-section quick-edit-section">
          <h4 class="edit-form-section-label">Trade</h4>
          <div class="quick-edit-row">
            ${field('Entry Price', `<input name="entry" type="number" value="${escapeHtml(trade.entry)}" readonly />`)}
            ${field('Exit Price', `<input name="exit" type="number" value="${escapeHtml(trade.exit)}" readonly />`)}
          </div>
          <div class="quick-edit-row">
            ${field('Initial Stop Loss', `<input name="stopLoss" type="number" value="${escapeHtml(trade.stopLoss ?? '')}" readonly />`)}
            ${field('Final Stop Loss', `<input name="adjustedStopLoss" type="number" min="0" step="0.01" value="${escapeHtml(trade.adjustedStopLoss ?? '')}" placeholder="Optional" />`)}
          </div>
          <div class="quick-edit-row">
            ${field('Initial Take Profit', `<input name="takeProfit" type="number" min="0" step="0.01" value="${escapeHtml(trade.takeProfit ?? '')}" placeholder="Optional" />`)}
            ${field('Final Take Profit', `<input name="adjustedTakeProfit" type="number" min="0" step="0.01" value="${escapeHtml(trade.adjustedTakeProfit ?? '')}" placeholder="Optional" />`)}
          </div>
        </div>
        <div class="edit-form-section quick-edit-section">
          <h4 class="edit-form-section-label">Setup</h4>
          <div class="quick-edit-row">
            ${field('State', renderMarketStateSelect(trade))}
            ${field('Setup', renderPlayBookSetupSelect(trade))}
          </div>
          <div class="quick-edit-row">
            ${field('Timeframe', renderTimeframeSelect(trade))}
          </div>
        </div>
        <div class="edit-form-section quick-edit-section">
          <h4 class="edit-form-section-label">Management</h4>
          <div class="quick-edit-row">
            ${field('Trade Management', renderTradeManagementSelect(trade))}
            ${field('Protected', renderProtectedDisplay(trade))}
          </div>
          <div class="quick-edit-row">
            ${field('Exit Reason', renderCloseReasonSelect(trade))}
            <div class="edit-loss-reason-field"${isLossOutcome ? '' : ' hidden'}>
              ${field('Loss Reason', renderLossReasonSelect(trade))}
            </div>
          </div>
          ${field('Grade', renderGradeSelect(trade))}
          ${field('Outcome Override', renderOutcomeOverrideSelect(trade))}
        </div>
        <div class="edit-form-section quick-edit-section">
          <h4 class="edit-form-section-label">Journal</h4>
          ${field('Notes', `<textarea name="notes" rows="3" placeholder="What was the plan? What happened?">${escapeHtml(trade.notes)}</textarea>`)}
          <details class="edit-collapsible quick-edit-screenshot">
            <summary>${icon('image')} Screenshot ${currentScreenshot ? '(attached)' : ''}<span class="quick-edit-toggle-label">Show/Hide</span></summary>
            <div class="screenshot-upload-field">
              <label class="screenshot-upload">
                <span>${icon('image')} Trade screenshot</span>
                <input name="editScreenshot" type="file" accept="image/*" data-edit-screenshot-input="${escapeHtml(trade.id)}" />
                <small>Tip: Paste a screenshot with Ctrl+V / Cmd+V</small>
              </label>
              <div class="screenshot-field-preview" data-edit-screenshot-preview="${escapeHtml(trade.id)}" aria-live="polite">
                ${currentScreenshot ? screenshotLink(currentScreenshot, `${getTradeDisplaySymbol(trade)} trade screenshot`) : ''}
              </div>
              ${removeButton}
            </div>
          </details>
        </div>
        <div class="edit-form-actions quick-edit-actions">
          <button class="secondary-button" type="button" data-cancel-edit-trade="${escapeHtml(trade.id)}">Cancel</button>
          <button class="primary-button" type="submit">${icon('save')} Save</button>
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
  // Deleted trades (Trash) are excluded from every dashboard/journal read
  // below via this one list — `trades` itself still holds them (see
  // getActiveTrades() above).
  const activeTrades = getActiveTrades();
  const dnaResultsTrades = getDnaResultsTrades(dnaReferenceDate);
  const stats = getStats(dnaResultsTrades);
  const pnlReports = getPnlReports(dnaReferenceDate, activeTrades);
  const [dailyPnl, weeklyPnl, monthlyPnl, yearlyPnl] = pnlReports;
  const roiAccountBalance = calculateAccountBalanceAtPeriodStart(dnaResultsTimeframe, dnaReferenceDate, activeTrades, startingAccountBalance);
  const roiPercent = calculateRoiPercent(stats.totalPnl, roiAccountBalance);
  const dashboardCardRows = [
    {
      label: 'R Metrics',
      cards: [
        renderRoiCard(roiPercent),
        statCard('trend', 'Biggest Winner', stats.biggestWinner === null ? '—' : currency(stats.biggestWinner)),
        statCard('trend', 'Biggest Loser', stats.biggestLoser === null ? '—' : currency(stats.biggestLoser), getMoneyTone(stats.biggestLoser)),
        statCard('chart', 'Protected %', formatPercent(stats.protectedPercent)),
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
    {
      label: 'Capital Efficiency',
      cards: [
        statCard('line', 'Daily CE', formatCapitalEfficiency(dailyPnl.capitalEfficiency), getPerformanceTone(dailyPnl.capitalEfficiency)),
        statCard('line', 'Weekly CE', formatCapitalEfficiency(weeklyPnl.capitalEfficiency), getPerformanceTone(weeklyPnl.capitalEfficiency)),
        statCard('line', 'Monthly CE', formatCapitalEfficiency(monthlyPnl.capitalEfficiency), getPerformanceTone(monthlyPnl.capitalEfficiency)),
        statCard('line', 'Yearly CE', formatCapitalEfficiency(yearlyPnl.capitalEfficiency), getPerformanceTone(yearlyPnl.capitalEfficiency)),
      ],
    },
  ];
  const filteredTrades = getFilteredTrades();
  const monthlyTradingCalendarSection = renderMonthlyTradingCalendar(monthlyCalendarDate, activeTrades);
  const setupAnalyticsSection = renderSetupAnalytics(dnaResultsTrades);
  const assetAnalyticsSection = renderAssetAnalytics(dnaResultsTrades);
  const timeOfDayAnalyticsSection = renderTimeOfDayAnalytics(dnaResultsTrades);
  const dnaDoctorSection = renderDnaDoctor(dnaResultsTrades);
  const today = new Date().toISOString().slice(0, 10);
  const todayTrades = filterTradesForPeriod(activeTrades, 'day', dnaReferenceDate);
  // Manual Trade panel is shown in Trading Mode too now — same button,
  // same renderManualTradeForm(), same submitTrade() save logic. No second
  // button is created; this is the one panel from renderJournalWorkspace().
  // isTradingMode only keeps the existing compact header/spacing styling.
  const tradingModeSections = `${renderTodayKpiStrip(todayTrades, getStats(todayTrades))}${renderJournalWorkspace(filteredTrades, today, { isTradingMode: true })}`;
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

      ${assetAnalyticsSection}

      ${timeOfDayAnalyticsSection}

      ${dnaDoctorSection}`;
  const pageSections = pageMode === PAGE_MODES.trading
    ? tradingModeSections
    : `${dashboardSections}${journalWorkspaceSection}`;

  app.innerHTML = `
    <main class="app-shell">
      ${renderUndoDeleteToast()}
      ${renderStorageWarning()}
      <section class="hero-card">
        <div class="hero-branding">
          <div class="dna-brand-lockup" aria-label="DNA Decisions Numbers Analysis">
            <img class="dna-logo" src="./DNA_beautiful_logo.jpg" alt="DNA – Decisions Numbers Analysis – MineTheMarket.com" />
          </div>
          <h1>Discover your edge.</h1>
          <p class="hero-tagline">Every trade leaves clues. DNA helps you find them.</p>
          <p class="hero-copy">
            DNA is a trader performance analysis system designed to uncover patterns, strengths, weaknesses, habits, and edge through the study of Decisions, Numbers, and Analysis.
          </p>
          <div class="hero-pills">
            <div class="hero-pill">
              ${icon('target')}
              <div>
                <strong>Uncover Patterns</strong>
                <span>Find what's working (and what's not)</span>
              </div>
            </div>
            <div class="hero-pill">
              ${icon('chart')}
              <div>
                <strong>Track Performance</strong>
                <span>Powerful analytics that reveal the truth</span>
              </div>
            </div>
            <div class="hero-pill">
              ${icon('trend')}
              <div>
                <strong>Improve Consistently</strong>
                <span>Make better decisions trade after trade</span>
              </div>
            </div>
          </div>
        </div>
        <div class="hero-actions">
          ${pageMode === PAGE_MODES.dashboard ? `<button class="share-dashboard-button" type="button" id="shareDashboard">${icon('download')} Download PNG</button>` : ''}
          <button class="secondary-button settings-button" type="button" data-settings-open title="Settings" aria-label="Settings">${icon('settings')} Settings</button>
          ${renderCTraderConnectionCard()}
        </div>
      </section>
      <div class="hero-trust-bar">
        <div class="hero-trust-item">${icon('target')}<div><strong>Make Better Decisions</strong><span>Data you can trust</span></div></div>
        <div class="hero-trust-item">${icon('refresh')}<div><strong>Save Time</strong><span>Auto sync. Always up to date.</span></div></div>
        <div class="hero-trust-item">${icon('book')}<div><strong>Your Data, Yours</strong><span>Secure. Private. Yours.</span></div></div>
        <div class="hero-trust-item">${icon('trend')}<div><strong>Built for Traders</strong><span>By a trader. For traders.</span></div></div>
      </div>

      ${renderPageModeToggle()}

      ${pageSections}
      ${renderSessionNotesModal()}
      ${renderSettingsModal()}
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
  // The Manual Trade panel now always shows (Trading Mode included — see
  // tradingModeSections in render()). isTradingMode only controls the
  // compact Trading Mode header/spacing class below; it's a separate
  // concern from whether the panel renders, which the old
  // showManualTradePanel flag used to conflate.
  const isTradingMode = options.isTradingMode === true;
  const journalPanelClass = isTradingMode ? 'panel journal-panel trading-mode-journal-panel' : 'panel journal-panel';
  // Manual Trade panel moved to the top of the journal panel (was a
  // separate section rendered after the entire trade list, which meant
  // scrolling past every trade card to find "Add Manual Trade"). Same
  // button id, same aria wiring, same renderManualTradeForm() — only its
  // position changed, so bindEvents()'s existing #toggleManualTrade
  // listener and the form's save logic are untouched. Rendered for both
  // Dashboard and Trading Mode now (showManualTradePanel defaults to true;
  // no separate button is created — Trading Mode reuses this exact one).
  return `
      <section class="workspace-grid">
        <section class="${journalPanelClass}">
          <div class="journal-header">
            <div>
              <div class="section-title">${icon('calendar')}<h2>Journal entries</h2></div>
              <p class="section-helper">Review, search, and edit imported cTrader trades first.</p>
            </div>
            <div class="journal-header-actions">
              <input class="search-input" id="searchInput" placeholder="Search trades..." value="${escapeHtml(searchQuery)}" />
              <button class="secondary-button save-all-trades-button" type="button" data-save-all-trades${dirtyTradeIds.size === 0 ? ' hidden' : ''}>${icon('save')} Save All Changes</button>
              <button class="secondary-button session-notes-button" type="button" data-session-notes-open title="Session Notes" aria-label="Session Notes">📝 Session Notes</button>
              <button class="secondary-button trash-toggle-button" type="button" data-toggle-trash aria-expanded="${isTrashOpen ? 'true' : 'false'}" title="Trash" aria-label="Trash">${icon('trash')} Trash${trashedTradeCount() ? ` (${trashedTradeCount()})` : ''}</button>
            </div>
          </div>
          <section class="manual-trade-panel">
            <button class="secondary-button manual-trade-toggle" type="button" id="toggleManualTrade" aria-expanded="${isManualTradeFormOpen ? 'true' : 'false'}" aria-controls="tradeForm">
              ${icon(isManualTradeFormOpen ? 'minus' : 'book')} ${isManualTradeFormOpen ? 'Hide Manual Trade Form' : 'Add Manual Trade'}
            </button>
            ${isManualTradeFormOpen ? renderManualTradeForm(manualTradeDateKey || today) : '<p class="manual-trade-helper">Use this only for trades that did not come from cTrader import.</p>'}
          </section>
          ${isTrashOpen ? renderTrashPanel() : `
          <div class="trade-list">
            ${filteredTrades.length ? filteredTrades.map((trade) => {
              try {
                return tradeCard(trade);
              } catch (err) {
                console.error('[DNA] tradeCard render error for trade', trade?.id, err);
                return `<div class="trade-card trade-card-error">
                  <p>⚠️ Could not display trade <strong>${escapeHtml(String(trade?.id ?? 'unknown'))}</strong>. Data may be corrupted.</p>
                  <p class="trade-card-error-hint">Export your journal and re-import to attempt recovery.</p>
                </div>`;
              }
            }).join('') : '<p class="empty-state">No trades match your search yet.</p>'}
          </div>`}
        </section>
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
        ${field('Timeframe', renderTimeframeSelect({ timeframe: '1m' }))}
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
  // Abort all previous listeners before rebinding — prevents accumulation on every render
  if (bindEventsController) {
    bindEventsController.abort();
  }
  bindEventsController = new AbortController();
  const { signal } = bindEventsController;

  const tradeForm = document.querySelector('#tradeForm');
  const screenshotInput = tradeForm?.querySelector('input[name="screenshot"]');

  document.querySelector('#toggleManualTrade')?.addEventListener('click', toggleManualTradeForm, { signal });
  document.querySelector('#shareDashboard')?.addEventListener('click', openShareDashboardView, { signal });
  document.querySelector('.dna-doctor-full-report')?.addEventListener('toggle', (event) => {
  dnaDoctorState.fullReportOpen = event.currentTarget.open;
}, { signal });
  document.querySelector('#runDnaDoctor')?.addEventListener('click', async () => {
    // Preserve existing report during re-scan — never flash empty content
    dnaDoctorState = { ...dnaDoctorState, status: 'loading', report: dnaDoctorState.report, error: null, dismissError: false };
    render();

    // Animate loading steps without full re-render
    const steps = DNA_DOCTOR_LOADING_STEPS;
    let stepIndex = 0;
    const stepInterval = setInterval(() => {
      stepIndex = (stepIndex + 1) % steps.length;
      const el = document.querySelector('#dnaDoctorLoadingStep');
      if (el) el.textContent = steps[stepIndex];
    }, 1500);

    try {
      const dnaResultsTrades = getDnaResultsTrades(getDnaResultsReferenceDate());
      const report = await runDnaDoctor(dnaResultsTrades);
      clearInterval(stepInterval);
      dnaDoctorState = { ...dnaDoctorState, status: 'done', report, error: null, dismissError: false };
    } catch (err) {
      clearInterval(stepInterval);
      dnaDoctorState = { ...dnaDoctorState, status: 'error', report: dnaDoctorState.report, error: err.message || 'Something went wrong.', dismissError: false };
    }
    render();
  });

  document.querySelector('#dnaDoctorDismissError')?.addEventListener('click', () => {
    dnaDoctorState = { ...dnaDoctorState, dismissError: true };
    document.querySelector('#dnaDoctorErrorBanner')?.remove();
  });

  document.querySelector('[data-save-all-trades]')?.addEventListener('click', saveAllEditedTrades, { signal });

  document.querySelectorAll('[data-toggle-trash]').forEach((button) => {
    button.addEventListener('click', toggleTrash, { signal });
  });
  document.querySelectorAll('[data-restore-trade]').forEach((button) => {
    button.addEventListener('click', () => restoreTrade(button.dataset.restoreTrade), { signal });
  });
  document.querySelectorAll('[data-permanent-delete-trade]').forEach((button) => {
    button.addEventListener('click', () => permanentlyDeleteTrade(button.dataset.permanentDeleteTrade), { signal });
  });
  document.querySelector('[data-undo-delete]')?.addEventListener('click', () => {
    undoLastDelete();
    render({ force: true });
  }, { signal });

  document.querySelector('[data-session-notes-open]')?.addEventListener('click', () => {
    isSessionNotesModalOpen = true;
    render();
  });
  document.querySelector('[data-session-notes-cancel]')?.addEventListener('click', () => {
    isSessionNotesModalOpen = false;
    render();
  });
  document.querySelector('#sessionNotesForm')?.addEventListener('submit', (event, { signal }) => {
    event.preventDefault();
    saveTodaySessionNote(new FormData(event.currentTarget).get('sessionNoteText'));
    isSessionNotesModalOpen = false;
    render();
  });
  document.querySelector('[data-settings-open]')?.addEventListener('click', () => {
    isSettingsModalOpen = true;
    render();
  });
  document.querySelector('[data-settings-cancel]')?.addEventListener('click', () => {
    isSettingsModalOpen = false;
    render();
  });
  document.querySelector('#settingsForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    setStartingAccountBalance(new FormData(event.currentTarget).get('startingAccountBalance'));
    isSettingsModalOpen = false;
    render();
  });
  document.querySelectorAll('[data-page-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      setPageMode(button.dataset.pageMode);
      render();
    });
  });
  if (tradeForm) {
    tradeForm.addEventListener('submit', submitTrade, { signal });
    tradeForm.addEventListener('input', updateRiskPercentField, { signal });
    screenshotInput?.addEventListener('change', changeScreenshot, { signal });
  }

  if (!isPasteListenerBound) {
    document.addEventListener('paste', pasteScreenshot);
    isPasteListenerBound = true;
  }
  document.querySelector('#searchInput').addEventListener('input', (event, { signal }) => {
    searchQuery = event.target.value;
    render();
    document.querySelector('#searchInput').focus();
  });
  document.querySelector('#autoSyncCTrader').addEventListener('change', changeCTraderAutoSyncSetting, { signal });
  document.querySelector('#cTraderAccountSelect')?.addEventListener('change', changeCTraderAccountSelection, { signal });
  document.querySelector('#refreshCTraderAccounts')?.addEventListener('click', () => loadCTraderAccounts({ force: true }));
  document.querySelector('#connectCTrader')?.addEventListener('click', startCTraderOAuthFlow, { signal });
  document.querySelector('#syncCTrader').addEventListener('click', () => syncCTrader({ source: 'manual' }));
  document.querySelector('#deleteAllCTraderImports').addEventListener('click', deleteAllCTraderImports, { signal });
  document.querySelector('#deleteAllScreenshots').addEventListener('click', deleteAllScreenshots, { signal });
  document.querySelector('#exportTrades').addEventListener('click', exportTrades, { signal });
  // Only present in Trading Mode (see renderTodayKpiStrip) — optional
  // chaining so binding is a no-op in Dashboard Mode, same pattern as
  // #connectCTrader above.
  document.querySelector('#dailyExport')?.addEventListener('click', exportDailyTrades, { signal });
  document.querySelector('#storageWarnExport')?.addEventListener('click', () => { exportTrades(); dismissStorageWarning(); });
  document.querySelector('#storageWarnDismiss')?.addEventListener('click', dismissStorageWarning, { signal });
  document.querySelector('#importTrades').addEventListener('change', importTrades, { signal });
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
  document.querySelector('[data-calendar-review-close]')?.addEventListener('click', closeCalendarDayReview, { signal });
  document.querySelector('[data-calendar-review-open-journal]')?.addEventListener('click', (event, { signal }) => {
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
    link.addEventListener('click', openScreenshotLink, { signal });
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

  tradeCardElement.querySelectorAll('[data-quick-edit-trade]').forEach((button) => {
    button.addEventListener('click', () => {
      openTradeEdit(button.dataset.quickEditTrade, 'quick');
    });
  });

  tradeCardElement.querySelectorAll('[data-cancel-edit-trade]').forEach((button) => {
    button.addEventListener('click', () => {
      const tradeId = button.dataset.cancelEditTrade;
      // Only this card's edit state is cleared — every other open card (and
      // its unsaved form state) is untouched, and renderTradeCardInPlace
      // only swaps this one card's DOM.
      closeTradeEdit(tradeId);
      renderTradeCardInPlace(tradeId);
    });
  });

  tradeCardElement.querySelectorAll('[data-edit-trade-form]').forEach((form) => {
    form.addEventListener('submit', submitTradeEdit);
    // Dirty tracking for "Save All Changes": the first time the user
    // actually types/changes something in this card, mark it dirty. This is
    // a lightweight DOM update only (see updateSaveAllButtonVisibility) —
    // it never calls render(), so it never touches any other open card's
    // uncontrolled <input> values.
    const tradeId = form.dataset.editTradeForm;
    form.addEventListener('input', () => markTradeEditDirty(tradeId));
    form.addEventListener('change', () => markTradeEditDirty(tradeId));
  });

  tradeCardElement.querySelectorAll('select[name="setupChoice"]').forEach((select) => {
    select.addEventListener('change', () => {
      toggleCustomSetupInput(select);
    });
  });

  // Smart Protected: whenever Trade Management changes in an open edit
  // card, immediately recalculate the read-only Protected value in that
  // same card — before Save, and without touching any other open card
  // (scoped to this tradeCardElement, same as the rest of this function).
  tradeCardElement.querySelectorAll('select[name="tradeManagement"]').forEach((select) => {
    select.addEventListener('change', () => {
      const form = select.closest('form');
      const protectedInput = form?.querySelector('input[name="protected"]');
      if (protectedInput) {
        protectedInput.value = getSmartProtectedValue(select.value);
      }
      const closeReasonSelect = form?.querySelector('select[name="closeReason"]');
      if (closeReasonSelect && closeReasonSelect.dataset.manuallyChanged !== 'true' && isSmartCloseReasonValue(closeReasonSelect.value, closeReasonSelect.dataset.tradeManagement)) {
        closeReasonSelect.value = getSmartCloseReasonValue(select.value);
      }
      if (closeReasonSelect) {
        closeReasonSelect.dataset.tradeManagement = select.value;
      }
    });
  });

  tradeCardElement.querySelectorAll('select[name="closeReason"]').forEach((select) => {
    select.dataset.tradeManagement = select.closest('form')?.querySelector('select[name="tradeManagement"]')?.value || '';
    select.addEventListener('change', () => {
      select.dataset.manuallyChanged = 'true';
    });
  });

  tradeCardElement.querySelectorAll('[data-edit-screenshot-input]').forEach((input) => {
    input.addEventListener('change', changeEditScreenshot);
  });

  tradeCardElement.querySelectorAll('[data-remove-edit-screenshot]').forEach((button) => {
    button.addEventListener('click', removeEditScreenshot);
  });

  tradeCardElement.querySelectorAll('[data-delete-trade]').forEach((button) => {
    button.addEventListener('click', () => {
      closeTradeEdit(button.dataset.deleteTrade);
      softDeleteTrade(button.dataset.deleteTrade);
    });
  });
}

// Soft delete: the trade stays in `trades` (and in localStorage) with a
// deletedAt timestamp instead of being removed. getActiveTrades() (used by
// every journal/dashboard read path — see its definition above) excludes
// it, so it disappears from the journal and every stat immediately, exactly
// like the old hard delete did. Unlike the old hard delete, nothing is
// actually lost: it can be viewed in Trash and Restored, or Permanently
// Deleted once the user is sure.
function softDeleteTrade(tradeId) {
  const trade = getTradeById(tradeId);
  if (!trade || trade.deletedAt) {
    return;
  }

  // Same as the old hard-delete behavior: a cTrader-imported trade is
  // blocked from being re-imported by Auto Sync while it's deleted (Trash
  // counts as deleted). restoreTrade() below un-blocks it.
  rememberDeletedCTraderSourceKey(trade);

  recentlyDeletedTrade = { id: trade.id, symbol: getTradeDisplaySymbol(trade), direction: trade.direction };
  scheduleUndoToastDismiss();

  persistTrades(trades.map((existingTrade) => (
    String(existingTrade.id) === String(tradeId)
      ? { ...existingTrade, deletedAt: new Date().toISOString() }
      : existingTrade
  )));
}

function restoreTrade(tradeId) {
  const trade = getTradeById(tradeId);
  if (!trade || !trade.deletedAt) {
    return;
  }

  forgetDeletedCTraderSourceKey(trade);

  if (recentlyDeletedTrade?.id === trade.id) {
    dismissUndoToast();
  }

  persistTrades(trades.map((existingTrade) => (
    String(existingTrade.id) === String(tradeId)
      ? { ...existingTrade, deletedAt: null }
      : existingTrade
  )));
}

function permanentlyDeleteTrade(tradeId) {
  const trade = getTradeById(tradeId);
  if (!trade || !trade.deletedAt) {
    return;
  }

  if (!window.confirm(`Permanently delete this ${getTradeDisplaySymbol(trade)} trade? This cannot be undone.`)) {
    return;
  }

  if (recentlyDeletedTrade?.id === trade.id) {
    dismissUndoToast();
  }

  persistTrades(trades.filter((existingTrade) => String(existingTrade.id) !== String(tradeId)));
}

function scheduleUndoToastDismiss() {
  if (undoToastTimer !== null) {
    clearTimeout(undoToastTimer);
  }

  undoToastTimer = window.setTimeout(() => {
    undoToastTimer = null;
    recentlyDeletedTrade = null;
    render({ force: true });
  }, UNDO_TOAST_DURATION_MS);
}

function dismissUndoToast() {
  if (undoToastTimer !== null) {
    clearTimeout(undoToastTimer);
    undoToastTimer = null;
  }
  recentlyDeletedTrade = null;
}

function undoLastDelete() {
  if (!recentlyDeletedTrade) {
    return;
  }

  restoreTrade(recentlyDeletedTrade.id);
}

function toggleTrash() {
  isTrashOpen = !isTrashOpen;
  render({ force: true });
}

function renderTrashPanel() {
  const deletedTrades = getDeletedTrades();
  return `
      <section class="trash-panel" aria-label="Deleted trades">
        <div class="trash-panel-header">
          <h3>Trash${deletedTrades.length ? ` (${deletedTrades.length})` : ''}</h3>
          <button class="secondary-button" type="button" data-toggle-trash>← Back to Journal</button>
        </div>
        ${deletedTrades.length ? `
        <div class="trade-list trash-trade-list">
          ${deletedTrades.map(trashTradeRow).join('')}
        </div>` : '<p class="empty-state">Trash is empty.</p>'}
      </section>`;
}

function trashTradeRow(trade) {
  const pnl = calculatePnl(trade);
  const tone = getPerformanceTone(pnl);
  const dirLabel = String(trade.direction || '');
  const dirClass = dirLabel.toLowerCase();
  const dirArrow = dirClass === 'short' ? '▼' : '▲';
  return `
    <article class="trade-card trash-trade-card" data-trash-trade-card="${escapeHtml(trade.id)}">
      <div class="tc-hero">
        <div class="tc-hero-left">
          <span class="tc-direction ${dirClass}">${dirArrow} ${escapeHtml(dirLabel || 'Long')}</span>
          <p class="trade-symbol">${escapeHtml(getTradeDisplaySymbol(trade))}</p>
        </div>
        <strong class="trade-pnl-badge ${tone}" aria-label="P&L ${currency(pnl)}">${currency(pnl)}</strong>
      </div>
      <p class="trash-deleted-at">Deleted ${formatTradeTimestamp(trade.deletedAt) || ''}</p>
      <div class="trade-card-actions">
        <button class="secondary-button" type="button" data-restore-trade="${escapeHtml(trade.id)}">${icon('refresh')} Restore</button>
        <button class="icon-button" type="button" data-permanent-delete-trade="${escapeHtml(trade.id)}" aria-label="Permanently delete ${escapeHtml(getTradeDisplaySymbol(trade))} trade">
          ${icon('trash')} Delete Permanently
        </button>
      </div>
    </article>`;
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

function toggleManualTradeForm() {
  manualTradeDateKey = selectedCalendarDateKey || formatDateKey(new Date());
  isManualTradeFormOpen = !isManualTradeFormOpen;
  if (!isManualTradeFormOpen) {
    selectedScreenshot = null;
    pastedScreenshotFile = null;
  }
  // Same pattern as openTradeEdit()/closeTradeEdit(): actually clear the
  // Auto Sync interval timer while the lock is on (not just skip each
  // tick), and reschedule it the moment the lock releases.
  scheduleCTraderAutoSync();
  // force: true — isTradeEditLocked() now includes isManualTradeFormOpen,
  // so opening the form would otherwise immediately lock out its own
  // render() call and never appear on screen. Closing it (Cancel) also
  // releases the lock, letting Auto Sync resume right away.
  render({ force: true });
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

// Clears only the `screenshot` field (an inline data URL) from every trade,
// to reclaim browser storage space. All other trade fields — including
// Notes, Grade, Protected, Trade Management, Setup, State, and Tags — are
// left completely untouched, and no trade is removed. Screenshots are never
// synced to Supabase (see JOURNAL_ANNOTATION_FIELDS), so there is nothing to
// clear there.
function deleteAllScreenshots() {
  if (!window.confirm('Delete all screenshots? This cannot be undone.')) {
    return;
  }

  const deletedCount = trades.filter((trade) => trade?.screenshot?.dataUrl).length;
  const nextTrades = trades.map((trade) => (
    trade?.screenshot ? { ...trade, screenshot: null } : trade
  ));

  persistTrades(nextTrades);
  window.alert(`Deleted ${deletedCount} ${deletedCount === 1 ? 'screenshot' : 'screenshots'}.`);
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
    // Read from the Add Trade form's own Timeframe dropdown (rendered via
    // the same shared renderTimeframeSelect() used everywhere else, and
    // pre-selected to 1m — see renderManualTradeForm()), so the saved value
    // always matches exactly what the user saw/could change before Save.
    // '1m' fallback only guards a missing/blank field; it should never
    // actually be needed since the dropdown always has a value selected.
    // Existing/imported trades are untouched — this only runs when a
    // brand-new manual trade is created.
    timeframe: String(formData.get('timeframe') || '1m').trim(),
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
  // Release the Manual Trade edit lock before persisting: isTradeEditLocked()
  // includes isManualTradeFormOpen, so persistTrades()'s internal render()
  // call needs the lock already cleared here to actually redraw (showing
  // the saved trade and clearing the form), and Auto Sync can resume
  // immediately, satisfying "resume syncing right after Save."
  isManualTradeFormOpen = false;
  scheduleCTraderAutoSync();
  persistTrades([nextTrade, ...trades]);
}

// Reads one edit form's fields into the same { tradeId, journalingUpdates,
// screenshotUpdate } shape both the individual Save button (submitTradeEdit)
// and "Save All Changes" (saveAllEditedTrades) apply to `trades` — extracted
// so both paths compute identical updates and can never drift apart.
async function buildTradeEditUpdate(form) {
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
    state: String(formData.get('state')).trim(),
    timeframe: String(formData.get('timeframe')).trim(),
    protected: String(formData.get('protected')).trim(),
    tradeManagement: String(formData.get('tradeManagement')).trim(),
    grade: String(formData.get('grade')).trim(),
    outcomeOverride: String(formData.get('outcomeOverride')).trim(),
    // Tags is no longer editable from the edit form (removed per cleanup) —
    // omitted here entirely so the trade's existing tags value is preserved
    // unchanged by the { ...trade, ...journalingUpdates } spread below,
    // instead of being overwritten with the literal string "null".
    notes: String(formData.get('notes')).trim(),
    adjustedStopLoss,
    stopLoss: toOptionalNumber(formData.get('stopLoss')),
    takeProfit: toOptionalNumber(formData.get('takeProfit')),
    adjustedTakeProfit: toOptionalNumber(formData.get('adjustedTakeProfit')),
  };
  const resolvedScreenshot = screenshotDraft.removeScreenshot
    ? null
    : screenshotDraft.selectedScreenshot ?? await readScreenshot(uploadedScreenshot || screenshotDraft.pastedScreenshotFile);
  const screenshotUpdate = screenshotDraft.removeScreenshot || resolvedScreenshot
    ? { screenshot: resolvedScreenshot }
    : {};

  return { tradeId, journalingUpdates, screenshotUpdate };
}

async function submitTradeEdit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const { tradeId, journalingUpdates, screenshotUpdate } = await buildTradeEditUpdate(form);

  closeTradeEdit(tradeId);
  delete editScreenshotDrafts[tradeId];
  persistTrades(trades.map((trade) => (
    // Keep the existing cTrader execution payload first: ? { ...trade, ...journalingUpdates }
    String(trade.id) === String(tradeId)
      ? { ...trade, ...journalingUpdates, ...screenshotUpdate }
      : trade
  )), { preserveTradeId: tradeId, renderOptions: { force: true } });
  pushTradeAnnotationToCloud(tradeId, extractAnnotationFields(journalingUpdates));
}

// "Save All Changes": saves every card that actually has unsaved edits
// (dirtyTradeIds), reusing buildTradeEditUpdate so the result is identical
// to what clicking each card's own Save button would produce. Cards that
// are open but untouched (never marked dirty) are left exactly as they are
// — Save All only ever writes dirty cards, never merely-open ones.
async function saveAllEditedTrades() {
  const dirtyIds = [...dirtyTradeIds];
  if (!dirtyIds.length) {
    return;
  }

  const updates = [];
  for (const tradeId of dirtyIds) {
    const form = document.querySelector(`[data-edit-trade-form="${cssEscape(tradeId)}"]`);
    if (!form) {
      // Defensive: a dirty card's form should always exist (dirty is only
      // ever set from that exact form's own input/change listener), but if
      // it's somehow gone, skip it rather than lose or guess at its data.
      continue;
    }
    updates.push(await buildTradeEditUpdate(form));
  }

  if (!updates.length) {
    return;
  }

  const updatesByTradeId = new Map(updates.map((update) => [String(update.tradeId), update]));
  const nextTrades = trades.map((trade) => {
    const update = updatesByTradeId.get(String(trade.id));
    return update ? { ...trade, ...update.journalingUpdates, ...update.screenshotUpdate } : trade;
  });

  for (const tradeId of updatesByTradeId.keys()) {
    closeTradeEdit(tradeId);
    delete editScreenshotDrafts[tradeId];
  }

  // Same persist steps as persistTrades(), but forces the re-render
  // directly: other cards that were open-but-clean (not dirty, so not
  // saved/closed above) may still hold the edit lock, and a plain render()
  // would otherwise silently no-op and leave the just-saved cards showing
  // their stale edit forms.
  trades = normalizeTradeMarketStates(normalizeTradeSetups(nextTrades));
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
  render({ force: true });

  for (const [tradeId, update] of updatesByTradeId) {
    pushTradeAnnotationToCloud(tradeId, extractAnnotationFields(update.journalingUpdates));
  }
}

// Lightweight DOM update only — deliberately never calls render(). A full
// render() while any card is open would wipe every open card's uncontrolled
// <input> values (the same class of bug fixed for the Manual Trade form),
// so the Save All button's visibility is toggled directly on the element
// that's already in the DOM from the last full render instead.
function updateSaveAllButtonVisibility() {
  const button = document.querySelector('[data-save-all-trades]');
  if (button) {
    button.hidden = dirtyTradeIds.size === 0;
  }
  updateUnsavedChangesWarning();
}

function markTradeEditDirty(tradeId) {
  const key = String(tradeId);
  if (dirtyTradeIds.has(key)) {
    return;
  }
  dirtyTradeIds.add(key);
  updateSaveAllButtonVisibility();
}

// Warns before leaving/refreshing the page while any card has unsaved
// edits. The listener is only attached while it's actually needed (rather
// than left on permanently) so it never prompts when there's nothing to
// lose.
let isUnsavedChangesWarningActive = false;
function handleBeforeUnload(event) {
  event.preventDefault();
  event.returnValue = '';
  return '';
}
function updateUnsavedChangesWarning() {
  const shouldWarn = dirtyTradeIds.size > 0;
  if (shouldWarn === isUnsavedChangesWarningActive) {
    return;
  }
  isUnsavedChangesWarningActive = shouldWarn;
  if (shouldWarn) {
    window.addEventListener('beforeunload', handleBeforeUnload);
  } else {
    window.removeEventListener('beforeunload', handleBeforeUnload);
  }
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
  // Falls back to the single open card only when there's exactly one —
  // with multiple cards open at once there's no way to know which one a
  // focus-less paste was meant for, so it's left to fall through to the
  // page-level screenshot field below instead of guessing.
  const singleOpenTradeId = editingTradeIds.size === 1 ? [...editingTradeIds][0] : null;
  const editForm = document.activeElement?.closest?.('[data-edit-trade-form]')
    || (singleOpenTradeId ? document.querySelector(`[data-edit-trade-form="${cssEscape(singleOpenTradeId)}"]`) : null);
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
        <button class="secondary-button" type="button" id="deleteAllScreenshots">
          ${icon('trash')} Delete All Screenshots
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

// Trading Mode's "Daily Export": every trade dated today (same 'day' period
// filter used everywhere else — getTradeReportDate/filterTradesForPeriod —
// so this always matches what the Today KPI strip itself shows), plus the
// same daily summary getStats() computes for that strip. Every saved
// trade-card field is included via the { ...trade } spread (notes, tags,
// timeframe, setup, state, position, tradeManagement, protected, grade,
// etc.), plus the derived fields the card shows but doesn't store: outcome,
// pnl, and rMultiple. screenshot is replaced with a reference (name/type/
// size/attached) — the dataUrl (actual image bytes) is deliberately left
// out so the export stays small and shareable.
function exportDailyTrades() {
  const dateKey = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local date — same convention as openShareDashboardView's PNG filename
  const todayTrades = filterTradesForPeriod(getActiveTrades(), 'day', new Date());
  const summary = getStats(todayTrades);

  const sanitizedTrades = todayTrades.map((trade) => {
    const { screenshot, ...tradeWithoutScreenshot } = trade;
    const pnl = calculatePnl(trade);
    return {
      ...tradeWithoutScreenshot,
      screenshot: screenshot
        ? { attached: true, name: screenshot.name ?? null, type: screenshot.type ?? null, size: screenshot.size ?? null }
        : { attached: false },
      outcome: TRADE_OUTCOME_LABELS[classifyTradeOutcome(pnl, trade.outcomeOverride)] || '',
      pnl,
      rMultiple: calculateRMultiple(trade),
    };
  });

  const blob = new Blob([JSON.stringify({ date: dateKey, summary, trades: sanitizedTrades }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `DNA-Daily-Export-${dateKey}.json`;
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
      const existingCount = trades.length;
      const confirmed = window.confirm(
        `Import ${importedTrades.length} trade${importedTrades.length === 1 ? '' : 's'} from "${file.name}"?\n\nThis will replace your current ${existingCount} trade${existingCount === 1 ? '' : 's'}. This cannot be undone.`,
      );
      if (!confirmed) {
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
loadCloudAnnotationsAndMerge();

// Keep cross-device annotation edits in sync without polling: re-check the
// cloud whenever the user switches back to this tab or this window.
window.addEventListener('focus', () => {
  maybeRefreshCloudAnnotations();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    maybeRefreshCloudAnnotations();
  }
});
