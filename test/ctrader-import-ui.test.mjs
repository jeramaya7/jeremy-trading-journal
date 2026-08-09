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
  assertIncludes(source, 'const AUTO_SYNC_INTERVAL_MS = 12 * 1000;', 'Auto Sync polls within 12 seconds.');
  assertIncludes(source, 'let cTraderAutoSyncTimer = null;', 'The app tracks the active Auto Sync timer.');
  assertIncludes(source, 'function scheduleCTraderAutoSync()', 'Auto Sync can schedule recurring sync checks.');
  assertIncludes(source, 'clearInterval(cTraderAutoSyncTimer);', 'Changing Auto Sync clears the previous timer to avoid duplicate polling.');
  assertIncludes(source, 'window.setInterval(() => {', 'Auto Sync repeats without requiring the user to press Sync.');
  assertIncludes(source, 'scheduleCTraderAutoSync();', 'The app schedules Auto Sync during startup and preference changes.');

  // Lowering the interval from 60s to 12s is only safe because overlapping
  // requests were already prevented and still are: both entry points bail
  // out immediately if a sync is already in flight, so a tick that fires
  // mid-sync is skipped rather than starting a second request.
  const syncCTraderStart = source.indexOf('async function syncCTrader(options = {}) {');
  const syncCTraderEnd = source.indexOf('\nfunction buildCTraderSyncRequestPath(');
  assert.notEqual(syncCTraderStart, -1, 'syncCTrader should exist.');
  const syncCTraderBody = source.slice(syncCTraderStart, syncCTraderEnd);
  assertIncludes(syncCTraderBody, 'if (isSyncingCTrader) {\n    return;\n  }', 'syncCTrader() bails out immediately if a sync is already running, preventing overlapping requests.');

  const syncOnStartupStart = source.indexOf('async function syncCTraderOnStartup() {');
  const syncOnStartupEnd = source.indexOf('\nfunction exportTrades(');
  assert.notEqual(syncOnStartupStart, -1, 'syncCTraderOnStartup should exist.');
  const syncOnStartupBody = source.slice(syncOnStartupStart, syncOnStartupEnd);
  assertIncludes(syncOnStartupBody, 'if (isSyncingCTrader || isCheckingCTraderConnection) {\n    return;\n  }', 'The Auto Sync timer tick also bails out immediately if a sync is already running or a connection check is in progress.');

  // Duplicate-trade prevention (source-key dedup) is independent of the
  // polling interval and unaffected by this change.
  assertIncludes(source, 'const syncPlan = buildCTraderSyncPlan(previewTrades, trades, {', 'Every sync (whether every 12s or 60s) still runs preview trades through the same dedup-by-source-key plan before importing anything.');
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
  // Deleting is now a soft delete (Trash / Undo) — the click handler calls
  // softDeleteTrade(), which itself looks the trade up and remembers its
  // cTrader source key before marking it deleted, same as the old hard
  // delete did before removing it outright.
  assertIncludes(source, 'function softDeleteTrade(tradeId) {', 'A dedicated soft-delete function replaces the old inline hard-delete filter.');
  assertIncludes(source, 'const trade = getTradeById(tradeId);', 'softDeleteTrade identifies the trade being removed before acting on it.');
  assertIncludes(source, 'rememberDeletedCTraderSourceKey(trade);', 'softDeleteTrade remembers cTrader source keys before marking the trade deleted.');
  assertIncludes(source, 'softDeleteTrade(button.dataset.deleteTrade);', 'The Delete button calls the soft-delete function.');
  assertIncludes(source, 'window.localStorage.setItem(DELETED_CTRADER_SOURCE_KEYS_STORAGE_KEY, JSON.stringify([...sourceKeys].sort()))', 'Deleted source keys are saved to localStorage.');
});

