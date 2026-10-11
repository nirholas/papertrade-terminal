# AGENTS.md

Guidance for AI agents working in papertrade-terminal. This is an unofficial, non-custodial trading UI for Papertrade (HyperEVM, chain 999).

## Commands

```sh
npm run typecheck   # app + site/functions
npm test            # vitest
npm run build:site  # docs -> site/public/docs, discovery files, esbuild -> site/public (app.js, chunks/)
npm run dev:site    # wrangler pages dev (port 8788)
```

All three of typecheck, test and build:site must pass before you finish.

## Correctness rules

- Use papertrade-sdk for every protocol read, stream, signature and formula. Never reimplement its math (bust price, close estimate, fees, caps). If the SDK looks wrong, work around it minimally and report it; do not edit the SDK.
- Instrument open-interest and cap fields are base-asset quantities, not USD. Price them with `openInterestUsd`. Pass `markPriceRaw` to `validateOpen` and `prepareOpen` so the cap check runs.
- Prices are raw integers scaled by the instrument `priceScale`; margin is a wad (18 decimals); USDC on HyperEVM is 6 decimals.
- Query strings must be canonical (each param once, sorted). The SDK does this; keep going through it.
- Close batches are at most `MAX_CLOSE_BATCH` (12) positions per intent.
- Withdrawals: minimum 10 USDC after the activation fee; the HyperEVM route needs two signatures and a 0.1 USDC gas allowance.

## Safety rules

- Never sign or send a real transaction, intent, swap, deposit or withdrawal while developing or testing, and never handle a real private key. Test signing with a freshly generated throwaway key; the relayer must answer `403 unauthorized_intent`.
- Browser tests inject a throwaway EIP-1193 provider from a test script. Never ship one in `site/public`.
- Every on-chain or API string (token names, addresses, memos, error text) is untrusted: escape with `esc()` before it reaches `innerHTML`.
- The CSP forbids inline styles and scripts. Style through CSS classes or `el.style` from JS. A new third-party origin must be added to `site/public/_headers`.
- The MCP server (`site/functions/_lib/tools.ts`) is strictly read-only. A tool may read, quote or build an UNSIGNED plan and deep link. It must never sign, send funds, swap, bridge, mint, pay or place an order, and every tool needs `readOnlyHint: true`. Tool output that echoes operator notices or on-chain text must treat it as untrusted data.
- After changing a tool, run `node scripts/build-discovery.mjs` and commit the regenerated `.well-known/*` and `openapi.json` (`test/discovery.test.ts` fails on drift), and update `docs/mcp.md`.
- Do not commit, push, publish or deploy unless the owner asks.
- No mocks, fake data, TODOs or commented-out code. Never use em-dash or en-dash characters.

## Layout

| Path | Purpose |
| --- | --- |
| `src/app.ts` | Boot, header, banner, tabs, shortcuts |
| `src/state.ts` | Shared store and topic events |
| `src/wallet.ts` | EIP-6963 and EIP-1193 handling, chain switching |
| `src/session-store.ts` | Session key persistence |
| `src/account.ts` | Connect, stream, balances, intent tracking |
| `src/trade-ui.ts`, `src/trade-math.ts` | Order ticket, pre-trade preview, validation |
| `src/positions-ui.ts` | Positions, history, pending, close |
| `src/chart.ts`, `src/charts-ui.ts`, `src/embeds.ts` | Candles, pool chart, TradingView, DexTools |
| `src/fund-ui.ts` | Deposit and withdraw |
| `src/swap.ts`, `src/swap-ui.ts` | KyberSwap quote, approve, swap |
| `src/dialogs.ts`, `src/markets.ts`, `src/util.ts` | Shared UI and helpers |
| `src/deeplink.ts` | Prefill and embed query parsing (`?market=&side=&margin=&leverage=`, `?embed=1`) |
| `site/public/index.html`, `landing.*` | Landing page at `/` (live data via `/mcp`) |
| `site/public/app/index.html` | The terminal shell at `/app/` |
| `site/public` | Static output, `styles.css`, `_headers`, `_routes.json`, discovery and SEO files |
| `site/functions/mcp.ts`, `site/functions/_lib/` | MCP route, protocol core (`mcp.ts`) and tools (`tools.ts`) |
| `site/functions/index.ts` | Redirects prefill and embed links from `/` to `/app/` |
| `docs/`, `scripts/build-docs.mjs` | Documentation source and its renderer (also writes llms files and sitemap) |
| `scripts/build-discovery.mjs` | Generates server card, agent card, api-catalog and openapi.json from the tool registry |
| `site/functions/api/papertrade/[[path]].ts` | Same-origin API proxy |
| `test/` | vitest suites and recorded real fixtures |
| `scripts/build-site.mjs` | esbuild bundling |
