const STORAGE_KEY = 'jeremy-trading-journal:v1';

const starterTrades = [
  {
    id: 'sample-1',
    date: '2026-06-03',
    symbol: 'AAPL',
    direction: 'Long',
    setup: 'Opening range breakout',
    entry: 198.42,
    exit: 201.1,
    size: 50,
    fees: 2,
    emotion: 'Patient',
    tags: 'breakout, large-cap',
    notes: 'Waited for a clean retest of the opening range before entering.',
  },
  {
    id: 'sample-2',
    date: '2026-06-05',
    symbol: 'TSLA',
    direction: 'Short',
    setup: 'Failed VWAP reclaim',
    entry: 179.25,
    exit: 176.8,
    size: 30,
    fees: 2.5,
    emotion: 'Focused',
    tags: 'vwap, momentum',
    notes: 'Covered into the first flush instead of getting greedy.',
  },
  {
    id: 'sample-3',
    date: '2026-06-08',
    symbol: 'NVDA',
    direction: 'Long',
    setup: 'Pullback to 20 EMA',
    entry: 145.7,
    exit: 143.9,
    size: 25,
    fees: 1.5,
    emotion: 'Impatient',
    tags: 'pullback, lesson',
    notes: 'Entered before confirmation. Need the candle to close above the trigger level.',
  },
];

let trades = loadTrades();
let searchQuery = '';

const app = document.querySelector('#root');

function loadTrades() {
  const savedTrades = window.localStorage.getItem(STORAGE_KEY);
  if (!savedTrades) {
    return starterTrades;
  }

  const parsedTrades = JSON.parse(savedTrades);
  return Array.isArray(parsedTrades) ? parsedTrades : starterTrades;
}

function persistTrades(nextTrades) {
  trades = nextTrades;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
  render();
}

function currency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function calculatePnl(trade) {
  const entry = Number(trade.entry) || 0;
  const exit = Number(trade.exit) || 0;
  const size = Number(trade.size) || 0;
  const fees = Number(trade.fees) || 0;
  const gross = trade.direction === 'Short' ? (entry - exit) * size : (exit - entry) * size;
  return gross - fees;
}

function getStats() {
  const pnlValues = trades.map(calculatePnl);
  const wins = pnlValues.filter((value) => value > 0);
  const losses = pnlValues.filter((value) => value < 0);
  const totalPnl = pnlValues.reduce((sum, value) => sum + value, 0);
  const averageWin = wins.length ? wins.reduce((sum, value) => sum + value, 0) / wins.length : 0;
  const averageLoss = losses.length ? losses.reduce((sum, value) => sum + value, 0) / losses.length : 0;

  return {
    totalPnl,
    winRate: trades.length ? Math.round((wins.length / trades.length) * 100) : 0,
    tradeCount: trades.length,
    averageWin,
    averageLoss,
  };
}

