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
  assertIncludes(source, "document.querySelector('#connectCTrader')?.addEventListener('click', startCTraderOAuthFlow);", 'The connect button is wired to the OAuth handler.');
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
  assertIncludes(source, 'const tradeDuration = formatTradeDuration(trade.openTime, trade.closeTime);', 'Trade cards calculate holding duration automatically from open and close times.');
  assertIncludes(source, '<span>Duration: ${escapeHtml(tradeDuration)}</span>', 'Every trade card has a visible duration field in its summary metadata.');
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
  assertIncludes(source, 'Last Sync Time', 'The UI shows the last cTrader sync time.');
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

test('cTrader production UI shows a user-facing connection summary instead of backend diagnostics', () => {
  assertIncludes(source, 'renderCTraderConnectionCard()', 'The hero renders one compact cTrader connection card near the account controls.');
  assertIncludes(source, 'cTrader</dt>', 'The summary displays whether cTrader is connected.');
  assertIncludes(source, 'Selected Account', 'The summary displays the selected cTrader account.');
  assertIncludes(source, 'Account Balance', 'The summary displays the selected account balance.');
  assertIncludes(source, 'Last Sync Time', 'The summary displays the last cTrader sync time.');
  assertIncludes(source, '!isCTraderConnected ? `<button class="connect-button"', 'The Connect cTrader button is only rendered while disconnected.');
  assertIncludes(source, 'describeCTraderConnectionStatus(status)', 'Connection state still comes from the existing backend status response.');
});

test('cTrader UI lets users select an account and syncs only that saved account', () => {
  assertIncludes(source, "const SELECTED_CTRADER_ACCOUNT_STORAGE_KEY = 'jeremy-trading-journal:ctrader-selected-account:v1';", 'The selected cTrader account is persisted in local storage.');
  assertIncludes(source, 'id="cTraderAccountSelect"', 'The compact cTrader card renders a cTrader account selector.');
  assertIncludes(source, 'id="cTraderAccountSelect"', 'The selector has a stable DOM id.');
  assertIncludes(source, 'formatCTraderAccountLabel(account)', 'Account options show a formatted account label.');
  assertIncludes(source, "return `${environment} ${numberLabel} (ID ${accountId})`;", 'Account labels include live/demo, account number, and account ID.');
  assertIncludes(source, "accounts.find((account) => account?.isLive === true) || accounts[0]", 'The frontend defaults to the first live cTrader account.');
  assertIncludes(source, "params.set('accountId', String(selectedCTraderAccountId));", 'The sync request passes the selected account ID to the backend.');
  assertIncludes(source, "String(trade?.accountId) === String(selectedCTraderAccountId)", 'The incremental sync cursor is scoped to the selected account.');
  assertIncludes(source, 'selectedAccount: getSelectedCTraderAccount() ?', 'Sync diagnostics keep logging the selected account metadata.');
  assertIncludes(source, 'dealsReturned: preview?.dealCount ?? previewTrades.length', 'Sync diagnostics keep logging deals returned.');
});


test('cTrader deleted source keys are persisted and used during sync', () => {
  assertIncludes(source, "const DELETED_CTRADER_SOURCE_KEYS_STORAGE_KEY = 'deletedCTraderSourceKeys';", 'Deleted cTrader source keys use the requested localStorage key.');
  assertIncludes(source, 'function loadDeletedCTraderSourceKeys()', 'Deleted cTrader source keys can be loaded before syncing.');
  assertIncludes(source, 'function rememberDeletedCTraderSourceKey(trade)', 'Single cTrader trade deletion persists its source key.');
  assertIncludes(source, 'const deletedTrade = getTradeById(button.dataset.deleteTrade);', 'Delete handlers identify the removed trade before filtering it out.');
  assertIncludes(source, 'rememberDeletedCTraderSourceKey(deletedTrade);', 'Delete handlers remember cTrader source keys before removing the trade.');
  assertIncludes(source, 'window.localStorage.setItem(DELETED_CTRADER_SOURCE_KEYS_STORAGE_KEY, JSON.stringify([...sourceKeys].sort()))', 'Deleted source keys are saved to localStorage.');
});