test('trade cards expose an edit flow for local journaling fields', () => {
  assertIncludes(source, 'data-edit-trade="${escapeHtml(trade.id)}"', 'Each trade card renders an Edit button tied to that trade ID.');
  assertIncludes(source, 'function editTradeForm(trade)', 'Editing renders a focused form on the selected trade card.');
  assertIncludes(source, 'data-edit-trade-form="${escapeHtml(trade.id)}"', 'The edit form keeps a stable trade ID for saving changes.');
  assertIncludes(source, "${field('Setup', renderPlayBookSetupSelect(trade))}", 'The edit form allows setup changes through the Play Book dropdown.');
  assertIncludes(source, 'const PLAY_BOOK_SETUP_OPTIONS = [', 'The Play Book setup dropdown has a fixed setup list.');
  assertIncludes(source, "'Trend Continuation'", 'The Play Book setup dropdown includes Trend Continuation.');
  assertIncludes(source, "'Countertrend Continuation'", 'The Play Book setup dropdown includes Countertrend Continuation.');
  assertIncludes(source, "'Momentum / Breakout'", 'The Play Book setup dropdown includes Momentum / Breakout.');
  assertIncludes(source, "'RBI / GBI'", 'The Play Book setup dropdown includes RBI / GBI.');
  assertIncludes(source, "'Retrace / Bounce'", 'The Play Book setup dropdown includes Retrace / Bounce.');
  assertIncludes(source, "'Support & Resistance'", 'The Play Book setup dropdown includes Support & Resistance.');
  assertIncludes(source, "'Scalp'", 'The Play Book setup dropdown includes Scalp.');
  assertIncludes(source, "const CUSTOM_SETUP_OPTION = 'Custom...';", 'The Play Book setup dropdown includes Custom... after the fixed list.');
  assert.ok(!source.includes("  'Trade Line Break',"), 'The Play Book setup dropdown no longer shows the misspelled setup label.');
  assert.ok(!source.includes("'Elephant Bar',") , 'The retired Elephant Bar label is no longer a selectable Play Book option (migrated to Momentum / Breakout instead).');
  assert.ok(!source.includes('>None</option>\n      ${PLAY_BOOK_SETUP_OPTIONS'), 'The Play Book setup dropdown no longer offers a None option.');

  const setupSelectStart = source.indexOf('function renderPlayBookSetupSelect(trade)');
  const setupSelectEnd = source.indexOf('\nfunction ', setupSelectStart + 1);
  const setupSelectBody = source.slice(setupSelectStart, setupSelectEnd);
  assert.equal(setupSelectBody.includes('setupCustom'), true, 'The Setup dropdown renders a free-text custom setup input.');
  assert.equal(setupSelectBody.includes('data-custom-setup'), true, 'The custom setup input hook is present.');

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

  // Setup section: Setup, State, Timeframe — Position was removed (DNA 26).
  const setupBody = editFormBody.slice(setupIndex, reviewIndex);
  assert.equal(setupBody.includes("renderPositionTypeSelect"), false, 'Position should no longer render anywhere in the Setup section (removed in DNA 26).');
  assertIncludes(setupBody, "${field('State', renderMarketStateSelect(trade))}", 'State keeps its name.');
  assert.ok(
    setupBody.indexOf("${field('State', renderMarketStateSelect(trade))}") < setupBody.indexOf("${field('Setup', renderPlayBookSetupSelect(trade))}"),
    'State renders before Setup in the Setup section.',
  );
  assertIncludes(setupBody, "${field('Timeframe', renderTimeframeSelect(trade))}", 'Timeframe is in the Setup section.');

  // Trade Review section: Trade Management, Protected (read-only, calculated
  // from Trade Management), Exit Reason, and Loss Reason share the first
  // review row (Loss Reason present in the DOM but hidden unless the trade
  // is a Loss, so its value still round-trips through the save handler).
  // Grade and Outcome Override share a second review row directly below,
  // using the same 4-column grid — they occupy the first two columns and
  // leave the rest empty, instead of each taking a full-width row.
  const reviewBody = editFormBody.slice(reviewIndex, journalIndex);
  assertIncludes(reviewBody, "${field('Trade Management', renderTradeManagementSelect(trade))}", 'Trade Management is in Trade Review.');
  assertIncludes(reviewBody, "${field('Protected', renderProtectedDisplay(trade))}", 'Protected is in Trade Review.');
  assertIncludes(reviewBody, "${field('Exit Reason', renderCloseReasonSelect(trade))}", 'Exit Reason is in Trade Review.');
  assertIncludes(reviewBody, "${field('Loss Reason', renderLossReasonSelect(trade))}", 'Loss Reason is in Trade Review.');
  assertIncludes(reviewBody, "${field('Grade', renderGradeSelect(trade))}", 'Grade is still in the Trade Review section, in its second row.');
  assertIncludes(reviewBody, "${field('Outcome Override', renderOutcomeOverrideSelect(trade))}", 'Outcome Override is in the Trade Review section, alongside Grade.');
  assertIncludes(reviewBody, "class=\"edit-loss-reason-field\"${isLossOutcome ? '' : ' hidden'}", 'Loss Reason is only visible when the trade outcome is a Loss.');
  assertIncludes(editFormBody, "const isLossOutcome = classifyTradeOutcome(calculatePnl(trade), trade.outcomeOverride) === 'loss';", 'Loss outcome uses the shared classifier (respecting Outcome Override), matching the trade card\'s own Win/Loss/Breakeven label.');

  // Trade Review renders exactly two edit-review-row grids: the first holds
  // Trade Management/Protected/Exit Reason/(hidden) Loss Reason, unchanged
  // from before; the second holds only Grade and Outcome Override, reusing
  // the same 4-column grid so both rows share column widths and alignment.
  const reviewRowMarker = '<div class="edit-form-row edit-review-row"';
  const firstReviewRowStart = reviewBody.indexOf(reviewRowMarker);
  const secondReviewRowStart = reviewBody.indexOf(reviewRowMarker, firstReviewRowStart + 1);
  assert.notEqual(firstReviewRowStart, -1, 'The first edit-review-row should exist in Trade Review.');
  assert.notEqual(secondReviewRowStart, -1, 'A second edit-review-row should exist in Trade Review, for Grade and Outcome Override.');

  const firstReviewRowBody = reviewBody.slice(firstReviewRowStart, secondReviewRowStart);
  assertIncludes(firstReviewRowBody, "renderTradeManagementSelect(trade)", 'Trade Management is inside the first review row.');
  assertIncludes(firstReviewRowBody, "renderProtectedDisplay(trade)", 'Protected is inside the first review row.');
  assertIncludes(firstReviewRowBody, "renderCloseReasonSelect(trade)", 'Exit Reason is inside the first review row.');
  assertIncludes(firstReviewRowBody, "renderLossReasonSelect(trade)", 'Loss Reason is inside the first review row.');
  assert.equal(firstReviewRowBody.includes('renderGradeSelect'), false, 'Grade should not be inside the first review row.');
  assert.equal(firstReviewRowBody.includes('renderOutcomeOverrideSelect'), false, 'Outcome Override should not be inside the first review row.');

  const secondReviewRowEnd = reviewBody.indexOf('</div>', secondReviewRowStart);
  const secondReviewRowBody = reviewBody.slice(secondReviewRowStart, secondReviewRowEnd);
  assertIncludes(secondReviewRowBody, "renderGradeSelect(trade)", 'Grade is inside the second review row.');
  assertIncludes(secondReviewRowBody, "renderOutcomeOverrideSelect(trade)", 'Outcome Override is inside the second review row.');
  assert.equal(secondReviewRowBody.includes('renderTradeManagementSelect'), false, 'Trade Management should not be inside the second review row.');

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
  assertIncludes(source, "'Elephant Bar': 'Momentum / Breakout',", 'Elephant Bar migrates to Momentum / Breakout.');
  assertIncludes(source, "'Buy the Retrace': 'Retrace / Bounce',", 'Buy the Retrace migrates to Retrace / Bounce.');
  assertIncludes(source, "GBI: 'RBI / GBI',", 'GBI migrates to RBI / GBI.');
  assertIncludes(source, "RBI: 'RBI / GBI',", 'RBI migrates to RBI / GBI.');
  assertIncludes(source, "'Support/Resistance': 'Support & Resistance',", 'Support/Resistance migrates to Support & Resistance.');
  assertIncludes(source, "'The General Forecast': 'Other',", 'The General Forecast migrates to Other.');
  assertIncludes(source, "'X Confirm': 'Momentum / Breakout',", 'X Confirm migrates to Momentum / Breakout.');
  // The previous (DNA 25) 12-option Play Book list also migrates now that
  // the Setup dropdown is down to 8 options.
  assertIncludes(source, "'Enter Retrace': 'Retrace / Bounce',", 'The retired Enter Retrace option migrates to Retrace / Bounce.');
  assertIncludes(source, "'General Forecast': 'Other',", 'General Forecast migrates to Other.');
  assertIncludes(source, "Breakout: 'Momentum / Breakout',", 'Breakout migrates to Momentum / Breakout.');
  assertIncludes(source, "Momentum: 'Momentum / Breakout',", 'Momentum migrates to Momentum / Breakout.');
  assertIncludes(source, "Confirmation: 'Momentum / Breakout',", 'Confirmation migrates to Momentum / Breakout.');
  assertIncludes(source, "Retrace: 'Retrace / Bounce',", 'Retrace migrates to Retrace / Bounce.');
  assertIncludes(source, "Bounce: 'Retrace / Bounce',", 'Bounce migrates to Retrace / Bounce.');
  assertIncludes(source, "'S&R': 'Support & Resistance',", 'S&R migrates to Support & Resistance.');
  assert.ok(!source.includes("'MATX': "), 'MATX is deliberately left unmigrated because there is no clear replacement.');
  assert.ok(!source.includes("'Scalp': "), 'Scalp is deliberately left unmigrated (kept as its own preserved value), per product decision.');

  assertIncludes(source, 'function normalizeSetupName(setup) {', 'Setup normalization is a single shared function.');
  assertIncludes(source, 'return Object.prototype.hasOwnProperty.call(LEGACY_SETUP_NAME_MAP, setup) ? LEGACY_SETUP_NAME_MAP[setup] : setup;', 'Setup normalization looks up the shared legacy map instead of a single hardcoded pair.');
  assertIncludes(source, 'const shouldMigrateSavedTrades = hasLegacySetupName(parsedTrades) || hasMigratableMarketState(parsedTrades);', 'Saved journal entries are checked for legacy setup names and required Market State cleanup when loaded from localStorage.');
  assertIncludes(source, 'const migratedTrades = shouldMigrateSavedTrades\n    ? normalizeTradeMarketStates(normalizeTradeSetups(parsedTrades))\n    : parsedTrades;', 'Saved journal entries are normalized when migration is needed.');
  assertIncludes(source, 'window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migratedTrades));', 'Migrated saved journal entries are written back to localStorage.');
  assertIncludes(source, 'trades = normalizeTradeMarketStates(normalizeTradeSetups(nextTrades));', 'Imported and saved journal entries are normalized before persistence/export.');
  assertIncludes(source, "setup: normalizeSetupName(String(formData.get('setup')).trim()) || 'Uncategorized setup',", 'Manual entries typed with a legacy setup name are normalized.');
});

