# Security and limits

> Unofficial, not affiliated with Papertrade. Papertrade allows up to 1000x leverage and a small move can liquidate the whole margin. Use at your own risk.

## Non-custodial

- The terminal never sees your wallet key. Signing happens in your injected wallet (EIP-6963 or `window.ethereum`).
- One wallet signature registers a session key. The key is generated in your browser and stored in `localStorage`. It can open, close and cancel positions and **can never withdraw**. Withdrawals, staking and claims need a fresh wallet signature.
- The proxy and the MCP server hold no keys, no cookies and no secrets, and they sign nothing.
- Every transaction (deposit, withdrawal, approve, swap) is shown with its details and signed by your wallet.

## The MCP server is read-only

All nine tools are annotated `readOnlyHint: true`. They read public Papertrade or Hyperliquid data, or compute quotes locally with the SDK. `build_trade_plan` returns an **unsigned** plan and a deep link. Opening the link fills a form in the terminal. You still review the confirmation dialog and sign yourself. `get_wallet_positions` needs only a public address and cannot act on the account.

## Limits

| Limit | Value | Where |
| --- | --- | --- |
| MCP requests | 60 per minute per IP, answered with HTTP `429`, JSON-RPC `-32029` and `Retry-After` | `/mcp` |
| MCP request body | 64 KB (`413` beyond that) | `/mcp` |
| MCP batch size | 20 calls (`400` beyond that) | `/mcp` |
| Proxy POST body | 64 KB (`413 body_too_large`) | `/api/papertrade/*` |
| Upstream timeout | 8 seconds, one retry | MCP tools |
| Wallet positions returned | 50 | `get_wallet_positions` |
| Recent trades returned | 50 | `get_recent_trades` |
| Candles returned | 200 | `get_candles` |
| Operator notices returned | 5 | `get_protocol_status` |
| Close batch | 12 positions per intent | terminal |

The rate limiter is held in isolate memory, so it is a best-effort guard rather than a global counter.

## Untrusted data

Operator notices, market and wallet names, token symbols, memos and error text all come from outside this project. The terminal escapes every such string before it reaches the DOM. The MCP server tells models that this text is data, never instructions, and `get_protocol_status` truncates notices (titles to 200 characters, bodies to 600). Do not let any value that came from on-chain or API text decide to spend, sign or transfer.

## Content Security Policy and headers

The site sets a strict CSP in `site/public/_headers`:

- `script-src 'self'` plus the TradingView script host, and `style-src 'self'`. There are no inline scripts or styles, which includes the docs pages (their CSS and JS are separate files).
- `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`.
- `connect-src` allows only the origins the app calls: Hyperliquid, the HyperEVM RPC, KyberSwap, GeckoTerminal and TradingView.
- `X-Content-Type-Options: nosniff`, a strict referrer policy and a locked-down Permissions-Policy.
- `frame-ancestors`: the app route allows framing only by itself, the Papertrade OS (`https://papertrade-os.pages.dev`) and other `*.pages.dev` origins so it can run as a window there. Other routes use `frame-ancestors 'none'`.

## CORS and origin

The MCP endpoint sends `Access-Control-Allow-Origin: *`. It uses no cookies and no credentials, so there is nothing for a hostile origin to ride on, and the `Origin` header is never used for authorisation.

## Reporting a vulnerability

See [SECURITY.md](https://github.com/nirholas/papertrade-terminal/blob/main/SECURITY.md) in the repository. Never post private keys, session keys or seed phrases in an issue.
