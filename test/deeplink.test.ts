import { readFileSync } from 'node:fs';
import { PapertradeClient } from 'papertrade-sdk';
import { describe, expect, it } from 'vitest';
import { parseLink, stripPrefill } from '../src/deeplink.js';
import { leverageLadder } from '../src/trade-math.js';
import { tradeLink } from '../site/functions/_lib/tools.js';

describe('parseLink', () => {
  it('reads a full prefill link', () => {
    expect(parseLink('?market=BTC&side=long&margin=50&leverage=10')).toEqual({ prefill: { market: 'BTC', side: 'long', margin: '50', leverage: 10 }, embed: false });
  });

  it('round-trips the link the MCP plan emits', () => {
    const url = new URL(tradeLink('https://t.test', { market: 'eth', side: 'short', marginUsd: 25.5, leverage: 3 }));
    expect(parseLink(url.search).prefill).toEqual({ market: 'ETH', side: 'short', margin: '25.5', leverage: 3 });
  });

  it('drops invalid or out-of-range values instead of trusting them', () => {
    const { prefill } = parseLink('?market=BTC%3Cscript%3E&side=sideways&margin=-5&leverage=5000');
    expect(prefill).toBeNull();
    expect(parseLink('?margin=1e9&leverage=0').prefill).toBeNull();
    expect(parseLink('?margin=99999999999').prefill).toBeNull();
  });

  it('detects embed mode on its own', () => {
    expect(parseLink('?embed=1')).toEqual({ prefill: null, embed: true });
    expect(parseLink('?embed=0').embed).toBe(false);
  });
});

describe('stripPrefill', () => {
  it('removes only the prefill keys', () => {
    expect(stripPrefill('?market=BTC&side=long&embed=1')).toBe('?embed=1');
    expect(stripPrefill('?market=BTC&margin=5')).toBe('');
  });
});

describe('leverageLadder', () => {
  const recorded = readFileSync(new URL('./fixtures/trading-state.json', import.meta.url), 'utf8');
  const client = new PapertradeClient({ baseUrl: 'https://recorded.invalid', fetch: async () => new Response(recorded, { headers: { 'content-type': 'application/json' } }) });

  it('narrows room to liquidation as leverage grows and respects the market cap', async () => {
    const btc = (await client.tradingState()).instruments.find((i) => i.symbol === 'BTC')!;
    const steps = leverageLadder({ instrument: btc, side: 'long', markPrice: 100_000, levels: [100, 1, 10, 10, 5000] });
    expect(steps.map((s) => s.leverage)).toEqual([1, 10, 100]);
    expect(steps[0].bustDistance).toBeGreaterThan(steps[1].bustDistance);
    expect(steps[1].bustDistance).toBeGreaterThan(steps[2].bustDistance);
    expect(steps.every((s) => s.bustPrice < 100_000)).toBe(true);
  });
});
