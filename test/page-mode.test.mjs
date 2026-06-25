import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

function assertIncludes(text, expected, message) {
  assert.ok(text.includes(expected), `${message}\nExpected to find: ${expected}`);
}

test('page mode toggle persists Dashboard Mode and Trading Mode selection', () => {
  assertIncludes(source, "const PAGE_MODE_STORAGE_KEY = 'jeremy-trading-journal:page-mode:v1';", 'Page mode uses a dedicated localStorage key.');
  assertIncludes(source, 'function loadPageMode()', 'Page mode is restored on load.');
  assertIncludes(source, 'window.localStorage.setItem(PAGE_MODE_STORAGE_KEY, pageMode);', 'Page mode changes are persisted.');
  assertIncludes(source, 'Dashboard Mode', 'Dashboard Mode toggle label is visible.');
  assertIncludes(source, 'Trading Mode', 'Trading Mode toggle label is visible.');
  assertIncludes(styles, '.page-mode-toggle', 'Page mode toggle has visible styling.');
});

test('Trading Mode reorders the shared journal workspace ahead of dashboard sections', () => {
  assertIncludes(source, 'const journalWorkspaceSection = renderJournalWorkspace(filteredTrades, today);', 'Journal workspace is rendered once as a shared section.');
  assertIncludes(source, "? `${journalWorkspaceSection}${dashboardSections}`", 'Trading Mode puts journal access before dashboard analytics.');
  assertIncludes(source, ': `${dashboardSections}${journalWorkspaceSection}`;', 'Dashboard Mode keeps the dashboard-first layout.');
});