test('trade cards expose an edit flow for local journaling fields', () => {
  assertIncludes(source, 'data-edit-trade="${escapeHtml(trade.id)}"', 'Each trade card renders an Edit button tied to that trade ID.');
  assertIncludes(source, 'function editTradeForm(trade)', 'Editing renders a focused form on the selected trade card.');
  assertIncludes(source, 'data-edit-trade-form="${escapeHtml(trade.id)}"', 'The edit form keeps a stable trade ID for saving changes.');
  assertIncludes(source, "${field('Setup', renderPlayBookSetupSelect(trade))}", 'The edit form allows setup changes through the Play Book dropdown.');
  assertIncludes(source, 'const PLAY_BOOK_SETUP_OPTIONS = [', 'The Play Book setup dropdown has a fixed setup list.');
  assertIncludes(source, "'Elephant Bar'", 'The Play Book setup dropdown includes Elephant Bar.');
  assertIncludes(source, "const TREND_LINE_BREAK_SETUP = 'Trend Line Break';", 'The Play Book setup dropdown includes the corrected Trend Line Break setup.');
  assertIncludes(source, '  TREND_LINE_BREAK_SETUP,', 'The Play Book setup dropdown uses the corrected setup constant.');
  assert.ok(!source.includes("  'Trade Line Break',"), 'The Play Book setup dropdown no longer shows the misspelled setup label.');
  assertIncludes(source, "'Ride the 🐋'", 'The Play Book setup dropdown includes Ride the whale.');
  assertIncludes(source, "const CUSTOM_SETUP_OPTION = 'Custom';", 'The Play Book setup dropdown includes a Custom option.');
  assertIncludes(source, "const selectedSetup = isPlayBookSetup(currentSetup) ? currentSetup : CUSTOM_SETUP_OPTION;", 'Existing non-Play Book setup values open as Custom.');
  assertIncludes(source, "const customValue = selectedSetup === CUSTOM_SETUP_OPTION ? currentSetup : '';", 'Existing custom setup values are preserved in the custom setup input.');
  assert.ok(!source.includes("${field('Emotion'"), 'The edit form does not render an emotion field.');
  assertIncludes(source, "${field('Loss Reason', renderLossReasonSelect(trade))}", 'The edit form allows an optional loss reason selection.');
  assertIncludes(source, "${field('Close Reason', renderCloseReasonSelect(trade))}", 'The edit form allows an optional close reason selection.');
  assertIncludes(source, "${field('Tags', `<input name=\"tags\"", 'The edit form allows tag changes.');
  assertIncludes(source, "${field('Notes', `<textarea name=\"notes\"", 'The edit form allows notes changes.');
  assertIncludes(source, "form.addEventListener('submit', submitTradeEdit);", 'Edit forms are wired to the save handler.');
});



test('legacy Trade Line Break setup values migrate to Trend Line Break', () => {
  assertIncludes(source, "const LEGACY_TRADE_LINE_BREAK_SETUP = 'Trade Line Break';", 'The legacy setup name is retained only for migration.');
  assertIncludes(source, "return setup === LEGACY_TRADE_LINE_BREAK_SETUP ? TREND_LINE_BREAK_SETUP : setup;", 'Setup normalization renames only the legacy setup value.');
  assertIncludes(source, 'const shouldMigrateSavedTrades = hasLegacySetupName(parsedTrades);', 'Saved journal entries are checked for legacy setup names when loaded from localStorage.');
  assertIncludes(source, 'const migratedTrades = shouldMigrateSavedTrades ? normalizeTradeSetups(parsedTrades) : parsedTrades;', 'Saved journal entries are normalized when migration is needed.');
  assertIncludes(source, 'window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migratedTrades));', 'Migrated saved journal entries are written back to localStorage.');
  assertIncludes(source, 'trades = normalizeTradeSetups(nextTrades);', 'Imported and saved journal entries are normalized before persistence/export.');
  assertIncludes(source, "setup: normalizeSetupName(String(formData.get('setup')).trim()) || 'Uncategorized setup',", 'Manual entries typed with the legacy setup name are normalized.');
});

