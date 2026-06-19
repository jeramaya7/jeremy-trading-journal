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
  assertIncludes(source, 'id="dashboardSnapshot"', 'The dashboard has a dedicated snapshot capture area.');
  assertIncludes(source, "statCard('trend', 'Net P&L'", 'Snapshot includes Net P&L.');
  assertIncludes(source, "statCard('target', 'Win Rate'", 'Snapshot includes Win Rate.');
  assertIncludes(source, "statCard('chart', 'Trades Logged'", 'Snapshot includes Trades Logged.');
  assertIncludes(source, "statCard('trend', 'Biggest Winner'", 'Snapshot includes Biggest Winner.');
  assertIncludes(source, "statCard('line', 'Average Win / Loss'", 'Snapshot includes Average Win / Loss.');
  assertIncludes(source, "statCard('line', 'Average R'", 'Snapshot includes Average R.');
  assertIncludes(source, "statCard('target', 'Average Risk $'", 'Snapshot includes Average Risk $.');
  assertIncludes(source, "statCard('target', 'Average Risk %'", 'Snapshot includes Average Risk %.');
  assertIncludes(source, "statCard('calendar', 'Daily P&L'", 'Snapshot includes Daily P&L.');
  assertIncludes(source, "statCard('calendar', 'Weekly P&L'", 'Snapshot includes Weekly P&L.');
  assertIncludes(source, "statCard('calendar', 'Monthly P&L'", 'Snapshot includes Monthly P&L.');
  assertIncludes(source, "statCard('calendar', 'Yearly P&L'", 'Snapshot includes Yearly P&L.');
  assertIncludes(source, '${setupAnalyticsSection}', 'Snapshot includes the Setup Analytics table.');
});

test('share dashboard exports a local PNG download without external sharing APIs', () => {
  assertIncludes(source, "document.querySelector('#shareDashboard').addEventListener('click', shareDashboardSnapshot);", 'Share Dashboard is wired to the export handler.');
  assertIncludes(source, 'new XMLSerializer().serializeToString(wrapper)', 'The snapshot DOM is serialized for image generation.');
  assertIncludes(source, "canvasToPngBlob(canvas)", 'The snapshot canvas is converted to a PNG blob.');
  assertIncludes(source, "downloadBlob(pngBlob, `jeremy-dashboard-snapshot-", 'The PNG is downloaded locally.');
  assert.equal(source.includes('wa.me'), false, 'No WhatsApp deep link is used.');
  assert.equal(source.includes('whatsapp'), false, 'No WhatsApp API integration is added.');
});

test('dashboard snapshot styles are optimized for a clean exported image', () => {
  assertIncludes(styles, '.dashboard-snapshot', 'The snapshot area has dedicated styling.');
  assertIncludes(styles, '.dashboard-snapshot-export', 'The export clone has fixed-width styling for consistent PNG output.');
  assertIncludes(styles, 'width: 1200px;', 'The exported image uses a stable share-friendly width.');
  assertIncludes(styles, '.dashboard-snapshot-export .setup-analytics-table-wrap', 'The Setup Analytics table is fully visible in exports.');
});
