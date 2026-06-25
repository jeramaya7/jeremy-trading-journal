import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

function assertIncludes(text, expected, message) {
  assert.ok(text.includes(expected), `${message}\nExpected to find: ${expected}`);
}

test('dashboard snapshot has a share button and captures required dashboard content', () => {
  assertIncludes(source, 'id="shareDashboard"', 'The dashboard renders a Share Dashboard button.');
  assertIncludes(source, 'pageMode === PAGE_MODES.dashboard ? `<button class="share-dashboard-button" type="button" id="shareDashboard">${icon(\'share\')} Share Dashboard</button>` : \'\'', 'The hero action Share Dashboard button is rendered in Dashboard Mode.');
  assertIncludes(source, 'id="dashboardSnapshot"', 'The dashboard has a dedicated snapshot capture area.');
  assertIncludes(source, "statCard('trend', 'Net P/L'", 'Top KPI row includes Net P/L.');
  assertIncludes(source, "statCard('target', 'Win Rate'", 'Snapshot includes Win Rate.');
  assertIncludes(source, "statCard('chart', 'Trades Analyzed'", 'Top KPI row includes Trades Analyzed.');
  assertIncludes(source, "statCard('trend', 'Biggest Winner'", 'Snapshot includes Biggest Winner.');
  assertIncludes(source, "statCard('trend', 'Average Winner'", 'Snapshot includes Average Winner.');
  assertIncludes(source, "statCard('trend', 'Average Loser'", 'Snapshot includes Average Loser.');
  assertIncludes(source, "statCard('target', 'Average R'", 'Snapshot includes Average R.');
  assertIncludes(source, "statCard('target', 'Average Risk $'", 'Snapshot includes Average Risk $.');
  assertIncludes(source, "statCard('target', 'Average Risk %'", 'Snapshot includes Average Risk %.');
  assertIncludes(source, "statCard('calendar', 'Daily P/L'", 'Snapshot includes Daily P/L.');
  assertIncludes(source, "statCard('calendar', 'Weekly P/L'", 'Snapshot includes Weekly P/L.');
  assertIncludes(source, "statCard('calendar', 'Monthly P/L'", 'Snapshot includes Monthly P/L.');
  assertIncludes(source, "statCard('calendar', 'Yearly P/L'", 'Snapshot includes Yearly P/L.');
  assertIncludes(source, '<section class="dashboard-snapshot" id="dashboardSnapshot"', 'DNA Results has a dedicated snapshot capture area.');
});

test('share dashboard exports a local PNG download without external sharing APIs', () => {
  assertIncludes(source, "document.querySelector('#shareDashboard')?.addEventListener('click', shareDashboardSnapshot);", 'Share Dashboard is wired to the export handler.');
  assertIncludes(source, 'new XMLSerializer().serializeToString(wrapper)', 'The snapshot DOM is serialized for image generation.');
  assertIncludes(source, "canvasToPngBlob(canvas)", 'The snapshot canvas is converted to a PNG blob.');
  assertIncludes(source, "downloadBlob(pngBlob, `jeremy-dashboard-snapshot-", 'The PNG is downloaded locally.');
  assertIncludes(source, "class=\"dashboard-snapshot-generated-date\"", 'The generated date badge has an explicit class for targeted export inclusion.');
  assertIncludes(source, "const dashboardSnapshot = document.querySelector('#dashboardSnapshot');", 'The export targets only the DNA Results snapshot section.');
  assertIncludes(source, "const clonedDashboard = dashboardSnapshot.cloneNode(true);", 'Only the DNA Results section is cloned for export.');
  assert.equal(source.includes("querySelector('.hero-stats-row')"), false, 'The export does not capture the top KPI row.');
  assert.equal(source.includes("querySelector('.monthly-calendar-panel')"), false, 'The export does not capture the Monthly Trading Calendar.');
  assert.equal(source.includes("querySelector('.setup-analytics-panel')"), false, 'The export does not capture Setup Analytics.');
  assert.equal(source.includes("dashboard-snapshot-generated-date')?.remove()"), false, 'The generated date badge remains in the export.');
  assert.equal(source.includes('wa.me'), false, 'No WhatsApp deep link is used.');
  assert.equal(source.includes('whatsapp'), false, 'No WhatsApp API integration is added.');
});

test('dashboard snapshot styles are optimized for a clean exported image', () => {
  assertIncludes(styles, '.dashboard-snapshot', 'The snapshot area has dedicated styling.');
  assertIncludes(styles, '.dashboard-snapshot-export', 'The export clone has fixed-width styling for consistent PNG output.');
  assertIncludes(styles, 'width: 1200px;', 'The exported image uses a stable share-friendly width.');
  assertIncludes(styles, '.dashboard-snapshot-export .dashboard-snapshot-header', 'The DNA Results export header has dedicated rendering styles.');
});

test('share dashboard hero action remains visible in Dashboard Mode', () => {
  assertIncludes(styles, 'display: inline-flex;', 'The Share Dashboard button keeps an explicit visible layout display.');
  assertIncludes(styles, 'flex: 0 0 auto;', 'The Share Dashboard button is not allowed to collapse inside hero actions.');
});
