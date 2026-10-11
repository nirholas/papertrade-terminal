import { CandlestickSeries, ColorType, CrosshairMode, LineStyle, createChart, type CandlestickData, type IChartApi, type IPriceLine, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import { fetchCandles, type Candle, type CandleInterval } from 'papertrade-sdk';

export const CHART_INTERVALS: { value: CandleInterval; label: string; ms: number }[] = [
  { value: '1m', label: '1m', ms: 60_000 },
  { value: '5m', label: '5m', ms: 300_000 },
  { value: '15m', label: '15m', ms: 900_000 },
  { value: '1h', label: '1h', ms: 3_600_000 },
  { value: '4h', label: '4h', ms: 14_400_000 },
  { value: '1d', label: '1D', ms: 86_400_000 },
];

const WS_URL = 'wss://api.hyperliquid.xyz/ws';
const BARS = 500;

export interface ChartLine {
  id: string;
  price: number;
  title: string;
  kind: 'entry-long' | 'entry-short' | 'bust' | 'mark';
}

export type ChartStatus = 'loading' | 'live' | 'polling' | 'error';

interface WsCandle {
  t: number;
  s: string;
  i: string;
  o: string;
  h: string;
  l: string;
  c: string;
}

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

const toBar = (c: Candle): CandlestickData<UTCTimestamp> => ({ time: Math.floor(c.time / 1000) as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close });

/**
 * Hyperliquid candles for the perp Papertrade tracks, drawn with TradingView
 * Lightweight Charts. History comes from the SDK's `fetchCandles`; the forming
 * candle streams over the Hyperliquid websocket, with a REST poll as the
 * failsafe whenever the socket is down.
 */
export class CandleChart {
  private chart: IChartApi;
  private series: ISeriesApi<'Candlestick'>;
  private coin = '';
  private interval: CandleInterval = '15m';
  private priceScale = 10;
  private ws: WebSocket | null = null;
  private pollTimer: number | undefined;
  private retryTimer: number | undefined;
  private retries = 0;
  private generation = 0;
  private lines = new Map<string, IPriceLine>();
  private lastBar: CandlestickData<UTCTimestamp> | null = null;
  private themeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  private readonly onTheme = () => this.applyTheme();

  constructor(
    private host: HTMLElement,
    private onStatus: (status: ChartStatus, detail?: string) => void,
    private onPrice: (price: number) => void,
  ) {
    this.chart = createChart(host, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: cssVar('--muted', '#8b93a7'), fontFamily: 'inherit', attributionLogo: false },
      grid: { vertLines: { color: cssVar('--grid', '#1d2230') }, horzLines: { color: cssVar('--grid', '#1d2230') } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
    });
    this.series = this.chart.addSeries(CandlestickSeries, {});
    this.applyTheme();
    this.themeQuery.addEventListener('change', this.onTheme);
  }

  private applyTheme() {
    const up = cssVar('--long', '#20c997');
    const down = cssVar('--short', '#f0616d');
    this.chart.applyOptions({
      layout: { textColor: cssVar('--muted', '#8b93a7') },
      grid: { vertLines: { color: cssVar('--grid', '#1d2230') }, horzLines: { color: cssVar('--grid', '#1d2230') } },
    });
    this.series.applyOptions({ upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down });
  }

  async load(coin: string, interval: CandleInterval, priceScale: number) {
    const gen = ++this.generation;
    this.coin = coin;
    this.interval = interval;
    this.priceScale = priceScale;
    this.closeSocket();
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.pollTimer);
    this.onStatus('loading');
    const decimals = Math.max(0, Math.round(Math.log10(priceScale)));
    this.series.applyOptions({ priceFormat: { type: 'price', precision: decimals, minMove: 1 / priceScale } });
    const ms = CHART_INTERVALS.find((i) => i.value === interval)?.ms ?? 900_000;
    try {
      const candles = await fetchCandles(coin, interval, Date.now() - ms * BARS);
      if (gen !== this.generation) return;
      if (!candles.length) throw new Error(`Hyperliquid returned no ${interval} candles for ${coin}.`);
      const bars = candles.map(toBar);
      this.series.setData(bars);
      this.lastBar = bars[bars.length - 1];
      this.onPrice(this.lastBar.close);
      this.chart.timeScale().fitContent();
      this.chart.timeScale().scrollToPosition(4, false);
      this.connect(gen);
    } catch (err) {
      if (gen !== this.generation) return;
      this.onStatus('error', err instanceof Error ? err.message : String(err));
    }
  }

  private apply(bar: CandlestickData<UTCTimestamp>) {
    if (this.lastBar && bar.time < this.lastBar.time) return;
    this.series.update(bar);
    this.lastBar = bar;
    this.onPrice(bar.close);
  }

  private connect(gen: number) {
    if (gen !== this.generation) return;
    const ws = new WebSocket(WS_URL);
    this.ws = ws;
    ws.addEventListener('open', () => {
      if (gen !== this.generation) return ws.close();
      this.retries = 0;
      window.clearInterval(this.pollTimer);
      ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'candle', coin: this.coin, interval: this.interval } }));
      this.onStatus('live');
    });
    ws.addEventListener('message', (event) => {
      if (gen !== this.generation) return;
      try {
        const msg = JSON.parse(String(event.data)) as { channel?: string; data?: WsCandle };
        if (msg.channel !== 'candle' || !msg.data || msg.data.s !== this.coin || msg.data.i !== this.interval) return;
        const c = msg.data;
        this.apply({ time: Math.floor(c.t / 1000) as UTCTimestamp, open: Number(c.o), high: Number(c.h), low: Number(c.l), close: Number(c.c) });
      } catch {
        /* ignore frames that are not candle updates */
      }
    });
    const down = () => {
      if (gen !== this.generation || this.ws !== ws) return;
      this.ws = null;
      this.startPolling(gen);
      const delay = Math.min(30_000, 1000 * 2 ** this.retries++);
      this.retryTimer = window.setTimeout(() => this.connect(gen), delay);
    };
    ws.addEventListener('close', down);
    ws.addEventListener('error', () => ws.close());
  }

  private startPolling(gen: number) {
    window.clearInterval(this.pollTimer);
    this.onStatus('polling');
    const ms = CHART_INTERVALS.find((i) => i.value === this.interval)?.ms ?? 900_000;
    const tick = async () => {
      try {
        const candles = await fetchCandles(this.coin, this.interval, Date.now() - ms * 2);
        if (gen !== this.generation) return;
        for (const c of candles) this.apply(toBar(c));
      } catch {
        /* the next tick retries */
      }
    };
    this.pollTimer = window.setInterval(tick, 5000);
  }

  private closeSocket() {
    const ws = this.ws;
    this.ws = null;
    if (ws) ws.close();
  }

  /** Replace the horizontal lines (entry, bust) drawn for open positions. */
  setLines(lines: ChartLine[]) {
    const wanted = new Map(lines.map((l) => [l.id, l]));
    for (const [id, line] of this.lines) {
      if (!wanted.has(id)) {
        this.series.removePriceLine(line);
        this.lines.delete(id);
      }
    }
    for (const l of lines) {
      const color = l.kind === 'bust' ? cssVar('--short', '#f0616d') : l.kind === 'entry-long' ? cssVar('--long', '#20c997') : l.kind === 'entry-short' ? cssVar('--short', '#f0616d') : cssVar('--accent', '#4cc9f0');
      const opts = { price: l.price, color, lineWidth: 1 as const, lineStyle: l.kind === 'bust' ? LineStyle.Dashed : LineStyle.Solid, axisLabelVisible: true, title: l.title };
      const existing = this.lines.get(l.id);
      if (existing) existing.applyOptions(opts);
      else this.lines.set(l.id, this.series.createPriceLine(opts));
    }
  }

  destroy() {
    this.generation++;
    this.closeSocket();
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.pollTimer);
    this.themeQuery.removeEventListener('change', this.onTheme);
    this.chart.remove();
  }
}