test('trade edit form changes stay local until the user saves', () => {
  assertIncludes(source, "button.addEventListener('click', removeEditScreenshot);", 'Removing an edit screenshot uses a local DOM update handler instead of re-rendering the form.');
  assertIncludes(source, 'function removeEditScreenshot(event)', 'Screenshot removal has a dedicated edit-session handler.');
  assertIncludes(source, 'updateEditScreenshotFieldPreview(tradeId);', 'Screenshot removal updates only the preview area, preserving scroll and cursor position.');
  assert.ok(!source.includes('data-remove-edit-screenshot]') || !source.includes('removeEditScreenshot;\n      });\n      render();'), 'Removing a screenshot during edit does not call render.');
  assertIncludes(source, 'customSetupInput.hidden = event.currentTarget.value !== CUSTOM_SETUP_OPTION;', 'Setup dropdown changes only reveal or hide the custom setup input locally.');
  assertIncludes(source, 'persistTrades(trades.map((trade) => (', 'Trade edit values are persisted only by the explicit save submit handler.');
});


test('trade edit mode locks rendering and Auto Sync until save or cancel', () => {
  assertIncludes(source, 'function isTradeEditLocked()', 'The frontend exposes a dedicated edit lock state.');
  assertIncludes(source, 'function openTradeEdit(tradeId)', 'Opening edit mode goes through a dedicated edit-state transition.');
  assertIncludes(source, 'renderTradeCardInPlace(tradeId);', 'Opening edit mode updates only the selected trade card instead of remounting the journal.');
  assertIncludes(source, 'function renderTradeCardInPlace(tradeId)', 'Edit renders replace only the selected trade card to keep the selected entry visible.');
  assertIncludes(source, 'currentTradeCard.outerHTML = tradeCard(trade);', 'The selected trade card is swapped in place without re-sorting or remounting the journal list.');
  assertIncludes(source, 'function renderPreservingTradePosition(tradeId, renderOptions = {})', 'Edit renders use a dedicated scroll-preserving render wrapper.');
  assertIncludes(source, 'restoreTradeScrollAnchor(tradeId, anchor);', 'Save renders restore the selected trade position after data-driven DOM replacement.');
  assertIncludes(source, 'if (isTradeEditLocked() && !options.force) {', 'Normal renders are skipped while a trade edit is open.');
  assertIncludes(source, 'if (!isCTraderAutoSyncEnabled || isTradeEditLocked()) {', 'Auto Sync timers are not scheduled during an edit session.');
  assertIncludes(source, `async function syncCTraderOnStartup() {\n  if (isTradeEditLocked()) {`, 'Startup and interval Auto Sync exits without UI updates during edit mode.');
  assertIncludes(source, 'function closeTradeEdit()', 'Save and cancel share a dedicated edit-state exit.');
  assertIncludes(source, `closeTradeEdit();\n  delete editScreenshotDrafts[tradeId];`, 'Saving closes the edit lock before persisting and re-rendering the final card.');
});

test('saving trade edits only updates journaling fields and preserves imported execution data', () => {
  assertIncludes(source, 'const journalingUpdates = {', 'The edit save handler creates a restricted journaling update object.');
  assertIncludes(source, "setup: getSetupFormValue(formData)", 'Saving edits updates setup from the dropdown or custom setup input.');
  assertIncludes(source, "if (setupChoice === CUSTOM_SETUP_OPTION)", 'Saving edits supports custom setup names.');
  assert.ok(!source.includes("formData.get('emotion')"), 'Saving edits does not update emotion.');
  assertIncludes(source, "lossReason: String(formData.get('lossReason')).trim()", 'Saving edits stores the selected loss reason.');
  assertIncludes(source, "const closeReason = String(formData.get('closeReason')).trim();", 'Saving edits stores the selected close reason.');
  assertIncludes(source, "tags: String(formData.get('tags')).trim()", 'Saving edits updates tags.');
  assertIncludes(source, "notes: String(formData.get('notes')).trim()", 'Saving edits updates notes.');
  assertIncludes(source, '? { ...trade, ...journalingUpdates }', 'Saving edits spreads the existing trade first, preserving cTrader fields not in the journaling update.');
  assertIncludes(source, 'persistTrades(trades.map((trade) => (', 'Saving edits persists the updated journal to localStorage through the existing storage path.');
  assertIncludes(source, 'Imported cTrader execution fields are read-only and will be preserved when journaling edits are saved.', 'The edit UI tells users imported cTrader execution fields remain read-only.');
});

