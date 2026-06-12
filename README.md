# Jeremy Trading Journal

A local-first trading journal built with plain HTML, CSS, and JavaScript. Log trades, track realized P&L, calculate win rate, search entries, and import/export your journal as JSON. A minimal Node backend is included for initiating cTrader OAuth connection setup.

## Features

- Add long or short trades with symbol, setup, entry, exit, size, fees, emotion, tags, and notes.
- Automatically calculate per-trade P&L and portfolio summary metrics.
- Search journal entries by symbol, setup, direction, tags, emotion, or notes.
- Persist trades in browser local storage for a quick no-backend workflow.
- Attach trade screenshots with the file picker or by pasting an image from the clipboard.
- Import and export the full journal as JSON.
- Responsive interface for desktop and mobile review sessions.

## Getting started

Start the development server, including the minimal backend routes:

```bash
npm run dev
```

## cTrader OAuth setup

The cTrader integration adds OAuth connection routes plus a JSON WebSocket client for app authentication, account discovery, and account authorization. Trade sync is not implemented yet. Configure these environment variables before opening `/auth/ctrader/start`:

```bash
export CTRADER_CLIENT_ID=your-client-id
export CTRADER_CLIENT_SECRET=your-client-secret
export CTRADER_REDIRECT_URI=http://localhost:5173/auth/ctrader/callback
export CTRADER_ENVIRONMENT=demo # or live
```

The backend redirects users to cTrader with account-read scope, exchanges the callback code for tokens, and stores the token pair encrypted at rest in `.data/ctrader-tokens.json`. The WebSocket client targets `demo.ctraderapi.com:5036` or `live.ctraderapi.com:5036` based on `CTRADER_ENVIRONMENT`. Set `CTRADER_TOKEN_ENCRYPTION_KEY` in deployed environments to use a dedicated token encryption secret; otherwise the backend derives encryption from `CTRADER_CLIENT_SECRET` for local development.

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
│   ├── ctrader-open-api.js
│   ├── main.js
│   ├── server.js
│   └── styles.css
└── README.md
```

## Notes

This app stores journal entries in the browser using `localStorage`. Export your journal regularly if you want a backup or need to move data to another browser. cTrader OAuth tokens are server-side secrets and are written to `.data/`, which is ignored by Git.