test('market state options are the simplified list and legacy values are preserved or safely mapped', () => {
  assertIncludes(source, "const MARKET_STATE_OPTIONS = [\n  'Trending',\n  'Countertrend',\n  'Channel',\n  'Compressed',\n];", 'Market State options are exactly the requested list and order.');
  assertIncludes(source, 'const DEFAULT_MARKET_STATE = MARKET_STATE_OPTIONS[0];', 'Blank Market State values safely migrate to the first required state.');
  assertIncludes(source, "'Trending Down': 'Trending',", 'Trending Down safely migrates to Trending.');
  assertIncludes(source, "'Trending Up': 'Trending',", 'Trending Up safely migrates to Trending.');
  assertIncludes(source, "'Choppy': 'Channel',", 'Choppy safely migrates to Channel.');
  assertIncludes(source, "'Consolidating': 'Channel',", 'Consolidating safely migrates to Channel.');
  assertIncludes(source, "'Counter Trend': 'Countertrend',", 'Counter Trend safely migrates to Countertrend.');
  assertIncludes(source, 'const legacyMarketStateOption = current && !MARKET_STATE_OPTIONS.includes(current)', 'Unmapped legacy Market State values are preserved as their own option.');
  assert.ok(!source.includes('<option value="">No state</option>'), 'Market State dropdown no longer allows a blank option.');
});

