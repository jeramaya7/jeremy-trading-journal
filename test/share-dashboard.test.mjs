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

test('share dashboard opens a clean DNA Results-only share view without PNG export', () => {
  assertIncludes(source, "document.querySelector('#shareDashboard').addEventListener('click', openShareView);", 'Share Dashboard is wired to the share view handler.');
  assertIncludes(source, "window.open('', '_blank', 'noopener,noreferrer')", 'Share Dashboard opens a new tab for the clean share view.');
  assertIncludes(source, "const dashboardSnapshot = document.querySelector('#dashboardSnapshot');", 'The share view targets only the DNA Results snapshot section.');
  assertIncludes(source, "const clonedDashboard = dashboardSnapshot.cloneNode(true);", 'Only the DNA Results section is cloned into the share view.');
  assertIncludes(source, 'class="share-view-body"', 'The share view has a dedicated body class.');
  assertIncludes(source, 'class="share-view-shell"', 'The share view has a dedicated shell class.');
  assertIncludes(source, "class=\"dashboard-snapshot-generated-date\"", 'The generated date badge remains in the share view.');
  assert.equal(source.includes('canvasToPngBlob'), false, 'No canvas-to-PNG pipeline remains.');
  assert.equal(source.includes('downloadBlob'), false, 'No local PNG download helper remains.');
  assert.equal(source.includes('new XMLSerializer().serializeToString(wrapper)'), false, 'No SVG image serialization pipeline remains.');
  assert.equal(source.includes("querySelector('.hero-stats-row')"), false, 'The share view does not capture the top KPI row.');
  assert.equal(source.includes("querySelector('.monthly-calendar-panel')"), false, 'The share view does not capture the Monthly Trading Calendar.');
  assert.equal(source.includes("querySelector('.setup-analytics-panel')"), false, 'The share view does not capture Setup Analytics.');
  assert.equal(source.includes('wa.me'), false, 'No WhatsApp deep link is used.');
  assert.equal(source.includes('whatsapp'), false, 'No WhatsApp API integration is added.');
});

test('dashboard snapshot styles are optimized for a clean share view', () => {
  assertIncludes(styles, '.dashboard-snapshot', 'The snapshot area has dedicated styling.');
  assertIncludes(styles, '.share-view-body', 'The share view has a clean page background.');
  assertIncludes(styles, '.share-view-shell', 'The share view has a centered desktop-first shell.');
  assertIncludes(styles, '.dashboard-snapshot-share-view', 'The cloned DNA Results section has share-view-specific layout styles.');
  assertIncludes(styles, '@media print', 'The share view includes print-friendly styles.');
});

