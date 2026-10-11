# Concepts

The terminal does not reimplement protocol math. Every formula below comes from [papertrade-sdk](https://github.com/nirholas/papertrade-sdk), which is verified against recorded live positions. These notes explain what the numbers on screen mean.

## Raw prices and the price scale

Papertrade stores prices as integers. Each market has a `priceScale` (for example 10, 100 or 1000000) and a raw price is `price x priceScale`. The terminal and the MCP tools convert for display, so you always see USD prices. When you build your own integrations, never compare a raw price to a USD price.

## Margin is a wad

Margin and balances are 18-decimal fixed point numbers ("wads"). USDC on HyperEVM has 6 decimals, so deposits and withdrawals convert between the two. Open interest and cap fields on a market are in base-asset quantity, not USD, and are priced with the current mark.

## Notional and leverage

`notional = margin x leverage`. A $50 margin at 10x controls $500 of exposure. Leverage runs from 1x to the market maximum (up to 1000x). The relayer enforces a minimum margin, a minimum open notional, a maximum position notional per market, and per-side open interest caps. The live values come from the trading state, and the `get_protocol_status` tool reports them.

## Entry and the mark

Papertrade fills at the mark: the Hyperliquid best bid and offer mid that the protocol settles on. The order is accepted into a queue and processed by the relayer, so the fill price is the mark when it is processed, not the instant you press confirm.

## Bust price (liquidation price)

The bust price is where the position is liquidated and the entire margin is forfeited. It is computed with two roundings and a per-market buffer (`bustBufferRaw`, a few basis points):

- Long: `p0 = ceil(entry x (L - 1) / L)`, then `bust = floor(p0 x (1e18 + buffer) / 1e18)`
- Short: `p0 = floor(entry x (L + 1) / L)`, then `bust = ceil(p0 x (1e18 - buffer) / 1e18)`

The SDK's `liquidationPriceRaw` matches 205 of 205 recorded live positions. At 1000x the bust price is within a fraction of a percent of entry, so a tiny adverse move liquidates you.

## Deadband

When you win, Papertrade treats the exit as slightly worse than it was: by `entry / 50000` (0.002 percent). Moves smaller than this pay nothing. The pre-trade panel and the `quote_close_position` tool apply it for you.

## Impact haircut

Wins are scaled down by a factor that depends on the size of the move, the market's rate multiplier, its position multiplier and its reference notional:

```
kept = (1 - baseRate) / (1 + 1/(move x rateMultiplier) + referenceNotional / (1e6 x move x positionMultiplier))
```

Large wins on small positions keep a smaller fraction than moderate wins. Losses are paid 1:1 and are never haircut. The `keptFraction` field in `quote_close_position` is this factor.

## The 2% win fee

After deadband and haircut, a 2% fee is taken from the win. Losses pay no fee. Net PnL on a close is therefore `raw win, adjusted, minus 2%` for a win, the raw loss for a loss, and the full margin lost if the exit crosses the bust price.

## Session keys: trade, never withdraw

The wallet signs `RegisterSessionKey` once (30 day expiry, zero fee address). The session key then signs `OpenPosition`, `Close` and `CancelIntent`. The wallet itself must sign `WithdrawToCore`, `Stake`, `Unstake` and `Claim`. So a stolen or leaked session key can trade your balance but cannot move funds out. The terminal stores the key in `localStorage` and shows its expiry. Clear it from the Trade tab to revoke local access, and re-register when it expires.

## Intents, the queue and the relayer

Every action is a signed **intent** posted to `POST /intents`. The relayer validates it, queues it, and processes it against the live mark. States are `queued`, `prepared`, `confirmed`, and on failure `failed`, `expired` or `cancelled`. An intent can be cancelled only while it is `queued`. Each intent carries a nonce and a deadline one hour out. The terminal tracks outcomes on the wallet's live SSE stream (`/state/user/live`) and shows them as toasts and in the Pending table.

## Closing in batches

You can close one position or several at once. A single close intent carries at most 12 position ids (`MAX_CLOSE_BATCH`), so "close selected" splits larger selections into batches of 12.

## Funding

The first deposit pays a 1 USDC activation fee. A withdrawal has a 10 USDC minimum after fees, and the HyperEVM route needs two signatures and a 0.1 USDC gas allowance. The terminal shows route, fee and minimum before you sign.

> Papertrade allows up to 1000x leverage. A small move against the position liquidates it and the whole margin is lost. This is not financial advice. This project is unofficial and not affiliated with Papertrade.
