import { PapertradeClient, type AccountTrade, type Instrument, type PapertradeTrader, type SessionKey, type TradingState, type WalletState, type WalletStreamStatus } from 'papertrade-sdk';
import type { Address, EIP1193Provider, Hex, WalletClient } from 'viem';
import type { Side } from './trade-math.js';

export const API_BASE = '/api/papertrade';

export interface Account {
  address: Address;
  /** Wallet display name, or "Watching" for a read-only address. */
  name: string;
  /** Null when the address is only being watched. */
  provider: EIP1193Provider | null;
  walletClient: WalletClient | null;
}

export type IntentStatus = 'submitted' | 'queued' | 'confirmed' | 'failed';

export interface TrackedIntent {
  id: Hex;
  label: string;
  status: IntentStatus;
  at: number;
}

export interface Balances {
  usdc: bigint | null;
  hype: bigint | null;
}

export interface AppState {
  client: PapertradeClient;
  trading: TradingState | null;
  tradingError: string | null;
  /** Papertrade mark (Hyperliquid BBO mid) per instrument id. */
  marks: Record<number, number>;
  /** 24h change per instrument symbol as a fraction. */
  dayChange: Record<string, number>;
  marketId: number;
  side: Side;
  account: Account | null;
  chainId: number | null;
  wallet: WalletState | null;
  streamStatus: WalletStreamStatus | 'idle';
  session: SessionKey | null;
  trader: PapertradeTrader | null;
  balances: Balances;
  trades: AccountTrade[] | null;
  tradesCursor: string | null;
  tradesError: string | null;
  intents: Map<Hex, TrackedIntent>;
}

export type Topic = 'markets' | 'marks' | 'account' | 'wallet' | 'session' | 'balances' | 'trades' | 'intents' | 'market-select' | 'side' | 'chain';

export const S: AppState = {
  client: new PapertradeClient({ baseUrl: API_BASE, clientBuild: 'papertrade-terminal/0.1.0' }),
  trading: null,
  tradingError: null,
  marks: {},
  dayChange: {},
  marketId: 0,
  side: 'long',
  account: null,
  chainId: null,
  wallet: null,
  streamStatus: 'idle',
  session: null,
  trader: null,
  balances: { usdc: null, hype: null },
  trades: null,
  tradesCursor: null,
  tradesError: null,
  intents: new Map(),
};

const listeners = new Map<Topic, Set<() => void>>();

export function on(topic: Topic, fn: () => void): void {
  let set = listeners.get(topic);
  if (!set) listeners.set(topic, (set = new Set()));
  set.add(fn);
}

export function emit(topic: Topic): void {
  listeners.get(topic)?.forEach((fn) => {
    try {
      fn();
    } catch (err) {
      console.error(`listener for ${topic} failed`, err);
    }
  });
}

export function instruments(): Instrument[] {
  return S.trading?.instruments.filter((i) => !i.retired && !i.terminal) ?? [];
}

export function currentInstrument(): Instrument | null {
  return S.trading?.instruments.find((i) => i.id === S.marketId) ?? null;
}

export function instrumentById(id: number): Instrument | null {
  return S.trading?.instruments.find((i) => i.id === id) ?? null;
}

export function currentMark(): number | null {
  return S.marks[S.marketId] ?? null;
}