const POOL_RE = /^0x[0-9a-fA-F]{40}$/;
const POOL_POLL_MS = 20_000;

interface PoolOhlcv {
  data?: { attributes?: { ohlcv_list?: Array<[number, number, number, number, number, number]> } };
}

/**
 * Native candlesticks for a HyperEVM pool, from GeckoTerminal's free OHLCV
 * endpoint (priced in USD for the quote token, i.e. WHYPE). Works wherever the
 * third-party embeds refuse to frame, and follows the app theme.
 */
export function mountPoolChart(host: HTMLElement, pool: string, onStatus: (status: ChartStatus, detail?: string) => void): { destroy(): void } {
  if (!POOL_RE.test(pool)) {
    onStatus('error', 'The pool address is not valid.');
    return { destroy() {} };
  }
  const chart = createChart(host, {
    autoSize: true,
    layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: cssVar('--muted', '#8b93a7'), fontFamily: 'inherit', attributionLogo: false },
    grid: { vertLines: { color: cssVar('--grid', '#1d2230') }, horzLines: { color: cssVar('--grid', '#1d2230') } },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
  });
  const up = cssVar('--long', '#20c997');
  const down = cssVar('--short', '#f0616d');
  const series = chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down, priceFormat: { type: 'price', precision: 3, minMove: 0.001 } });
  let stopped = false;
  let first = true;
  const controller = new AbortController();

  const refresh = async () => {
    try {
      const url = `https://api.geckoterminal.com/api/v2/networks/hyperevm/pools/${pool}/ohlcv/minute?aggregate=15&limit=300&currency=usd&token=quote`;
      const res = await fetch(url, { headers: { accept: 'application/json' }, signal: controller.signal });
      if (!res.ok) throw new Error(`GeckoTerminal returned HTTP ${res.status}.`);
      const rows = ((await res.json()) as PoolOhlcv).data?.attributes?.ohlcv_list ?? [];
      if (!rows.length) throw new Error('GeckoTerminal has no candles for this pool yet.');
      const bars = [...new Map(rows.map((r) => [r[0], r])).values()]
        .sort((a, b) => a[0] - b[0])
        .map((r) => ({ time: r[0] as UTCTimestamp, open: r[1], high: r[2], low: r[3], close: r[4] }));
      if (stopped) return;
      series.setData(bars);
      if (first) {
        chart.timeScale().fitContent();
        first = false;
      }
      onStatus('live');
    } catch (err) {
      if (stopped || controller.signal.aborted) return;
      onStatus('error', err instanceof Error ? err.message : String(err));
    }
  };
  onStatus('loading');
  void refresh();
  const timer = window.setInterval(() => void refresh(), POOL_POLL_MS);
  return {
    destroy() {
      stopped = true;
      controller.abort();
      window.clearInterval(timer);
      chart.remove();
    },
  };
}
