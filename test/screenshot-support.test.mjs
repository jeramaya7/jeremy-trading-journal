import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

function assertIncludes(text, expected, message) {
  assert.ok(text.includes(expected), `${message}\nExpected to find: ${expected}`);
}

test('screenshot upload input still accepts image files', () => {
  assertIncludes(source, 'input name="screenshot" type="file" accept="image/*"', 'Trade Screenshot keeps the existing image file input.');
  assertIncludes(source, 'const screenshot = selectedScreenshot ?? await readScreenshot(formData.get(\'screenshot\') || pastedScreenshotFile);', 'Submitting a trade still reads uploaded screenshot files.');
});

test('paste support only accepts image clipboard content', () => {
  assertIncludes(source, "document.addEventListener('paste', pasteScreenshot);", 'The document listens for paste events.');
  assertIncludes(source, "item.kind === 'file' && item.type.startsWith('image/')", 'Clipboard items are filtered to image files.');
  assertIncludes(source, "file.type.startsWith('image/')", 'Clipboard files are filtered to image MIME types.');
  assertIncludes(source, 'if (!file) {\n    return;\n  }', 'Non-image clipboard content is ignored.');
});

test('pasted screenshots populate the field and use the same thumbnail/full-size link markup', () => {
  assertIncludes(source, 'setFileInputFile(document.querySelector(\'input[name="screenshot"]\'), file);', 'Pasted images are assigned to the existing screenshot file input when the browser allows it.');
  assertIncludes(source, 'selectedScreenshot = await readScreenshot(file);', 'Pasted images use the same FileReader storage path as uploads.');
  assertIncludes(source, 'function screenshotLink(screenshot, label)', 'The reusable screenshot thumbnail/full-size link markup exists.');
  assertIncludes(source, 'return screenshotLink(trade.screenshot, trade.symbol);', 'Saved trade cards use the reusable screenshot thumbnail/full-size link markup.');
  assertIncludes(source, "preview.innerHTML = selectedScreenshot ? screenshotLink(selectedScreenshot, 'selected trade screenshot') : '';", 'The form preview uses the reusable screenshot thumbnail/full-size link markup.');
});


test('full-size screenshot links render data URL images in a new tab document', () => {
  assertIncludes(source, 'function openScreenshotLink(event)', 'A click handler exists for full-size screenshot links.');
  assertIncludes(source, "const imageUrl = link.getAttribute('href');", 'The handler uses the rendered screenshot href as the full-size image source.');
  assertIncludes(source, "if (!imageUrl?.startsWith('data:image/'))", 'Only locally stored image data URLs are intercepted for custom viewing.');
  assertIncludes(source, "const fullSizeWindow = window.open('', '_blank');", 'The handler opens a new tab before writing the screenshot document.');
  assertIncludes(source, '<img src="${escapeHtml(imageUrl)}"', 'The new tab document assigns the screenshot data URL to an image element instead of leaving about:blank empty.');
  assertIncludes(source, "link.addEventListener('click', openScreenshotLink);", 'Rendered screenshot links are wired to the full-size screenshot handler.');
});

test('helper copy and JSON import/export preserve screenshot data', () => {
  assertIncludes(source, 'Tip: Paste a screenshot with Ctrl+V / Cmd+V', 'The Trade Screenshot helper text is rendered.');
  assertIncludes(source, 'JSON.stringify(trades, null, 2)', 'Export serializes full trade objects, including screenshot data.');
  assertIncludes(source, 'persistTrades(importedTrades)', 'Import persists full trade objects, including screenshot data.');
});

test('risk fields and calculations are available for trade logging', () => {
  assertIncludes(source, 'input name="stopLoss" type="number"', 'The trade form includes an Original Stop Loss field.');
  assertIncludes(source, 'input name="adjustedStopLoss" type="number"', 'The trade form includes an optional Adjusted Stop Loss field.');
  assertIncludes(source, 'input name="accountSize" type="number"', 'The trade form includes an Account Size field.');
  assertIncludes(source, 'input name="riskPercent" type="number"', 'The trade form includes a calculated Risk % field.');
  assertIncludes(source, 'function getActiveStopLoss(trade)', 'Risk calculations resolve the active stop loss through a helper.');
  assertIncludes(source, 'return getStopLossHitPrice(trade) ?? toOptionalNumber(trade.adjustedStopLoss) ?? toOptionalNumber(trade.stopLoss);', 'Adjusted Stop Loss overrides Original Stop Loss when present.');
  assertIncludes(source, "const riskPerUnit = trade.direction === 'Short'", 'Risk dollars are calculated from direction-aware entry and active stop distance.');
  assertIncludes(source, "if (symbol === 'XAUUSD' || symbol.includes('GOLD')) {", 'XAUUSD risk calculations infer the 100-ounce gold contract for lot-sized manual and imported trades.');
  assertIncludes(source, 'const explicitContractSize = toOptionalNumber(trade.contractSize ?? trade.lotSizeInUnits);', 'Imported cTrader trades can use broker metadata for contract-size risk calculations.');
  assertIncludes(source, 'const accountSize = toOptionalNumber(trade.accountSize) ?? accountBalance;', 'Risk percent falls back to imported account balance.');
  assertIncludes(source, 'return (riskDollars / accountSize) * 100;', 'Risk percent is calculated from risk dollars and account size.');
  assertIncludes(source, 'return calculatePnl(trade) / riskDollars;', 'R multiple is calculated from P&L and risk dollars.');
  assertIncludes(source, 'return (gross * getTradeContractSize(trade)) - fees;', 'Manual lot-sized P&L uses the same contract-size conversion as risk.');
});

test('risk metrics render on trade cards and focused dashboard summary', () => {
  assertIncludes(source, 'const activeStopLoss = getActiveStopLoss(trade);', 'Trade cards compute the active risk stop through the shared helper.');
  assertIncludes(source, 'Original Stop Loss: ${stopLoss === null ?', 'Trade cards render the original stop loss for auditing.');
  assertIncludes(source, 'Adjusted Stop Loss: ${adjustedStopLoss === null ?', 'Trade cards render the adjusted stop loss display value.');
  assertIncludes(source, 'Risk Stop: ${currency(activeStopLoss)}', 'Trade cards render the active risk stop used by risk and R calculations.');
  assertIncludes(source, 'Risk $: ${riskDollars === null ?', 'Trade cards render risk dollars with blank-field fallback.');
  assertIncludes(source, 'Risk %: ${formatRiskPercent(riskPercent)}', 'Trade cards render risk percent.');
  assertIncludes(source, 'R: ${formatRMultiple(rMultiple)}', 'Trade cards render R multiple.');
  assertIncludes(source, "statCard('trend', 'Net P/L', currency(stats.totalPnl), getMoneyTone(stats.totalPnl))", 'The top KPI summary includes Net P/L.');
  assertIncludes(source, "statCard('target', 'Average Risk $'", 'The summary includes average risk dollars.');
  assertIncludes(source, "statCard('target', 'Average Risk %'", 'The summary includes average risk percent.');
  assertIncludes(source, "statCard('target', 'Average R'", 'The summary includes average R.');
});
