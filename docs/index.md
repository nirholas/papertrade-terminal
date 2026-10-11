---
title: Overview
description: Papertrade Terminal is an unofficial, non-custodial web terminal and read-only MCP server for Papertrade perps on HyperEVM.
order: 1
---

# Papertrade Terminal

Papertrade Terminal is an unofficial, non-custodial trading terminal for [Papertrade](https://papertrade.xyz), the fully on-chain synthetic perpetuals exchange on Hyperliquid's HyperEVM (chain 999). It ships as a static app plus a few small Cloudflare Pages Functions, and it also exposes a **read-only MCP server** so AI assistants can quote trades and hand you a prefilled order ticket.

> **Unofficial, not affiliated with Papertrade.** Papertrade allows up to 1000x leverage. A small move against a position liquidates it and the whole margin is lost. Nothing here is financial advice. Review every confirmation dialog before you sign.

## What you get

- **A browser terminal** at [/app/](/app/): candle chart, order ticket, positions, history, pending orders, deposit and withdraw, and a KyberSwap swap. Wallet keys never touch the page. See the [reference](/docs/reference/).
- **A session key model.** You sign one `RegisterSessionKey` message with your own wallet. After that a key stored in your browser signs orders. That key can open and close positions but can never withdraw. See [concepts](/docs/concepts/).
- **A read-only MCP server** at `https://papertrade-terminal.pages.dev/mcp` with nine tools: market data, exact quotes, wallet snapshots and unsigned trade plans. See the [MCP page](/docs/mcp/).
- **Deep links** that open the terminal with a trade prefilled, for example `https://papertrade-terminal.pages.dev/?market=BTC&side=long&margin=50&leverage=10`. The link only fills a form. You still review and sign in your own wallet.
- **Agent discovery files**: `llms.txt`, `llms-full.txt`, `openapi.json`, an MCP server card and an A2A agent card. See [agent discovery](/docs/agent-discovery/).

## How the pieces fit

```
browser (app.js)          AI assistant (Claude, Codex, ChatGPT, Gemini, Cursor ...)
   |                              |
   | /api/papertrade/*            | POST /mcp  (JSON-RPC, read-only tools)
   v                              v
Cloudflare Pages Functions  ----->  exchange.papertrade.xyz  (public Papertrade API)
                                    api.hyperliquid.xyz      (candles)
```

The proxy and the MCP server hold no keys and sign nothing. An assistant that wants to "place a trade" calls `build_trade_plan`, receives an unsigned plan and a deep link, and gives that link to you.

## Where to go next

| You want to | Read |
| --- | --- |
| Open the terminal and place a first trade | [Quickstart](/docs/quickstart/) |
| Understand bust price, deadband, haircut and fees | [Concepts](/docs/concepts/) |
| Connect Claude, Codex, ChatGPT, Gemini, Cursor or VS Code | [Connect your AI](/docs/connect-your-ai/) |
| Call the MCP tools directly | [MCP](/docs/mcp/) |
| Run your own copy on Cloudflare | [Self-hosting](/docs/self-hosting/) |
| Know exactly what is protected and limited | [Security and limits](/docs/security/) |

## Licence and source

Apache-2.0. Source: [github.com/nirholas/papertrade-terminal](https://github.com/nirholas/papertrade-terminal). Built on [papertrade-sdk](https://github.com/nirholas/papertrade-sdk), which supplies every protocol read, signature and settlement formula.