function getFilteredTrades() {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  if (!normalizedQuery) {
    return trades;
  }

  return trades.filter((trade) => {
    return [trade.symbol, trade.setup, trade.direction, trade.emotion, trade.tags, trade.notes]
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery);
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function icon(name) {
  const icons = {
    book: '<svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z"/></svg>',
    download: '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>',
    upload: '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>',
    trend: '<svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>',
    target: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
    chart: '<svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M7 16V8"/><path d="M12 16V5"/><path d="M17 16v-3"/></svg>',
    line: '<svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M7 14l3-3 4 4 5-8"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
    calendar: '<svg viewBox="0 0 24 24"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
    image: '<svg viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>',
  };
  return icons[name] ?? '';
}

function statCard(iconName, label, value, tone = '') {
  return `
    <article class="stat-card">
      <div class="stat-icon">${icon(iconName)}</div>
      <span>${label}</span>
      <strong class="${tone}">${value}</strong>
    </article>
  `;
}

function screenshotPreview(trade) {
  if (!trade.screenshot?.dataUrl) {
    return '';
  }

  const altText = escapeHtml(trade.screenshot.name || `${trade.symbol} trade screenshot`);
  return `
    <a class="screenshot-link" href="${escapeHtml(trade.screenshot.dataUrl)}" target="_blank" rel="noreferrer" aria-label="Open full-size screenshot for ${escapeHtml(trade.symbol)}">
      <img class="screenshot-thumbnail" src="${escapeHtml(trade.screenshot.dataUrl)}" alt="${altText}" loading="lazy" />
      <span>Open full-size chart</span>
    </a>
  `;
}

function tradeCard(trade) {
  const pnl = calculatePnl(trade);
  const tone = pnl >= 0 ? 'positive' : 'negative';
  return `
    <article class="trade-card">
      <div class="trade-card-header">
        <div>
          <p class="trade-symbol">${escapeHtml(trade.symbol)}</p>
          <p class="trade-meta">${escapeHtml(trade.date)} • ${escapeHtml(trade.direction)} • ${escapeHtml(trade.setup)}</p>
        </div>
        <strong class="${tone}">${currency(pnl)}</strong>
      </div>
      <div class="trade-details">
        <span>Entry: ${currency(Number(trade.entry))}</span>
        <span>Exit: ${currency(Number(trade.exit))}</span>
        <span>Size: ${escapeHtml(trade.size)}</span>
        <span>Emotion: ${escapeHtml(trade.emotion)}</span>
      </div>
      ${trade.tags ? `<p class="tags">${escapeHtml(trade.tags)}</p>` : ''}
      ${trade.notes ? `<p class="notes">${escapeHtml(trade.notes)}</p>` : ''}
      ${screenshotPreview(trade)}
      <button class="icon-button" type="button" data-delete-trade="${escapeHtml(trade.id)}" aria-label="Delete ${escapeHtml(trade.symbol)} trade">
        ${icon('trash')} Delete
      </button>
    </article>
  `;
}

function render() {
  const stats = getStats();
  const filteredTrades = getFilteredTrades();
  const today = new Date().toISOString().slice(0, 10);

  app.innerHTML = `
    <main class="app-shell">
      <section class="hero-card">
        <div>
          <p class="eyebrow">${icon('book')} Jeremy Trading Journal</p>
          <h1>Track every setup, decision, and lesson.</h1>
          <p class="hero-copy">
            A fast local-first journal for logging trades, reviewing performance, and building disciplined repeatable habits.
          </p>
        </div>
        <div class="hero-actions">
          <button class="secondary-button" type="button" id="exportTrades">${icon('download')} Export JSON</button>
          <label class="secondary-button upload-button">
            ${icon('upload')} Import JSON
            <input type="file" accept="application/json" id="importTrades" />
          </label>
        </div>
      </section>

      <section class="stats-grid" aria-label="Trading performance summary">
        ${statCard('trend', 'Net P&L', currency(stats.totalPnl), stats.totalPnl >= 0 ? 'positive' : 'negative')}
        ${statCard('target', 'Win rate', `${stats.winRate}%`)}
        ${statCard('chart', 'Trades logged', stats.tradeCount)}
        ${statCard('line', 'Avg win / loss', `${currency(stats.averageWin)} / ${currency(stats.averageLoss)}`)}
      </section>

      <section class="workspace-grid">
        <form class="panel trade-form" id="tradeForm">
          <div class="section-title">${icon('plus')}<h2>Add trade</h2></div>
          <div class="form-grid">
            ${field('Date', '<input name="date" type="date" required value="' + today + '" />')}
            ${field('Symbol', '<input name="symbol" placeholder="SPY" required />')}
            ${field('Direction', '<select name="direction"><option>Long</option><option>Short</option></select>')}
            ${field('Setup', '<input name="setup" placeholder="Breakout, pullback, VWAP..." />')}
            ${field('Entry', '<input name="entry" type="number" min="0" step="0.01" required />')}
            ${field('Exit', '<input name="exit" type="number" min="0" step="0.01" required />')}
            ${field('Size', '<input name="size" type="number" min="0.01" step="0.01" required />')}
            ${field('Fees', '<input name="fees" type="number" min="0" step="0.01" value="0" />')}
            ${field('Emotion', '<input name="emotion" placeholder="Calm, FOMO, patient..." value="Calm" />')}
            ${field('Tags', '<input name="tags" placeholder="gap, reversal, A+" />')}
          </div>
          ${field('Notes', '<textarea name="notes" rows="5" placeholder="What was the plan? What happened? What will you repeat or avoid?"></textarea>')}
          <label class="screenshot-upload">
            <span>${icon('image')} Trade screenshot</span>
            <input name="screenshot" type="file" accept="image/*" />
            <small>Optional. One image is stored locally with this trade and included in JSON backups.</small>
          </label>
          <button class="primary-button" type="submit">Save trade</button>
        </form>

        <section class="panel journal-panel">
          <div class="journal-header">
            <div class="section-title">${icon('calendar')}<h2>Journal entries</h2></div>
            <input class="search-input" id="searchInput" placeholder="Search trades..." value="${escapeHtml(searchQuery)}" />
          </div>
          <div class="trade-list">
            ${filteredTrades.length ? filteredTrades.map(tradeCard).join('') : '<p class="empty-state">No trades match your search yet.</p>'}
          </div>
        </section>
      </section>
    </main>
  `;

  bindEvents();
}

function field(label, control) {
  return `<label class="field"><span>${label}</span>${control}</label>`;
}

function bindEvents() {
  document.querySelector('#tradeForm').addEventListener('submit', submitTrade);
  document.querySelector('#searchInput').addEventListener('input', (event) => {
    searchQuery = event.target.value;
    render();
    document.querySelector('#searchInput').focus();
  });
  document.querySelector('#exportTrades').addEventListener('click', exportTrades);
  document.querySelector('#importTrades').addEventListener('change', importTrades);

  document.querySelectorAll('[data-delete-trade]').forEach((button) => {
    button.addEventListener('click', () => {
      persistTrades(trades.filter((trade) => trade.id !== button.dataset.deleteTrade));
    });
  });
}

async function submitTrade(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const screenshot = await readScreenshot(formData.get('screenshot'));
  const nextTrade = {
    id: crypto.randomUUID(),
    date: formData.get('date'),
    symbol: String(formData.get('symbol')).trim().toUpperCase(),
    direction: formData.get('direction'),
    setup: String(formData.get('setup')).trim() || 'Uncategorized setup',
    entry: Number(formData.get('entry')),
    exit: Number(formData.get('exit')),
    size: Number(formData.get('size')),
    fees: Number(formData.get('fees')) || 0,
    emotion: String(formData.get('emotion')).trim() || 'Calm',
    tags: String(formData.get('tags')).trim(),
    notes: String(formData.get('notes')).trim(),
    screenshot,
  };

  persistTrades([nextTrade, ...trades]);
}

function readScreenshot(file) {
  if (!(file instanceof File) || !file.size) {
    return null;
  }

  if (!file.type.startsWith('image/')) {
    window.alert('Please choose an image file for the trade screenshot.');
    return null;
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        dataUrl: String(reader.result),
        name: file.name,
        type: file.type,
        size: file.size,
      });
    };
    reader.onerror = () => {
      window.alert('The screenshot could not be read. Save the trade without it or choose another image.');
      resolve(null);
    };
    reader.readAsDataURL(file);
  });
}

function exportTrades() {
  const blob = new Blob([JSON.stringify(trades, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'jeremy-trading-journal.json';
  link.click();
  URL.revokeObjectURL(url);
}

function importTrades(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const importedTrades = JSON.parse(String(reader.result));
    if (Array.isArray(importedTrades)) {
      persistTrades(importedTrades);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

render();
