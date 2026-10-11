import { PapertradeClient, PapertradeTrader, createSessionKey } from 'papertrade-sdk';
import { readFileSync } from 'node:fs';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

const recorded = readFileSync(new URL('./fixtures/trading-state.json', import.meta.url), 'utf8');
const client = new PapertradeClient({ baseUrl: 'https://recorded.invalid', fetch: async () => new Response(recorded, { headers: { 'content-type': 'application/json' } }) });

function throwawayTrader() {
  const wallet = privateKeyToAccount(generatePrivateKey());
  const session = createSessionKey(3600);
  const mem = new Map<string, string>();
  const trader = new PapertradeTrader({ user: wallet.address, wallet, session, client, nonceStorage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) } });
  return { wallet, session, trader };
}

describe('intent signing with throwaway keys (nothing is submitted)', () => {
  it('signs RegisterSessionKey with the wallet and the open with the session key', async () => {
    const { wallet, session, trader } = throwawayTrader();
    const trading = await client.tradingState();

    const { prepared: register } = await trader.prepareRegisterSession(session);
    expect(register.intentId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(register.summary.length).toBeGreaterThan(10);
    expect(JSON.stringify(register.signed)).toContain(wallet.address.toLowerCase());

    const open = await trader.prepareOpen({ market: 'BTC', side: 'long', marginUsd: 20, leverage: 600 }, trading);
    expect(open.intentId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(open.summary).toMatch(/BTC/);
    expect(open.intentId).not.toBe(register.intentId);
  });

  it('rejects trades below the live minimums before anything is signed', async () => {
    const { trader } = throwawayTrader();
    const trading = await client.tradingState();
    expect(() => trader.validateOpen({ market: 'BTC', side: 'long', marginUsd: 5, leverage: 1000 }, trading)).toThrow();
    expect(() => trader.validateOpen({ market: 'BTC', side: 'long', marginUsd: 20, leverage: 10 }, trading)).toThrow(/Minimum position value/);
  });
});