test('grade dropdown keeps stored values and displays simple labels', () => {
  assertIncludes(source, "const GRADE_OPTIONS = [\n  'A+',\n  'A',\n  'B',\n  'C',\n  'D',\n  'F',\n];", 'Grade stored values stay as the requested A+ through F list.');
  assert.ok(!source.includes('GRADE_OPTION_LABELS'), 'Grade descriptions are no longer used for visible dropdown labels.');
  assert.ok(!source.includes('renderSelectOptionWithLabel'), 'Grade uses the normal select option renderer.');
  assertIncludes(source, 'GRADE_OPTIONS.map((option) => renderSelectOption(option, current)).join(\'\')', 'The Grade dropdown displays the stored values as simple labels.');
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
  assertIncludes(source, "function openTradeEdit(tradeId, mode = 'full')", 'Opening edit mode goes through a dedicated edit-state transition (mode defaults to the Review layout; Quick Edit passes \'quick\').');
  assertIncludes(source, 'renderTradeCardInPlace(tradeId);', 'Opening edit mode updates only the selected trade card instead of remounting the journal.');
  assertIncludes(source, 'function renderTradeCardInPlace(tradeId)', 'Edit renders replace only the selected trade card to keep the selected entry visible.');
  assertIncludes(source, 'currentTradeCard.outerHTML = tradeCard(trade);', 'The selected trade card is swapped in place without re-sorting or remounting the journal list.');
  assertIncludes(source, 'function renderPreservingTradePosition(tradeId, renderOptions = {})', 'Edit renders use a dedicated scroll-preserving render wrapper.');
  assertIncludes(source, 'restoreTradeScrollAnchor(tradeId, anchor);', 'Save renders restore the selected trade position after data-driven DOM replacement.');
  assertIncludes(source, 'if (isTradeEditLocked() && !options.force) {', 'Normal renders are skipped while a trade edit is open.');
  assertIncludes(source, 'if (!isCTraderAutoSyncEnabled || isTradeEditLocked()) {', 'Auto Sync timers are not scheduled during an edit session.');
  assertIncludes(source, `async function syncCTraderOnStartup() {\n  if (isTradeEditLocked()) {`, 'Startup and interval Auto Sync exits without UI updates during edit mode.');
  assertIncludes(source, 'function closeTradeEdit(tradeId)', 'Save and cancel share a dedicated edit-state exit, scoped to one card so multiple cards can be open independently.');
  assertIncludes(source, `closeTradeEdit(tradeId);\n  delete editScreenshotDrafts[tradeId];`, 'Saving closes the edit lock before persisting and re-rendering the final card.');
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
  assertIncludes(source, "'Normal Loss'", 'Loss reason includes Normal Loss.');
  assertIncludes(source, "'Stop Too Tight'", 'Loss reason includes Stop Too Tight.');
  assertIncludes(source, "'Chased Price'", 'Loss reason includes Chased Price.');
  assertIncludes(source, "'Broke Rules'", 'Loss reason includes Broke Rules.');
  assertIncludes(source, "const LOSS_REASON_OPTIONS = [\n  'Normal Loss',\n  'Stop Too Tight',\n  'Chased Price',\n  'Broke Rules',\n  'Other',\n];", 'Loss reason options are exactly the DNA 26 list, in the requested order.');
  assert.ok(!source.includes("'Bad Entry'"), 'Loss reason excludes the retired Bad Entry option.');
  assert.ok(!source.includes("'Ignored Rules'"), 'Loss reason excludes the retired Ignored Rules option (renamed Broke Rules).');
  assert.ok(!source.includes("'Good Trade, Normal Loss'"), 'Loss reason excludes the retired Good Trade, Normal Loss option (renamed Normal Loss).');
  assert.ok(!source.includes("'Stayed In Too Long'"), 'Loss reason excludes the retired Stayed In Too Long option.');
  assertIncludes(source, 'const legacyLossReasonOption = currentLossReason && !LOSS_REASON_OPTIONS.includes(currentLossReason)', 'Loss reason dropdown preserves legacy saved values that are no longer selectable for new trades.');
  assertIncludes(source, '<option value="">No loss reason</option>', 'Loss reason can be left blank for existing or winning trades.');
});


