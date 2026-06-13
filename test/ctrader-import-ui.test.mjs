import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const syncSource = await readFile(new URL('../src/ctrader-sync.js', import.meta.url), 'utf8');

function assertIncludes(text, expected, message) {
  assert.ok(text.includes(expected), `${message}\nExpected to find: ${expected}`);
}

test('cTrader sync button calls the journal preview API', () => {
  assertIncludes(source, 'id="syncCTrader"', 'The hero actions render a Sync cTrader button.');
  assertIncludes(source, "document.querySelector('#syncCTrader').addEventListener('click', () => syncCTrader({ source: 'manual' }));", 'The cTrader sync button is wired to the sync handler.');
  assertIncludes(source, 'fetchBackendJson(CTRADER_ENDPOINTS.journalPreview)', 'The sync handler automatically fetches newly closed cTrader journal preview trades from the API.');
  assertIncludes(source, 'Sync cTrader', 'The button copy uses the one-click synchronization language.');
});

test('cTrader connect button starts OAuth on the Render backend and checks status after return', () => {
  assertIncludes(source, 'id="connectCTrader"', 'The hero actions render a visible Connect cTrader button.');
  assertIncludes(source, 'Connect cTrader', 'The button copy clearly starts cTrader connection.');
  assertIncludes(source, "document.querySelector('#connectCTrader').addEventListener('click', startCTraderOAuthFlow);", 'The connect button is wired to the OAuth handler.');
  assertIncludes(source, 'buildCTraderOAuthUrl(CTRADER_ENDPOINTS.authStart)', 'The OAuth handler uses the Render auth start URL builder.');
  assertIncludes(source, "authStartUrl.searchParams.set('returnTo', getCTraderOAuthReturnUrl());", 'The OAuth handler asks the backend to return to the frontend after authorization.');
  assertIncludes(source, "currentUrl.searchParams.get('ctrader') !== 'connected'", 'The frontend detects the OAuth return flag.');
  assertIncludes(source, 'Authorization complete. Checking cTrader connection status...', 'The frontend displays status after authorization.');
});

test('cTrader preview trades are converted into saved journal entries', () => {
  assertIncludes(syncSource, 'function convertCTraderPreviewTradeToJournalEntry(previewTrade, options = {})', 'Preview trades are converted before saving.');
  assertIncludes(syncSource, "setup: previewTrade.setup === 'cTrader import preview' ? 'cTrader import'", 'Preview-only setup copy is replaced with journal entry copy.');
  assertIncludes(syncSource, 'tags: normalizeImportedTags(previewTrade.tags)', 'Imported entries normalize preview tags.');
  assertIncludes(syncSource, 'importedAt: getImportedAt(options)', 'Imported entries record when they were saved locally.');
  assertIncludes(source, 'persistTrades([...syncPlan.importedTrades, ...trades])', 'Imported trades are saved to the existing local journal storage path.');
});

test('cTrader sync skips duplicates by source trade IDs and reports imported/skipped counts', () => {
  assertIncludes(syncSource, 'sourceTradeId,', 'Imported entries retain a source trade ID.');
  assertIncludes(syncSource, 'export function hasSourceTradeAlreadyBeenImported(candidateTrade, existingTrades)', 'Duplicate detection checks imported trades against existing journal entries.');
  assertIncludes(syncSource, 'return sourceTradeId === null ? null : `ctrader:${sourceTradeId}`;', 'Duplicate detection keys cTrader trades by source trade ID.');
  assertIncludes(syncSource, 'const seenSourceKeys = new Set();', 'The sync tracks source trade IDs seen in the current preview response.');
  assertIncludes(source, 'const syncPlan = buildCTraderSyncPlan(previewTrades, trades);', 'Duplicate source trades are filtered out before saving.');
  assertIncludes(source, 'New trades imported: ${syncPlan.importedCount}. Trades skipped: ${syncPlan.skippedCount}.', 'The UI displays new imported and skipped cTrader trade counts.');
});

test('cTrader Auto Sync runs on startup and exposes settings metadata', () => {
  assertIncludes(source, "const AUTO_SYNC_STORAGE_KEY = 'jeremy-trading-journal:ctrader-auto-sync:v1';", 'Auto Sync preference is persisted separately from trades.');
  assertIncludes(source, "const LAST_SYNC_STORAGE_KEY = 'jeremy-trading-journal:ctrader-last-sync:v1';", 'Last sync time is persisted separately from trades.');
  assertIncludes(source, 'id="autoSyncCTrader"', 'The hero actions render an Auto Sync checkbox.');
  assertIncludes(source, "document.querySelector('#autoSyncCTrader').addEventListener('change', changeCTraderAutoSyncSetting);", 'The Auto Sync checkbox updates the saved preference.');
  assertIncludes(source, 'fetchBackendJson(CTRADER_ENDPOINTS.status)', 'Startup Auto Sync checks cTrader connection status before syncing trades.');
  assertIncludes(source, "syncCTrader({ source: 'auto' })", 'Startup Auto Sync imports new cTrader trades without pressing Sync.');
  assertIncludes(source, 'Last cTrader sync:', 'The UI shows the last cTrader sync time.');
  assertIncludes(source, 'syncCTraderOnStartup();', 'The app starts Auto Sync after the first render.');
});

test('cTrader Auto Sync keeps syncing while the app is open', () => {
  assertIncludes(source, 'const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;', 'Auto Sync uses a defined repeat interval.');
  assertIncludes(source, 'let cTraderAutoSyncTimer = null;', 'The app tracks the active Auto Sync timer.');
  assertIncludes(source, 'function scheduleCTraderAutoSync()', 'Auto Sync can schedule recurring sync checks.');
  assertIncludes(source, 'clearInterval(cTraderAutoSyncTimer);', 'Changing Auto Sync clears the previous timer to avoid duplicate polling.');
  assertIncludes(source, 'window.setInterval(() => {', 'Auto Sync repeats without requiring the user to press Sync.');
  assertIncludes(source, 'scheduleCTraderAutoSync();', 'The app schedules Auto Sync during startup and preference changes.');
});

test('cTrader backend diagnostics show backend URL and connection status', () => {
  assertIncludes(source, 'renderCTraderBackendDiagnostics()', 'The hero renders backend diagnostics near the cTrader controls.');
  assertIncludes(source, 'Backend URL', 'The diagnostics display the backend URL used by fetch calls.');
  assertIncludes(source, 'Status check URL', 'The diagnostics display the exact status endpoint being checked.');
  assertIncludes(source, 'Connection status', 'The diagnostics display the current backend/cTrader connection state.');
  assertIncludes(source, 'describeCTraderConnectionStatus(status)', 'The connection status is derived from the backend status response.');
});
