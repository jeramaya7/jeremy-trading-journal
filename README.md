# Jeremy Trading Journal

A local-first trading journal built with plain HTML, CSS, and JavaScript. Log trades, track realized P&L, calculate win rate, search entries, and import/export your journal as JSON.

## Features

- Add long or short trades with symbol, setup, entry, exit, size, stop loss, account size, fees, emotion, tags, and notes.
- Automatically calculate per-trade P&L, risk dollars, risk percentage, R-multiple, and portfolio summary metrics.
- Search journal entries by symbol, setup, direction, tags, emotion, or notes.
- Persist trades in browser local storage for a quick no-backend workflow.
- Attach trade screenshots with the file picker or by pasting an image from the clipboard.
- Import and export the full journal as JSON.
- Responsive interface for desktop and mobile review sessions.

## Getting started

Start the development server:

```bash
npm run dev
```

Run automated tests and a JavaScript syntax check:

```bash
npm run test
npm run check
```

## Project structure

```text
.
├── index.html
├── package.json
├── src
│   ├── main.js
│   ├── styles.css
│   └── tradeMetrics.js
├── test
│   ├── screenshot-support.test.mjs
│   └── tradeMetrics.test.mjs
└── README.md
```

## Notes

This app stores data in the browser using `localStorage`. Export your journal regularly if you want a backup or need to move data to another browser.