test('loss reason dropdown is optional and only renders on trade cards when filled', () => {
  assertIncludes(source, 'const LOSS_REASON_OPTIONS = [', 'Loss reason options are centralized for the edit dropdown.');
  assertIncludes(source, "'Bad Entry'", 'Loss reason includes Bad Entry.');
  assertIncludes(source, "'Ignored Rules'", 'Loss reason includes Ignored Rules.');
  assert.ok(!source.includes("'News Event'"), 'Loss reason excludes News Event from selectable options.');
  assertIncludes(source, "'Good Trade, Normal Loss'", 'Loss reason includes Good Trade, Normal Loss.');
  assertIncludes(source, "'Stop Too Tight'", 'Loss reason includes Stop Too Tight.');
  assertIncludes(source, 'const legacyLossReasonOption = currentLossReason && !LOSS_REASON_OPTIONS.includes(currentLossReason)', 'Loss reason dropdown preserves legacy saved values that are no longer selectable for new trades.');
  assert.ok(!source.includes("'Entered Too Late'"), 'Loss reason excludes removed detailed timing options.');
  assertIncludes(source, '<option value="">No loss reason</option>', 'Loss reason can be left blank for existing or winning trades.');
  assertIncludes(source, '${trade.lossReason ? `<p class="loss-reason"><strong>Loss Reason:</strong> ${escapeHtml(trade.lossReason)}</p>` : \'\'}', 'Trade cards only show loss reason when a saved value exists.');
});


test('close reason dropdown is optional and only renders on trade cards when filled', () => {
  assertIncludes(source, 'const CLOSE_REASON_OPTIONS = [', 'Close reason options are centralized for the edit dropdown.');
  assertIncludes(source, "'Take Profit'", 'Close reason includes Take Profit.');
  assertIncludes(source, "'Stop Loss'", 'Close reason includes Stop Loss.');
  assertIncludes(source, "'Trailed Stop'", 'Close reason includes Trailed Stop.');
  assertIncludes(source, "'Trend Change'", 'Close reason includes Trend Change.');
  assertIncludes(source, "'Manual Close'", 'Close reason includes Manual Close.');
  assertIncludes(source, "'Break Even'", 'Close reason includes Break Even.');
  assertIncludes(source, "'Closed Too Early'", 'Close reason includes Closed Too Early.');
  assertIncludes(source, "'Secured Profit Early'", 'Close reason includes Secured Profit Early.');
  assertIncludes(source, "const CLOSE_REASON_OPTIONS = [\n  'Break Even',\n  'Closed Too Early',\n  'Manual Close',\n  'Other',\n  'Secured Profit Early',\n  'Stop Loss',\n  'Take Profit',\n  'Trailed Stop',\n  'Trend Change',\n];", 'Close reason options remain alphabetized.');
  assertIncludes(source, '<option value="">No close reason</option>', 'Close reason can be left blank for existing trades.');
  assertIncludes(source, '${trade.closeReason ? `<p class="close-reason"><strong>Close Reason:</strong> ${escapeHtml(trade.closeReason)}</p>` : \'\'}', 'Trade cards only show close reason when a saved value exists.');
});

test('imported cTrader edit flow supports screenshot attachments', () => {
  assertIncludes(source, 'input name="editScreenshot" type="file" accept="image/*"', 'Imported trade edit forms accept image uploads.');
  assertIncludes(source, 'data-edit-screenshot-preview="${escapeHtml(trade.id)}"', 'Imported trade edit forms render a screenshot preview target.');
  assertIncludes(source, 'data-remove-edit-screenshot="${escapeHtml(trade.id)}"', 'Imported trade edit forms expose screenshot removal.');
  assertIncludes(source, 'input.addEventListener(\'change\', changeEditScreenshot);', 'Imported trade screenshot uploads use the existing image reader path.');
  assertIncludes(source, 'editScreenshotDrafts = {', 'Imported trade screenshot edits are tracked as local drafts until the trade edit is saved.');
  assertIncludes(source, 'setFileInputFile(editForm.querySelector(\'input[name="editScreenshot"]\'), file);', 'Pasted screenshots target the active imported trade edit form.');
  assertIncludes(source, 'screenshotLink(currentScreenshot, `${getTradeDisplaySymbol(trade)} trade screenshot`)', 'Imported trade edit previews reuse the manual screenshot link renderer.');
  assertIncludes(source, 'screenshotUpdate', 'Saving imported trade edits preserves execution data while adding, replacing, or removing screenshots.');
});
