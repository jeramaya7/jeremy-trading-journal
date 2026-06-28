import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

function assertIncludes(text, expected, message) {
  assert.ok(text.includes(expected), `${message}\nExpected to find: ${expected}`);
}

test('final stop loss recalculates risk metrics immediately after save', () => {
  assertIncludes(source, 'adjustedStopLoss: toOptionalNumber(formData.get(\'adjustedStopLoss\'))', 'Saved manual trades persist the final stop loss value.');
  assertIncludes(source, 'adjustedStopLoss: toOptionalNumber(formData.get(\'adjustedStopLoss\'))', 'Saved trade edits persist the final stop loss value.');
  assertIncludes(source, 'persistTrades(trades.map((trade) => (', 'Saving edits writes the updated final stop to local storage and triggers a render.');
  assertIncludes(source, 'const riskDollars = calculateRiskDollars(trade);', 'Trade cards recalculate Risk $ from saved trade data during render.');
  assertIncludes(source, 'const riskPercent = calculateRiskPercent(trade);', 'Trade cards recalculate Risk % from saved trade data during render.');
  assertIncludes(source, 'const rMultiple = calculateRMultiple(trade);', 'Trade cards recalculate R from saved trade data during render.');
});

test('final stop loss persists through reload using the existing journal storage path', () => {
  assertIncludes(source, "const STORAGE_KEY = 'jeremy-trading-journal:v1';", 'Journal entries continue to use the existing local storage key.');
  assertIncludes(source, 'window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));', 'Persisted trades serialize the full trade object, including adjustedStopLoss.');
  assertIncludes(source, 'parsedTrades = JSON.parse(savedTrades);', 'Reloaded trades are parsed from local storage.');
  assertIncludes(source, 'const migratedTrades = shouldMigrateSavedTrades ? normalizeTradeSetups(parsedTrades) : parsedTrades;', 'Reload keeps persisted trade fields instead of remapping cTrader import data.');
  assertIncludes(source, "${field('Final Stop Loss', `<input name=\"adjustedStopLoss\"", 'Edit forms label the editable stop field as Final Stop Loss.');
  assertIncludes(source, 'value="${escapeHtml(trade.adjustedStopLoss ?? \'\')}"', 'Re-opened edit forms hydrate the saved final stop loss value.');
});

test('analytics use the final stop through shared risk and R helpers', () => {
  assertIncludes(source, 'return getStopLossHitPrice(trade) ?? toOptionalNumber(trade.adjustedStopLoss) ?? toOptionalNumber(trade.stopLoss);', 'Risk helpers prefer the stop-loss hit price, then final stop loss, and fall back to initial stop loss.');
  assertIncludes(source, 'return calculatePnl(trade) / riskDollars;', 'R multiple is derived from active-stop Risk $ for normal trades.');
  assertIncludes(source, 'return calculateProtectedProfitRMultiple(trade);', 'R multiple falls back to protected-profit R when final stop loss has moved beyond entry.');
  assertIncludes(source, 'const rMultiple = calculateRMultiple(trade);', 'Setup analytics consumes the shared final-stop R calculation.');
  assertIncludes(source, 'const rValues = trades.map(calculateRMultiple).filter(Number.isFinite);', 'Dashboard Average R consumes the shared final-stop R calculation.');
  assertIncludes(source, 'const riskDollarValues = trades.map(calculateRiskDollars).filter(Number.isFinite);', 'Dashboard Average Risk $ consumes the shared final-stop risk calculation.');
  assertIncludes(source, 'const riskPercentValues = trades.map(calculateRiskPercent).filter(Number.isFinite);', 'Dashboard Average Risk % consumes the shared final-stop risk calculation.');
});


test('take profit edit fields are visible and persisted', () => {
  assertIncludes(source, 'edit-take-profit-row', 'Edit forms place take-profit controls in their own visible row.');
  assertIncludes(source, "${field('Initial Take Profit', `<input name=\"takeProfit\"", 'Edit forms keep the Initial Take Profit label and input.');
  assertIncludes(source, "${field('Final Take Profit', `<input name=\"adjustedTakeProfit\"", 'Edit forms keep the Final Take Profit label and input.');
  assertIncludes(source, "takeProfit: toOptionalNumber(formData.get('takeProfit'))", 'Trade saves persist the initial take profit value.');
  assertIncludes(source, "adjustedTakeProfit: toOptionalNumber(formData.get('adjustedTakeProfit'))", 'Trade saves persist the final take profit value.');
});

test('protected-profit R uses initial risk when final stop loss locks profit', () => {
  assertIncludes(source, 'function calculateProtectedProfitRMultiple(trade)', 'Protected-profit R has a dedicated helper.');
  assertIncludes(source, 'const originalRiskDollars = calculateOriginalRiskDollars(trade);', 'Protected-profit R divides locked profit by initial stop-loss risk.');
  assertIncludes(source, "? entry - adjustedStopLoss", 'Short protected-profit R uses entry minus final stop loss.');
  assertIncludes(source, ': adjustedStopLoss - entry;', 'Long protected-profit R uses final stop loss minus entry.');
  assertIncludes(source, 'const lockedProfitDollars = lockedProfitPerUnit * size * getTradeContractSize(trade);', 'Protected-profit R includes size and contract size.');
});

test('stop loss close reason uses exit price as the active risk stop', () => {
  assertIncludes(source, "function isStopLossCloseReason(closeReason) {", 'Stop Loss close reason detection is centralized.');
  assertIncludes(source, "return isStopLossCloseReason(trade.closeReason) ? toOptionalNumber(trade.exit) : null;", 'Stop Loss trades use the exit price as the stop that was hit.');
  assertIncludes(source, "return getStopLossHitPrice(trade) ?? toOptionalNumber(trade.adjustedStopLoss) ?? toOptionalNumber(trade.stopLoss);", 'Risk calculations prefer the stop-loss hit price over stale stored risk stops.');
  assertIncludes(source, "? toOptionalNumber(formData.get('exit'))", 'Saving a Stop Loss edit stores the readonly exit as the risk stop.');
  assertIncludes(source, "`<span>Risk Stop: ${currency(activeStopLoss)}</span>`", 'Trade cards display the active Risk Stop used for risk and R calculations.');
});
