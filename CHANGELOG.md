# Changelog

## 0.2.0 - 2026-10-11

- Landing page at `/` with live markets and a live unsigned quote from the site's own MCP endpoint, connector snippets and a quickstart. The terminal moved to `/app/`.
- Read-only MCP server at `/mcp` (Streamable HTTP, stateless, JSON-RPC batches, SSE replies, CORS, rate limiting) with nine tools: markets, open and close quotes, leverage ladder, wallet positions, recent trades, candles, protocol status and an unsigned trade plan.
- Trade prefill deep links (`?market=&side=&margin=&leverage=`) that open the ticket behind a review banner, `?embed=1` for the Papertrade OS window, and an "Open in Papertrade OS" link.
- Leverage ladder in the pre-trade panel and number-key shortcuts for the Trade, Positions, Fund and Swap tabs.
- Agent discovery: MCP server card, A2A agent card, RFC 9727 api-catalog, OpenAPI 3.1, `llms.txt`, `llms-full.txt`, robots with Content-Signal, sitemap, Link headers, `server.json` and `glama.json`.
- Documentation site at `/docs/` rendered from `docs/*.md` with search, per-page markdown twins and a Connect your AI guide.
- `frame-ancestors` on `/app/` now allows Papertrade OS and Pages subdomains; every other security header is unchanged.

## 0.1.0 - 2026-10-10

Initial release.

- Wallet connect (EIP-6963 and `window.ethereum`), HyperEVM chain switch/add, balances, watch-only mode.
- SDK session keys with a signed `RegisterSessionKey`, expiry display and re-registration.
- Trading ticket with live marks, leverage up to 1000x, pre-trade panel, validations, confirm dialog and intent tracking.
- Live positions, batched close, history, pending orders and cancel.
- Candles with intervals, entry and bust lines, TradingView tab, HYPE/USDC pool chart.
- Deposit and withdraw flows with fees, route and minimums.
- KyberSwap swap with approve, min received and impact.
- Keyboard shortcuts, responsive mobile layout, light and dark themes, strict CSP.