test('close reason dropdown is optional and only renders on trade cards when filled', () => {
  assertIncludes(source, 'const CLOSE_REASON_OPTIONS = [', 'Close reason options are centralized for the edit dropdown.');
  assertIncludes(source, "'Take Profit'", 'Close reason includes Take Profit.');
  assertIncludes(source, "'Stop Loss'", 'Close reason includes Stop Loss.');
  assertIncludes(source, "'Trail Stop'", 'Close reason includes Trail Stop.');
  assertIncludes(source, "'Manual Exit'", 'Close reason includes Manual Exit.');
  assertIncludes(source, "const CLOSE_REASON_OPTIONS = [\n  'Take Profit',\n  'Stop Loss',\n  'Trail Stop',\n  'Manual Exit',\n  'Other',\n];", 'Close reason options are exactly the DNA 27 list, in the requested order.');
  assertIncludes(source, 'const legacyCloseReasonOption = currentCloseReason && !CLOSE_REASON_OPTIONS.includes(currentCloseReason)', 'Close reason dropdown preserves legacy saved values that are no longer selectable for new trades.');
  assert.ok(!source.includes("'Trend Change'"), 'Close reason excludes the retired Trend Change option.');
  assert.ok(!source.includes("'Manual Close'"), 'Close reason excludes the retired Manual Close option (renamed Manual Exit).');
  assert.ok(!source.includes("'Closed Too Early'"), 'Close reason excludes the retired Closed Too Early option.');
  assert.ok(!source.includes("'Secured Profit Early'"), 'Close reason excludes the retired Secured Profit Early option.');
  assertIncludes(source, '<option value="">No close reason</option>', 'Close reason can be left blank for existing trades.');
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
