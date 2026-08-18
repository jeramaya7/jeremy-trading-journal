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
  assertIncludes(source, 'pageMode === PAGE_MODES.dashboard ? `<button class="share-dashboard-button" type="button" id="shareDashboard">${icon(\'download\')} Download PNG</button>` : \'\'', 'The hero action Download PNG button is rendered in Dashboard Mode.');
  assertIncludes(source, 'id="dashboardSnapshot"', 'The dashboard has a dedicated snapshot area.');
  assertIncludes(source, "statCard('trend', 'Net P/L'", 'Top KPI row includes Net P/L.');
  assertIncludes(source, "statCard('chart', 'Trades'", 'Top KPI row includes Trades.');
  assertIncludes(source, "statCard('target', 'Win Rate'", 'Top KPI row includes Win Rate.');
  assertIncludes(source, "statCard('line', 'Profit Factor'", 'Snapshot includes Profit Factor.');
  assertIncludes(source, "statCard('trend', 'Biggest Winner'", 'Snapshot includes Biggest Winner.');
  assertIncludes(source, "statCard('trend', 'Biggest Loser'", 'Snapshot includes Biggest Loser.');
  assertIncludes(source, "statCard('trend', 'Average Winner'", 'Snapshot includes Average Winner.');
  assertIncludes(source, "statCard('trend', 'Average Loser'", 'Snapshot includes Average Loser.');
  assertIncludes(source, "statCard('calendar', 'Daily P/L'", 'Snapshot includes Daily P/L.');
  assertIncludes(source, "statCard('calendar', 'Weekly P/L'", 'Snapshot includes Weekly P/L.');
  assertIncludes(source, "statCard('calendar', 'Monthly P/L'", 'Snapshot includes Monthly P/L.');
  assertIncludes(source, "statCard('calendar', 'Yearly P/L'", 'Snapshot includes Yearly P/L.');
  assertIncludes(source, "statCard('trend', 'Daily Return %'", 'Snapshot includes Daily Return %.');
  assertIncludes(source, "statCard('trend', 'Weekly Return %'", 'Snapshot includes Weekly Return %.');
  assertIncludes(source, "statCard('trend', 'Monthly Return %'", 'Snapshot includes Monthly Return %.');
  assertIncludes(source, "statCard('trend', 'Yearly Return %'", 'Snapshot includes Yearly Return %.');
  assertIncludes(source, "statCard('line', 'Daily PF'", 'Snapshot includes Daily PF.');
  assertIncludes(source, "statCard('line', 'Weekly PF'", 'Snapshot includes Weekly PF.');
  assertIncludes(source, "statCard('line', 'Monthly PF'", 'Snapshot includes Monthly PF.');
  assertIncludes(source, "statCard('line', 'Yearly PF'", 'Snapshot includes Yearly PF.');
  assertIncludes(source, '<section class="dashboard-snapshot" id="dashboardSnapshot"', 'DNA Results has a dedicated snapshot area.');
});

test('share dashboard downloads a PNG snapshot of the updated dashboard content', () => {
  assertIncludes(source, "document.querySelector('#shareDashboard')?.addEventListener('click', openShareDashboardView, { signal });", 'Share Dashboard is wired to the PNG download handler.');
  assertIncludes(source, "const snapshotEl = document.querySelector('#shareCapture') || document.querySelector('#dashboardSnapshot');", 'The PNG export captures the top KPI row and DNA Results.');
  assertIncludes(source, 'window.html2canvas(snapshotEl', 'PNG export renders the dashboard snapshot with html2canvas.');
  assertIncludes(source, 'link.download = `DNA-dashboard-${date}.png`;', 'PNG export uses the DNA dashboard filename.');
  assertIncludes(source, "link.href = canvas.toDataURL('image/png');", 'PNG export writes a PNG data URL.');
  assert.equal(source.includes('new XMLSerializer().serializeToString(wrapper)'), false, 'No SVG foreignObject serialization remains.');
  assert.equal(source.includes("querySelector('.monthly-calendar-panel')"), false, 'The share flow does not target the Monthly Trading Calendar.');
  assert.equal(source.includes("querySelector('.setup-analytics-panel')"), false, 'The share flow does not target Setup Analytics.');
  assert.equal(source.includes('wa.me'), false, 'No WhatsApp deep link is used.');
  assert.equal(source.includes('whatsapp'), false, 'No WhatsApp API integration is added.');
});

test('dashboard snapshot styles support a clean share view', () => {
  assertIncludes(styles, '.dashboard-snapshot', 'The snapshot area has dedicated styling.');
  assertIncludes(styles, '.share-view-shell', 'The share page has dedicated shell styling.');
  assertIncludes(styles, '.share-view-header', 'The share page has a dedicated header.');
  assertIncludes(styles, '.share-view-shell .dashboard-snapshot-header h2', 'The share view keeps the DNA Results title unclipped.');
});

test('share dashboard hero action remains visible in Dashboard Mode', () => {
  assertIncludes(styles, 'display: inline-flex;', 'The Share Dashboard button keeps an explicit visible layout display.');
  assertIncludes(styles, 'flex: 0 0 auto;', 'The Share Dashboard button is not allowed to collapse inside hero actions.');
});
