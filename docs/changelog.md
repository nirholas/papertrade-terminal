---
title: Changelog
description: Release history for Papertrade Terminal, including the 0.2.0 MCP server, docs site and agent discovery files.
order: 11
---

# Changelog

The canonical history is [CHANGELOG.md](https://github.com/nirholas/papertrade-terminal/blob/main/CHANGELOG.md) in the repository.

## 0.2.0

Agent-ready release.

- Read-only MCP server at `/mcp` (Streamable HTTP, stateless) with nine tools: `list_markets`, `quote_open_position`, `quote_leverage_ladder`, `quote_close_position`, `get_wallet_positions`, `get_recent_trades`, `get_candles`, `get_protocol_status` and `build_trade_plan`.
- Deep links that open the terminal with market, side, margin and leverage prefilled, plus `?embed=1` for windowed use.
- Docs site at `/docs/` with search, per-page markdown twins, `llms.txt` and `llms-full.txt`.
- Agent discovery files: MCP server card, A2A agent card, API catalog, OpenAPI document, robots.txt and sitemap.
- Verified connection snippets for Claude, Codex, ChatGPT, Gemini CLI, Cursor, VS Code, Windsurf, Zed, Cline, Goose and Continue.

## 0.1.0 - 2026-10-10

Initial release.

- Wallet connect (EIP-6963 and `window.ethereum`), HyperEVM chain switch or add, balances, watch-only mode.
- SDK session keys with a signed `RegisterSessionKey`, expiry display and re-registration.
- Trading ticket with live marks, leverage up to 1000x, pre-trade panel, validations, confirm dialog and intent tracking.
- Live positions, batched close, history, pending orders and cancel.
- Candles with intervals, entry and bust lines, TradingView tab, HYPE/USDC pool chart.
- Deposit and withdraw flows with fees, route and minimums.
- KyberSwap swap with approve, minimum received and impact.
- Keyboard shortcuts, responsive mobile layout, light and dark themes, strict CSP.
