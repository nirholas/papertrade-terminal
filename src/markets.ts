import { fetchDayContext } from 'papertrade-sdk';
import { apiErrorMessage } from './util.js';
import { S, emit, instruments } from './state.js';

const TRADING_REFRESH_MS = 30_000;
const MARK_REFRESH_MS = 2_500;
const DAY_REFRESH_MS = 60_000;

/** Load live instruments, limits and which relayer actions are accepted. */
export async function loadTrading(): Promise<void> {
  try {
    S.trading = await S.client.tradingState();
    S.tradingError = null;
    if (!instruments().some((i) => i.id === S.marketId)) S.marketId = instruments()[0]?.id ?? 0;
  } catch (err) {
    S.tradingError = apiErrorMessage(err);
  }
  emit('markets');
}

let markBusy = false;

async function loadMarks(): Promise<void> {
  if (markBusy || document.hidden) return;
  markBusy = true;
  try {
    const ids = instruments().map((i) => i.id);
    const results = await Promise.all(
      ids.map(async (instrumentId) => {
        const { points } = await S.client.priceHistory({ instrumentId, lookbackMs: 20_000, intervalMs: 1000 });
        return [instrumentId, points[points.length - 1]?.price] as const;
      }),
    );
    for (const [id, price] of results) if (typeof price === 'number') S.marks[id] = price;
    emit('marks');
  } catch {
    /* the next tick retries; a stale mark keeps its last value and the header shows the stream state */
  } finally {
    markBusy = false;
  }
}

async function loadDay(): Promise<void> {
  try {
    const ctx = await fetchDayContext();
    for (const inst of instruments()) {
      const c = ctx[inst.symbol];
      const prev = Number(c?.prevDayPx);
      const mid = Number(c?.midPx ?? c?.markPx);
      if (prev > 0 && mid > 0) S.dayChange[inst.symbol] = mid / prev - 1;
    }
    emit('marks');
  } catch {
    /* 24h change is decoration; omit it when Hyperliquid is unreachable */
  }
}

export function startMarkets(): void {
  void loadTrading().then(() => {
    void loadMarks();
    void loadDay();
  });
  window.setInterval(() => void loadTrading(), TRADING_REFRESH_MS);
  window.setInterval(() => void loadMarks(), MARK_REFRESH_MS);
  window.setInterval(() => void loadDay(), DAY_REFRESH_MS);
}
