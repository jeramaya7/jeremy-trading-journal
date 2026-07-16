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
  assertIncludes(syncSource, "setup: '',", 'Imported entries leave saved journal setup blank by default.');
  assertIncludes(syncSource, "tags: '',", 'Imported entries leave saved journal tags blank by default.');
  assertIncludes(syncSource, "notes: '',", 'Imported entries leave saved journal notes blank by default.');
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
  assertIncludes(syncSource, '? `ctrader:${sourceTradeId}`', 'Duplicate detection keys cTrader trades by source trade ID.');
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
  assertIncludes(source, 'clearDeletedCTraderSourceKeys();', 'Bulk deleting cTrader imports clears deleted source keys so they can be synced again.');
  assertIncludes(source, 'Sync cTrader to import them again.', 'The status explains deleted cTrader imports can be re-imported.');
  assert.ok(!source.includes('They will not be re-imported on future syncs.'), 'The bulk delete status no longer says cTrader imports stay deleted.');
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
  assertIncludes(source, 'function clearDeletedCTraderSourceKeys()', 'Bulk deletion can clear deleted cTrader source keys before the next sync.');
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
  assertIncludes(source, "'Event Bar'", 'The Play Book setup dropdown includes Event Bar.');
  assertIncludes(source, "'Trendline Break'", 'The Play Book setup dropdown includes Trendline Break.');
  assert.ok(!source.includes("  'Trade Line Break',"), 'The Play Book setup dropdown no longer shows the misspelled setup label.');
  assert.ok(!source.includes("'Elephant Bar',") , 'The retired Elephant Bar label is no longer a selectable Play Book option (migrated to Event Bar instead).');
  assert.ok(!source.includes("'Ride the 🐋',"), 'Ride the whale is retired from the Play Book dropdown.');
  assert.ok(!source.includes('>None</option>\n      ${PLAY_BOOK_SETUP_OPTIONS'), 'The Play Book setup dropdown no longer offers a None option.');

  // Cleanup: the free-text "Setup Description" / custom setup input is
  // fully removed from the Setup dropdown's own markup. Legacy non-Play-Book
  // setup values are preserved as their own selectable option instead (see
  // setup-name-migration.test.mjs for the dedicated coverage). Note:
  // getSetupFormValue() still legitimately reads formData.get('setupCustom')
  // — that's shared, tested logic left untouched, just unreachable from the
  // real form now — so this check is scoped to renderPlayBookSetupSelect
  // only, not the whole file.
  const setupSelectStart = source.indexOf('function renderPlayBookSetupSelect(trade)');
  const setupSelectEnd = source.indexOf('\nfunction ', setupSelectStart + 1);
  const setupSelectBody = source.slice(setupSelectStart, setupSelectEnd);
  assert.equal(setupSelectBody.includes('setupCustom'), false, 'The Setup dropdown should no longer render a free-text custom setup input.');
  assert.equal(setupSelectBody.includes('data-custom-setup'), false, 'The custom setup input hook should be fully removed.');

  // Cleanup: Tags is fully removed from the edit form (still present on
  // the manual "Add Trade" panel, which is a different form).
  assert.equal(source.includes("${field('Tags', `<input name=\"tags\""), false, 'The edit form should no longer render a Tags field.');

  assert.ok(!source.includes("${field('Emotion'"), 'The edit form does not render an emotion field.');
  assertIncludes(source, "${field('Notes', `<textarea name=\"notes\"", 'The edit form allows notes changes.');
  assertIncludes(source, "form.addEventListener('submit', submitTradeEdit);", 'Edit forms are wired to the save handler.');

  // Reorganized into four labeled sections: Trade Plan, Setup, Trade
  // Review, Journal — verify both the headings and their relative order.
  const editFormStart = source.indexOf('function editTradeForm(trade)');
  const editFormEnd = source.indexOf('\nfunction ', editFormStart + 1);
  const editFormBody = source.slice(editFormStart, editFormEnd);
  ['Trade Plan', 'Setup', 'Trade Review', 'Journal'].forEach((label) => {
    assertIncludes(editFormBody, `<h4 class="edit-form-section-label">${label}</h4>`, `The edit form should have a "${label}" section heading.`);
  });
  const tradePlanIndex = editFormBody.indexOf('<h4 class="edit-form-section-label">Trade Plan</h4>');
  const setupIndex = editFormBody.indexOf('<h4 class="edit-form-section-label">Setup</h4>');
  const reviewIndex = editFormBody.indexOf('<h4 class="edit-form-section-label">Trade Review</h4>');
  const journalIndex = editFormBody.indexOf('<h4 class="edit-form-section-label">Journal</h4>');
  assert.ok(
    tradePlanIndex < setupIndex && setupIndex < reviewIndex && reviewIndex < journalIndex,
    'Edit form sections should render in order: Trade Plan, Setup, Trade Review, Journal.',
  );

  // Trade Plan: Entry/Exit/Initial SL/Final SL/Initial TP/Final TP, values
  // unchanged from before this reorganization.
  const tradePlanBody = editFormBody.slice(tradePlanIndex, setupIndex);
  assertIncludes(tradePlanBody, `<input name="entry" type="number" value="\${escapeHtml(trade.entry)}" readonly />`, 'Entry Price stays auto-populated and read-only.');
  assertIncludes(tradePlanBody, `<input name="exit" type="number" value="\${escapeHtml(trade.exit)}" readonly />`, 'Exit Price stays auto-populated and read-only.');
  assertIncludes(tradePlanBody, `<input name="stopLoss" type="number" value="\${escapeHtml(trade.stopLoss ?? '')}" readonly />`, 'Initial Stop Loss stays auto-populated and read-only.');
  assertIncludes(tradePlanBody, `<input name="adjustedStopLoss" type="number" min="0" step="0.01" value="\${escapeHtml(trade.adjustedStopLoss ?? '')}" placeholder="Optional" />`, 'Final Stop Loss stays auto-populated.');
  assertIncludes(tradePlanBody, `<input name="takeProfit" type="number" min="0" step="0.01" value="\${escapeHtml(trade.takeProfit ?? '')}" placeholder="Optional" />`, 'Initial Take Profit stays auto-populated.');
  assertIncludes(tradePlanBody, `<input name="adjustedTakeProfit" type="number" min="0" step="0.01" value="\${escapeHtml(trade.adjustedTakeProfit ?? '')}" placeholder="Optional" />`, 'Final Take Profit stays auto-populated.');

  // Setup section: Setup, Position, State, Timeframe — keeping the exact
  // "Position" and "State" names (not renamed).
  const setupBody = editFormBody.slice(setupIndex, reviewIndex);
  assertIncludes(setupBody, "${field('Position', renderPositionTypeSelect(trade))}", 'Position keeps its name.');
  assertIncludes(setupBody, "${field('State', renderMarketStateSelect(trade))}", 'State keeps its name.');
  assertIncludes(setupBody, "${field('Timeframe', renderTimeframeSelect(trade))}", 'Timeframe is in the Setup section.');

  // Trade Review section: Trade Management, Protected, Exit Reason, Grade,
  // and Loss Reason (present in the DOM but hidden unless the trade is a
  // Loss, so its value still round-trips through the save handler).
  const reviewBody = editFormBody.slice(reviewIndex, journalIndex);
  assertIncludes(reviewBody, "${field('Trade Management', renderTradeManagementSelect(trade))}", 'Trade Management is in Trade Review.');
  assertIncludes(reviewBody, "${field('Protected', renderProtectedSelect(trade))}", 'Protected is in Trade Review.');
  assertIncludes(reviewBody, "${field('Exit Reason', renderCloseReasonSelect(trade))}", 'Exit Reason is in Trade Review.');
  assertIncludes(reviewBody, "${field('Grade', renderGradeSelect(trade))}", 'Grade is in Trade Review.');
  assertIncludes(reviewBody, "${field('Loss Reason', renderLossReasonSelect(trade))}", 'Loss Reason is in Trade Review.');
  assertIncludes(reviewBody, "class=\"edit-loss-reason-field\"${isLossOutcome ? '' : ' hidden'}", 'Loss Reason is only visible when the trade outcome is a Loss.');
  assertIncludes(editFormBody, "const isLossOutcome = classifyTradeOutcome(calculatePnl(trade)) === 'loss';", 'Loss outcome uses the shared classifier, matching the trade card\'s own Win/Loss/Breakeven label.');

  // Journal section: Notes and Screenshot only (Tags removed).
  const journalBody = editFormBody.slice(journalIndex);
  assertIncludes(journalBody, "${field('Notes',", 'Notes is in the Journal section.');
  assertIncludes(journalBody, 'Screenshot Attachment', 'Screenshot is in the Journal section.');
});



