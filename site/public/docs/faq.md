# FAQ

## Is this official?

No. Papertrade Terminal is an unofficial community project and is not affiliated with Papertrade. It uses Papertrade's public API and verified protocol math through papertrade-sdk.

## Can it take my funds?

No. It is non-custodial. Your wallet signs everything that moves funds. The session key stored in your browser can trade but can never withdraw.

## Can an AI assistant place trades for me?

No. The MCP server is read-only. An assistant can quote a trade and call `build_trade_plan`, which returns an unsigned plan and a link. You open the link, connect your wallet, review the confirmation and sign.

## What does the deep link do?

`https://papertrade-terminal.pages.dev/?market=BTC&side=long&margin=50&leverage=10` opens the terminal with the ticket prefilled and a review banner. It only fills a form. See [reference](https://papertrade-terminal.pages.dev/docs/reference/#deep-link-parameters).

## How risky is 1000x leverage?

Very. At 1000x a move of roughly a tenth of a percent against you reaches the bust price and the full margin is lost. The pre-trade panel and the `quote_leverage_ladder` tool show the exact bust price for each leverage step. This is not financial advice.

## What are the fees?

A 2% fee on winning closes, after the deadband and impact haircut. Losses pay no fee. The first deposit pays a 1 USDC activation fee, and withdrawals show their own fee and minimum. HYPE gas is needed for deposits, approvals and swaps. See [concepts](https://papertrade-terminal.pages.dev/docs/concepts/).

## Why is my order not filled instantly?

Orders are signed intents that go into the relayer queue and fill at the mark when processed. Watch the Pending list. You can cancel while the intent is still queued.

## Why did the relayer reject my order?

Common reasons: margin below the minimum, notional outside the allowed range, a per-side open interest cap reached, the market paused or close-only, or no active session key. `quote_open_position` returns `valid: false` with the reason before you try, and `get_protocol_status` shows pauses and operator notices.

## Which wallets work?

Any wallet that injects an EIP-1193 provider. The terminal discovers wallets with EIP-6963 and falls back to `window.ethereum`. It switches to or adds HyperEVM (chain 999).

## How long does a session key last?

30 days. The terminal shows the expiry and asks you to re-register when it lapses. Clear it any time from the Trade tab.

## Does the MCP server need an API key?

No. There is no authentication. It is rate limited to 60 requests per minute per IP.

## Which AI clients work?

Anything that supports MCP over Streamable HTTP: Claude, Codex, ChatGPT developer mode, Gemini CLI, Cursor, VS Code, Windsurf, Zed, Cline, Goose and Continue. Clients without MCP can use the OpenAPI spec. See [Connect your AI](https://papertrade-terminal.pages.dev/docs/connect-your-ai/).

## Can I embed the terminal?

Yes. Add `?embed=1` to hide marketing chrome. The app route allows framing by the Papertrade OS and other `*.pages.dev` hosts. See [security](https://papertrade-terminal.pages.dev/docs/security/).

## Can I run my own copy?

Yes, on Cloudflare Pages. See [self-hosting](https://papertrade-terminal.pages.dev/docs/self-hosting/).

## Where do I report a problem?

Open an issue at [github.com/nirholas/papertrade-terminal/issues](https://github.com/nirholas/papertrade-terminal/issues). Security issues go through SECURITY.md.
