import { PapertradeClient, priceToRaw, type TradingState } from 'papertrade-sdk';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { previewOpen } from '../src/trade-math.js';

const recorded = readFileSync(new URL('./fixtures/trading-state.json', import.meta.url), 'utf8');
const client = new PapertradeClient({ baseUrl: 'https://recorded.invalid', fetch: async () => new Response(recorded, { headers: { 'content-type': 'application/json' } }) });
const trading: Promise<TradingState> = client.tradingState();

describe('previewOpen on recorded live trading state', () => {
  it('puts the long bust below entry and the short bust above', async () => {
    const btc = (await trading).instruments.find((i) => i.symbol === 'BTC');
    expect(btc).toBeDefined();
    const long = previewOpen({ instrument: btc!, side: 'long', marginUsd: 20, leverage: 1000, markPrice: 100_000 });
    const short = previewOpen({ instrument: btc!, side: 'short', marginUsd: 20, leverage: 1000, markPrice: 100_000 });
    expect(long.bustPrice).toBeLessThan(long.entryPrice);
    expect(short.bustPrice).toBeGreaterThan(short.entryPrice);
    expect(long.notionalUsd).toBe(20_000);
  });

  it('matches the SDK entry rounding and orders scenarios from worst to best', async () => {
    const btc = (await trading).instruments.find((i) => i.symbol === 'BTC')!;
    const p = previewOpen({ instrument: btc, side: 'long', marginUsd: 100, leverage: 100, markPrice: 100_000.04 });
    expect(p.entryRaw).toBe(priceToRaw(100_000.04, Number(btc.priceScale)));
    const pnl = p.scenarios.map((s) => s.estimate.netPnlUsd);
    expect([...pnl].sort((a, b) => a - b)).toEqual(pnl);
    expect(p.scenarios.length).toBe(6);
  });

  it('forfeits the full margin when the exit is past the bust price', async () => {
    const btc = (await trading).instruments.find((i) => i.symbol === 'BTC')!;
    const p = previewOpen({ instrument: btc, side: 'short', marginUsd: 50, leverage: 500, markPrice: 100_000 });
    const worst = p.scenarios[0];
    expect(worst.estimate.netPnlUsd).toBeLessThan(0);
    expect(worst.estimate.netPnlUsd).toBeGreaterThanOrEqual(-50);
  });
});
