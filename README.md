# Jeremy Trading Journal

A local-first trading journal built with plain HTML, CSS, and JavaScript. Log trades, track realized P&L, calculate win rate, search entries, and import/export your journal as JSON.

## Features

- Add long or short trades with symbol, setup, entry, exit, size, fees, emotion, tags, and notes.
- Automatically calculate per-trade P&L and portfolio summary metrics.
- Search journal entries by symbol, setup, direction, tags, emotion, or notes.
- Persist trades in browser local storage for a quick no-backend workflow.
- Import and export the full journal as JSON.
- Responsive interface for desktop and mobile review sessions.

## Getting started

Start the development server:

```bash
npm run dev
```

Run a JavaScript syntax check:

```bash
npm run check
```

## Project structure

```text
.
├── index.html
├── package.json
├── src
│   ├── main.js
│   └── styles.css
└── README.md
```

## Notes

This app stores data in the browser using `localStorage`. Export your journal regularly if you want a backup or need to move data to another browser.
