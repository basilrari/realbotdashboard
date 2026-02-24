# Polymarket Bot Dashboard

TradingView-style dark dashboard for the Polymarket BTC 5m bot. Built with Next.js 15 (App Router), Tailwind, and Recharts.

## Setup

1. Install: `npm install`
2. Copy env: `cp .env.local.example .env.local`
3. Set **NEXT_PUBLIC_BOT_URL** to your Rust bot’s `/state` JSON endpoint, e.g.:
   - `http://localhost:8080/state`
   - `https://your-domain.com/state`

## Run

- Dev: `npm run dev`
- Build: `npm run build`
- Start: `npm start`

## Deploy (Vercel)

1. Push to GitHub and import the repo in Vercel.
2. Add env var: `NEXT_PUBLIC_BOT_URL` = your bot’s `/state` URL.
3. Deploy. The dashboard will poll `/state` every 5 seconds.

## Features

- Live equity and PnL, win rate, total trades
- Equity curve (from trade history)
- Current market card with link to Polymarket
- Live prices: YES / NO / Chainlink / Binance (vs price-to-beat)
- Uptime: total, paused, RTDS stale, no-market
- Recent trades table (last 20)
- Responsive, dark theme, teal accents