test('legacy setup names migrate to their current canonical name', () => {
  // Generalized from a single Trade Line Break -> Trend Line Break pair
  // into a full old-name -> new-name map so every retired/renamed Play
  // Book setup (Elephant Bar, Buy the Retrace, MATX, MAX, Return to 200,
  // Trend/Trade Line Break, Support & Resistance, The General Forecast)
  // migrates the same way, wherever a setup is displayed, edited,
  // filtered, analyzed, or reported.
  assertIncludes(source, 'const LEGACY_SETUP_NAME_MAP = {', 'Legacy setup names are retained only for migration, in one shared map.');
  assertIncludes(source, "'Trade Line Break': 'Trendline Break',", 'The old misspelled Trade Line Break value migrates to Trendline Break.');
  assertIncludes(source, "'Trend Line Break': 'Trendline Break',", 'The old Trend Line Break value migrates to Trendline Break.');
  assertIncludes(source, "'Elephant Bar': 'Event Bar',", 'Elephant Bar migrates to Event Bar.');
  assertIncludes(source, "'Buy the Retrace': 'Enter Retrace',", 'Buy the Retrace migrates to Enter Retrace.');
  assertIncludes(source, "'MATX': 'EMA Cross',", 'MATX migrates to EMA Cross.');
  assertIncludes(source, "'MAX': 'EMA Cross',", 'MAX migrates to EMA Cross.');
  assertIncludes(source, "'Return to 200': 'Wide State Reversal',", 'Return to 200 migrates to Wide State Reversal.');
  assertIncludes(source, "'Support & Resistance': 'Support/Resistance',", 'Support & Resistance migrates to Support/Resistance.');
  assertIncludes(source, "'The General Forecast': 'General Forecast',", 'The General Forecast migrates to General Forecast.');
  assert.ok(!source.includes("'Scalp': "), 'Scalp is deliberately left unmigrated (falls back to Custom), per product decision.');

  assertIncludes(source, 'function normalizeSetupName(setup) {', 'Setup normalization is a single shared function.');
  assertIncludes(source, 'return Object.prototype.hasOwnProperty.call(LEGACY_SETUP_NAME_MAP, setup) ? LEGACY_SETUP_NAME_MAP[setup] : setup;', 'Setup normalization looks up the shared legacy map instead of a single hardcoded pair.');
  assertIncludes(source, 'const shouldMigrateSavedTrades = hasLegacySetupName(parsedTrades);', 'Saved journal entries are checked for legacy setup names when loaded from localStorage.');
  assertIncludes(source, 'const migratedTrades = shouldMigrateSavedTrades ? normalizeTradeSetups(parsedTrades) : parsedTrades;', 'Saved journal entries are normalized when migration is needed.');
  assertIncludes(source, 'window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migratedTrades));', 'Migrated saved journal entries are written back to localStorage.');
  assertIncludes(source, 'trades = normalizeTradeSetups(nextTrades);', 'Imported and saved journal entries are normalized before persistence/export.');
  assertIncludes(source, "setup: normalizeSetupName(String(formData.get('setup')).trim()) || 'Uncategorized setup',", 'Manual entries typed with a legacy setup name are normalized.');
});

