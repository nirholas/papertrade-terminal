# Quickstart

You need an injected browser wallet (any EIP-6963 wallet, or `window.ethereum`) and USDC on HyperEVM. You do not need an account or an API key.

> **Unofficial, not affiliated with Papertrade.** Leverage up to 1000x can lose your whole margin. Start small.

## 1. Look around read-only

Open [/app/](https://papertrade-terminal.pages.dev/app/). Charts, marks and markets load with no wallet. To browse any account without connecting, add `?watch=` and a public address:

```
https://papertrade-terminal.pages.dev/app/?watch=0xYourAddress
```

## 2. Connect and switch chain

Click **Connect**, pick your wallet, and approve. If the wallet is on another chain the terminal offers to switch to or add HyperEVM (chain 999). The header then shows your address and your USDC and HYPE balances. HYPE pays gas for deposits and swaps. Trading itself is gas-free.

## 3. Fund your Papertrade balance

Open the **Fund** tab. The deposit flow computes your personal deposit proxy, shows the fee and minimum, and asks your wallet to sign each step. The first deposit pays a one-time activation fee of 1 USDC. Withdrawals live in the same tab and show route, fee and minimum before you sign.

## 4. Enable trading

On the **Trade** tab choose **Enable trading**. A plain-language summary explains what you are authorising, then your wallet signs one `RegisterSessionKey` message. The terminal generates a session key in your browser, registers it for 30 days and stores it in `localStorage`. You can clear it any time from the same control. The key can open, close and cancel. It can never withdraw.

## 5. Place an order

1. Pick a market (`M` cycles markets).
2. Choose long or short (`B` or `S`).
3. Enter margin in USD (`/` focuses the field) and set leverage (slider, or `[` and `]`).
4. Read the pre-trade panel: notional, entry, **bust price**, and what a close pays at several price moves after deadband, impact haircut and the 2% win fee.
5. Press **Review**, check the confirmation dialog, and confirm. The session key signs the intent and the terminal submits it through the same-origin proxy.
6. Watch the **Pending** list. The order fills at the mark when the relayer processes it. You can cancel it while it is still queued.

## 6. Open a prefilled trade from a link

Any link of this form opens the terminal with the ticket filled in and a review banner. Nothing is signed or sent until you confirm.

```
https://papertrade-terminal.pages.dev/?market=BTC&side=long&margin=50&leverage=10
```

See [reference](https://papertrade-terminal.pages.dev/docs/reference/#deep-link-parameters) for every parameter.

## 7. Ask an AI to quote it first

Connect an assistant to the MCP server and ask it to quote the trade, show the ladder of leverage steps, and build the plan. See [Connect your AI](https://papertrade-terminal.pages.dev/docs/connect-your-ai/). The assistant cannot place the order. It returns the link from step 6 for you to open.

## Run it locally

```sh
npm install ../papertrade-sdk-0.1.0.tgz viem
npm install
npm run dev:site
```

This builds the docs and the app, then serves everything with `wrangler pages dev` on http://localhost:8788. See [self-hosting](https://papertrade-terminal.pages.dev/docs/self-hosting/).
