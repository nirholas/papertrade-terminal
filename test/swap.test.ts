import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HYPE_TOKEN, USDC_TOKEN, SwapError, buildSwap, fetchQuote, minReceived, parseQuote, priceImpact, shortVenue } from '../src/swap.js';

const recorded = JSON.parse(readFileSync(new URL('./fixtures/kyber-routes-hype-usdc.json', import.meta.url), 'utf8')) as { code: number; data: Parameters<typeof parseQuote>[0] };

const ok = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('swap quote parsing on a recorded KyberSwap HyperEVM route', () => {
  it('extracts amounts, venues and router', () => {
    const q = parseQuote(recorded.data);
    expect(q.amountIn).toBe(10n ** 18n);
    expect(q.amountOut).toBeGreaterThan(0n);
    expect(q.venues.length).toBeGreaterThan(0);
    expect(q.routerAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('fetchQuote requests the HyperEVM routes endpoint with the token pair', async () => {
    let seen = '';
    const q = await fetchQuote({
      tokenIn: HYPE_TOKEN,
      tokenOut: USDC_TOKEN,
      amountIn: 10n ** 18n,
      fetchImpl: async (input) => {
        seen = String(input);
        return ok(recorded)();
      },
    });
    expect(seen).toContain('/hyperevm/api/v1/routes');
    expect(seen).toContain(`tokenOut=${USDC_TOKEN.address}`);
    expect(q.amountOut).toBe(BigInt(recorded.data.routeSummary.amountOut));
  });

  it('reports upstream failures as SwapError', async () => {
    await expect(fetchQuote({ tokenIn: HYPE_TOKEN, tokenOut: USDC_TOKEN, amountIn: 1n, fetchImpl: ok({ code: 4008, message: 'route not found' }, 400) })).rejects.toBeInstanceOf(SwapError);
    await expect(fetchQuote({ tokenIn: HYPE_TOKEN, tokenOut: USDC_TOKEN, amountIn: 1n, fetchImpl: ok({}, 429) })).rejects.toThrow(/rate limiting/);
  });

  it('refuses a build whose router differs from the quote', async () => {
    const q = parseQuote(recorded.data);
    const build = ok({ code: 0, data: { amountOut: '1', data: '0x', routerAddress: '0x0000000000000000000000000000000000000001', gas: '1', gasUsd: '0' } });
    await expect(buildSwap({ quote: q, sender: '0x0000000000000000000000000000000000000002', slippageBps: 50, fetchImpl: build })).rejects.toThrow(/router changed/);
  });

  it('attaches value only for native input', async () => {
    const q = parseQuote(recorded.data);
    const build = ok({ code: 0, data: { amountOut: '1000000', data: '0xabcd', routerAddress: q.routerAddress, gas: '300000', gasUsd: '0.01' } });
    const built = await buildSwap({ quote: q, sender: '0x0000000000000000000000000000000000000002', slippageBps: 100, fetchImpl: build });
    expect(built.value).toBe(q.amountIn);
    expect(built.minReceived).toBe(990000n);
  });
});

describe('swap helpers', () => {
  it('computes min received and price impact', () => {
    expect(minReceived(1_000_000n, 50)).toBe(995_000n);
    expect(priceImpact({ amountInUsd: 100, amountOutUsd: 98 })).toBeCloseTo(0.02);
    expect(priceImpact({ amountInUsd: 100, amountOutUsd: 101 })).toBe(0);
    expect(priceImpact({ amountInUsd: 0, amountOutUsd: 0 })).toBe(0);
  });
  it('names venues readably', () => {
    expect(shortVenue('uniswap-v3')).toBe('uniswap V3');
  });
});