test('trade edit form changes stay local until the user saves', () => {
  assertIncludes(source, "button.addEventListener('click', removeEditScreenshot);", 'Removing an edit screenshot uses a local DOM update handler instead of re-rendering the form.');
  assertIncludes(source, 'function removeEditScreenshot(event)', 'Screenshot removal has a dedicated edit-session handler.');
  assertIncludes(source, 'updateEditScreenshotFieldPreview(tradeId);', 'Screenshot removal updates only the preview area, preserving scroll and cursor position.');
  assert.ok(!source.includes('data-remove-edit-screenshot]') || !source.includes('removeEditScreenshot;\n      });\n      render();'), 'Removing a screenshot during edit does not call render.');
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
  assertIncludes(source, "notes: String(formData.get('notes')).trim()", 'Saving edits updates notes.');

  // Tags was removed from the edit form. journalingUpdates (scoped to just
  // the object literal, not the whole file — the separate manual "Add
  // Trade" form still legitimately reads formData.get('tags')) must not
  // read a tags field at all: with no such field in the edit form, that
  // would return null, and String(null).trim() would save the literal
  // string "null" over the trade's existing tags on every edit.
  const journalingUpdatesStart = source.indexOf('const journalingUpdates = {');
  const journalingUpdatesEnd = source.indexOf('\n  };', journalingUpdatesStart);
  const journalingUpdatesBody = source.slice(journalingUpdatesStart, journalingUpdatesEnd);
  // "tags:" (the property key, with colon) rather than bare "tags" — the
  // surrounding explanatory comment mentions "tags" in prose and would
  // otherwise false-positive this check.
  assert.equal(journalingUpdatesBody.includes('tags:'), false, 'Saving edits should no longer read or set a tags field.');
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
