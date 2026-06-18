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
  assertIncludes(source, 'fetchBackendJson(syncRequestPath)', 'The sync handler fetches newly closed cTrader journal preview trades with a dynamic request path.');
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
  assertIncludes(source, 'persistTrades([...syncPlan.importedTrades, ...updatedExistingTrades.trades])', 'Imported trades are saved to the existing local journal storage path.');
  assertIncludes(source, 'applyCTraderImportedTradeUpdates(trades, syncPlan.skippedTrades)', 'Skipped duplicate imports refresh stale local cTrader symbols.');
});

test('trade cards show clean details without emotion', () => {
  assertIncludes(source, '<p class="trade-symbol">${escapeHtml(displaySymbol)}</p>', 'Trade cards display the resolved broker symbol at the top of the card.');
  assertIncludes(source, 'function getTradeDisplaySymbol(trade)', 'Trade cards resolve stored broker symbols before rendering cTrader imports.');
  assertIncludes(source, 'trade.brokerSymbol,', 'Numeric cTrader symbol IDs in stored imports are bypassed when broker symbols are available.');
  assertIncludes(source, 'const importedNetProfitLoss = toOptionalNumber(trade.netProfitLoss);', 'Imported cTrader P/L uses the cTrader net profit/loss field instead of recalculating from journal size.');
  assertIncludes(source, 'if (isCTraderImportedTrade(trade) && importedNetProfitLoss !== null) {', 'Only cTrader imported trades prefer the broker-provided P/L value.');
  assertIncludes(source, "const importedTimeDetail = cTraderTimeDetails(trade);", 'cTrader imported trade cards render cTrader time details.');
  assertIncludes(source, 'function formatTradeTimestamp(value)', 'Imported cTrader timestamps are formatted in the browser local time zone.');
  assertIncludes(source, 'timestamp.toLocaleString([], {', 'Imported cTrader timestamps use local browser formatting.');
  assertIncludes(source, 'function formatTradeDuration(openTime, closeTime)', 'Imported cTrader open and close timestamps are used to calculate duration.');
  assertIncludes(source, '<span>Opened: ${escapeHtml(formatTradeTimestamp(trade.openTime))}</span>', 'Imported trade cards show the cTrader open time.');
  assertIncludes(source, '<span>Closed: ${escapeHtml(formatTradeTimestamp(trade.closeTime))}</span>', 'Imported trade cards show the cTrader close time.');
  assertIncludes(source, '<span>Duration: ${escapeHtml(formatTradeDuration(trade.openTime, trade.closeTime))}</span>', 'Imported trade cards show the trade duration.');
  assert.ok(!source.includes('Emotion:'), 'Trade cards do not display emotion details.');
  assertIncludes(source, "return trade?.provider === 'ctrader' || String(trade?.tags || '').toLowerCase().includes('ctrader');", 'The card cleanup only targets cTrader imports.');
});

test('cTrader sync skips duplicates by source trade IDs and reports imported/skipped counts', () => {
  assertIncludes(syncSource, 'sourceTradeId,', 'Imported entries retain a source trade ID.');
  assertIncludes(syncSource, 'export function hasSourceTradeAlreadyBeenImported(candidateTrade, existingTrades)', 'Duplicate detection checks imported trades against existing journal entries.');
  assertIncludes(syncSource, 'return sourceTradeId === null ? null : `ctrader:${sourceTradeId}`;', 'Duplicate detection keys cTrader trades by source trade ID.');
  assertIncludes(syncSource, 'const seenSourceKeys = new Set();', 'The sync tracks source trade IDs seen in the current preview response.');
  assertIncludes(source, 'const syncPlan = buildCTraderSyncPlan(previewTrades, trades, {', 'Duplicate and deleted source trades are filtered out before saving.');
  assertIncludes(source, 'deletedSourceKeys: loadDeletedCTraderSourceKeys(),', 'Deleted cTrader source keys are passed into the sync planner.');
  assertIncludes(source, 'New trades imported: ${syncPlan.importedCount}. Trades skipped: ${syncPlan.skippedCount}.', 'The UI displays new imported and skipped cTrader trade counts.');
});


