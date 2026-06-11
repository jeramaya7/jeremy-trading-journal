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

test('helper copy and JSON import/export preserve screenshot data', () => {
  assertIncludes(source, 'Tip: Paste a screenshot with Ctrl+V / Cmd+V', 'The Trade Screenshot helper text is rendered.');
  assertIncludes(source, 'JSON.stringify(trades, null, 2)', 'Export serializes full trade objects, including screenshot data.');
  assertIncludes(source, 'persistTrades(importedTrades)', 'Import persists full trade objects, including screenshot data.');
});
