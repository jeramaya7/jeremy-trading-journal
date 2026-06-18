# Jeremy Trading Journal

A local-first trading journal built with plain HTML, CSS, and JavaScript. Log trades, track realized P&L, calculate win rate, search entries, and import/export your journal as JSON. A minimal Node backend is included for initiating cTrader OAuth connection setup and syncing closed cTrader deals into the journal.

## Features

- Add long or short trades with symbol, setup, entry, exit, size, fees, tags, and notes.
- Automatically calculate per-trade P&L and portfolio summary metrics.
- Search journal entries by symbol, setup, direction, tags, or notes.
- Persist trades in browser local storage for a quick no-backend workflow.
- Attach trade screenshots with the file picker or by pasting an image from the clipboard.
- Import and export the full journal as JSON.
- Connect cTrader, manually sync closed deals, or leave Auto Sync on so new cTrader trades appear after startup and recurring background checks.
- Keep cTrader duplicate protection by source trade ID so repeated syncs do not create duplicate journal entries.
- Responsive interface for desktop and mobile review sessions.

## Getting started

Start the development server, including the minimal backend routes:

```bash
npm run dev
```

## cTrader OAuth and Auto Sync setup

The cTrader integration adds OAuth connection routes plus a JSON WebSocket client for app authentication, account discovery, account authorization, and closed-deal journal sync. Configure these environment variables before opening `/auth/ctrader/start`:

```bash
export CTRADER_CLIENT_ID=your-client-id
export CTRADER_CLIENT_SECRET=your-client-secret
export CTRADER_REDIRECT_URI=http://localhost:5173/auth/ctrader/callback
export CTRADER_ENVIRONMENT=demo # or live
export CTRADER_TOKEN_ENCRYPTION_KEY=use-a-long-random-secret-in-production
```

The backend redirects users to cTrader with account-read scope, exchanges the callback code for tokens, and stores the token pair encrypted at rest in `.data/ctrader-tokens.json`. The WebSocket client targets `demo.ctraderapi.com:5036` or `live.ctraderapi.com:5036` based on `CTRADER_ENVIRONMENT`. Set `CTRADER_TOKEN_ENCRYPTION_KEY` in deployed environments to use a dedicated token encryption secret; otherwise the backend derives encryption from `CTRADER_CLIENT_SECRET` for local development.

Auto Sync is on by default in the browser UI. On app startup, the journal checks `https://jeremy-trading-journal.onrender.com/api/ctrader/status`; if cTrader is connected, it fetches `https://jeremy-trading-journal.onrender.com/api/ctrader/journal-preview`, imports only new trades, records the last sync time, and continues polling in the background. Turn the Auto Sync checkbox off if you prefer to sync only with the manual **Sync cTrader** button.

### Production deployment architecture

GitHub Pages can host the static journal files, but it cannot run the Node backend in `src/server.js`, cannot keep cTrader OAuth secrets, and cannot store encrypted OAuth tokens. A production cTrader sync deployment therefore needs two pieces:

1. **Static frontend**: GitHub Pages can serve `index.html`, `src/main.js`, `src/styles.css`, and other browser assets.
2. **Node backend**: deploy this repository as a Node service on a platform that supports long-running Node processes and persistent secret storage, such as Render, Railway, Fly.io, a VPS, or another Node host. The service must run `npm install` and `npm run server` (or `node src/server.js`) with `PORT` supplied by the host.

Configure the cTrader application redirect URI to point at the deployed Render backend callback:

```text
https://jeremy-trading-journal.onrender.com/auth/ctrader/callback
```

Then set the backend environment variables on the Node host:

```bash
CTRADER_CLIENT_ID=your-client-id
CTRADER_CLIENT_SECRET=your-client-secret
CTRADER_REDIRECT_URI=https://jeremy-trading-journal.onrender.com/auth/ctrader/callback
CTRADER_ENVIRONMENT=demo # or live
CTRADER_TOKEN_ENCRYPTION_KEY=use-a-long-random-secret-in-production
CTRADER_TOKEN_STORE_DIR=/persistent/private/data # optional, but recommended if the host has a mounted disk
JOURNAL_FRONTEND_ORIGIN=https://jeramaya7.github.io # optional CORS allow-origin; defaults to *
```

The static frontend now defaults to the live Render backend at `https://jeremy-trading-journal.onrender.com`, so cTrader status checks, manual syncs, Auto Sync runs, and raw deal requests do not use relative GitHub Pages paths. If you need to test against another backend, define `window.JEREMY_TRADING_JOURNAL_BACKEND_URL` before `src/main.js` loads in `index.html` or store `jeremy-trading-journal:backend-base-url:v1` in `localStorage`.

The production UI includes a cTrader backend diagnostics panel next to the Auto Sync controls. Use it to confirm:

- **Backend URL**: must be `https://jeremy-trading-journal.onrender.com` (or an intentional override), not `https://jeramaya7.github.io` and not the GitHub Pages project URL.
- **Status check URL**: must be `https://jeremy-trading-journal.onrender.com/api/ctrader/status` (or the equivalent intentional override).
- **Connection status**: shows whether the backend was reached and whether cTrader OAuth tokens are connected.

The Node backend must be hosted anywhere that can run `node src/server.js` continuously with private environment variables and persistent token storage. GitHub Pages is only for static files and cannot be the cTrader backend. A correct production path is:

```text
GitHub Pages frontend -> https://jeremy-trading-journal.onrender.com/api/ctrader/status -> encrypted OAuth tokens -> cTrader Open API WebSocket
```

### cTrader production endpoint checklist

Verify these routes against the deployed Node backend URL before sharing the GitHub Pages frontend:

- From a terminal, verify the exact status endpoint returns JSON and CORS headers for GitHub Pages:

  ```bash
  curl -i -H 'Origin: https://jeramaya7.github.io' -H 'Accept: application/json' https://jeremy-trading-journal.onrender.com/api/ctrader/status
  ```

- `GET /api/ctrader/status` returns JSON. It should return `connected: false` with a clear error before OAuth tokens exist, and `connected: true` after connection.
- `GET /auth/ctrader/start` redirects to cTrader OAuth.
- `GET /auth/ctrader/callback` is the redirect URI registered with cTrader and stores encrypted tokens after OAuth succeeds.
- `GET /api/ctrader/journal-preview` returns JSON preview trades for import.
- `GET /api/ctrader/deals` returns JSON raw cTrader deals and stores the raw response server-side for audit/debugging.

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
│   ├── backend-api.js
│   ├── ctrader-journal-mapper.js
│   ├── ctrader-open-api.js
│   ├── ctrader-sync.js
│   ├── main.js
│   ├── server.js
│   └── styles.css
└── test
    ├── backend-api.test.mjs
    ├── ctrader-auth.test.mjs
    ├── ctrader-deals.test.mjs
    ├── ctrader-import-ui.test.mjs
    ├── ctrader-open-api.test.mjs
    ├── ctrader-sync.test.mjs
    └── screenshot-support.test.mjs
```

## Notes

This app stores journal entries, Auto Sync preference, and last sync time in the browser using `localStorage`. Export your journal regularly if you want a backup or need to move data to another browser. cTrader OAuth tokens are server-side secrets and are written to `.data/`, which is ignored by Git.