test('cTrader imports can be bulk deleted without removing manual trades', () => {
  assertIncludes(source, 'id="deleteAllCTraderImports"', 'The hero actions render a Delete All cTrader Imports button.');
  assertIncludes(source, 'Delete All cTrader Imports', 'The delete button uses the requested label.');
  assertIncludes(source, "document.querySelector('#deleteAllCTraderImports').addEventListener('click', deleteAllCTraderImports);", 'The delete button is wired to its handler.');
  assertIncludes(source, "window.confirm('Delete all imported cTrader trades?')", 'The handler asks for the requested confirmation before deleting.');
  assertIncludes(source, "trades.filter((trade) => trade?.provider !== 'ctrader')", 'Only provider-marked cTrader imports are removed so manual trades remain.');
  assertIncludes(source, 'rememberDeletedCTraderSourceKeys(deletedTrades);', 'Bulk deleting cTrader imports saves their source keys.');
  assertIncludes(source, 'They will not be re-imported on future syncs.', 'The status explains deleted cTrader imports stay deleted.');
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
  assertIncludes(source, 'const AUTO_SYNC_INTERVAL_MS = 60 * 1000;', 'Auto Sync polls within 60 seconds.');
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

test('cTrader UI lets users select an account and syncs only that saved account', () => {
  assertIncludes(source, "const SELECTED_CTRADER_ACCOUNT_STORAGE_KEY = 'jeremy-trading-journal:ctrader-selected-account:v1';", 'The selected cTrader account is persisted in local storage.');
  assertIncludes(source, 'renderCTraderAccountSelector()', 'The hero renders a cTrader account selector.');
  assertIncludes(source, 'id="cTraderAccountSelect"', 'The selector has a stable DOM id.');
  assertIncludes(source, 'formatCTraderAccountLabel(account)', 'Account options show a formatted account label.');
  assertIncludes(source, "return `${environment} ${numberLabel} (ID ${accountId})`;", 'Account labels include live/demo, account number, and account ID.');
  assertIncludes(source, "accounts.find((account) => account?.isLive === true) || accounts[0]", 'The frontend defaults to the first live cTrader account.');
  assertIncludes(source, "params.set('accountId', String(selectedCTraderAccountId));", 'The sync request passes the selected account ID to the backend.');
  assertIncludes(source, "String(trade?.accountId) === String(selectedCTraderAccountId)", 'The incremental sync cursor is scoped to the selected account.');
  assertIncludes(source, 'getSelectedCTraderAccountStatusLabel()', 'The selected account appears beside cTrader connection status.');
  assertIncludes(source, 'selectedAccount: getSelectedCTraderAccount() ?', 'Sync diagnostics keep logging the selected account metadata.');
  assertIncludes(source, 'dealsReturned: preview?.dealCount ?? previewTrades.length', 'Sync diagnostics keep logging deals returned.');
});


test('cTrader deleted source keys are persisted and used during sync', () => {
  assertIncludes(source, "const DELETED_CTRADER_SOURCE_KEYS_STORAGE_KEY = 'deletedCTraderSourceKeys';", 'Deleted cTrader source keys use the requested localStorage key.');
  assertIncludes(source, 'function loadDeletedCTraderSourceKeys()', 'Deleted cTrader source keys can be loaded before syncing.');
  assertIncludes(source, 'function rememberDeletedCTraderSourceKey(trade)', 'Single cTrader trade deletion persists its source key.');
  assertIncludes(source, 'const deletedTrade = trades.find((trade) => trade.id === button.dataset.deleteTrade);', 'Delete handlers identify the removed trade before filtering it out.');
  assertIncludes(source, 'rememberDeletedCTraderSourceKey(deletedTrade);', 'Delete handlers remember cTrader source keys before removing the trade.');
  assertIncludes(source, 'window.localStorage.setItem(DELETED_CTRADER_SOURCE_KEYS_STORAGE_KEY, JSON.stringify([...sourceKeys].sort()))', 'Deleted source keys are saved to localStorage.');
});

test('trade cards expose an edit flow for local journaling fields', () => {
  assertIncludes(source, 'data-edit-trade="${escapeHtml(trade.id)}"', 'Each trade card renders an Edit button tied to that trade ID.');
  assertIncludes(source, 'function editTradeForm(trade)', 'Editing renders a focused form on the selected trade card.');
  assertIncludes(source, 'data-edit-trade-form="${escapeHtml(trade.id)}"', 'The edit form keeps a stable trade ID for saving changes.');
  assertIncludes(source, "${field('Setup', `<input name=\"setup\"", 'The edit form allows setup changes.');
  assert.ok(!source.includes("${field('Emotion'"), 'The edit form does not render an emotion field.');
  assertIncludes(source, "${field('Tags', `<input name=\"tags\"", 'The edit form allows tag changes.');
  assertIncludes(source, "${field('Notes', `<textarea name=\"notes\"", 'The edit form allows notes changes.');
  assertIncludes(source, "form.addEventListener('submit', submitTradeEdit);", 'Edit forms are wired to the save handler.');
});

test('saving trade edits only updates journaling fields and preserves imported execution data', () => {
  assertIncludes(source, 'const journalingUpdates = {', 'The edit save handler creates a restricted journaling update object.');
  assertIncludes(source, "setup: String(formData.get('setup')).trim() || 'Uncategorized setup'", 'Saving edits updates setup.');
  assert.ok(!source.includes("formData.get('emotion')"), 'Saving edits does not update emotion.');
  assertIncludes(source, "tags: String(formData.get('tags')).trim()", 'Saving edits updates tags.');
  assertIncludes(source, "notes: String(formData.get('notes')).trim()", 'Saving edits updates notes.');
  assertIncludes(source, '? { ...trade, ...journalingUpdates }', 'Saving edits spreads the existing trade first, preserving cTrader fields not in the journaling update.');
  assertIncludes(source, 'persistTrades(trades.map((trade) => (', 'Saving edits persists the updated journal to localStorage through the existing storage path.');
  assertIncludes(source, 'Imported cTrader execution fields are read-only and will be preserved when journaling edits are saved.', 'The edit UI tells users imported cTrader execution fields remain read-only.');
});
