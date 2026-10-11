import { priceFromRaw } from 'papertrade-sdk';
import type { CandleChart, ChartLine, ChartStatus } from './chart.js';
import type { PoolInfo } from './embeds.js';
import { S, currentInstrument, instruments, on } from './state.js';
import { $, esc, fmtNum, fmtPrice, qsa } from './util.js';

type ChartTab = 'candles' | 'tv' | 'pool';
type Provider = 'native' | 'dextools' | 'gecko';

const INTERVAL_KEY = 'pt.interval';
let tab: ChartTab = 'candles';
let provider: Provider = 'native';
let poolChart: { destroy(): void } | null = null;
let interval = '15m';
let chart: CandleChart | null = null;
let chartLoading: Promise<void> | null = null;
let loadedKey = '';
let tvKey = '';
let pool: PoolInfo | null = null;
let poolState: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
let poolKey = '';

const STATUS_TEXT: Record<ChartStatus, string> = { loading: 'Loading candles...', live: 'Live', polling: 'Live (polling)', error: '' };

function showError(message: string | null): void {
  const box = $('candle-error');
  box.hidden = message === null;
  if (message === null) return;
  box.innerHTML = `<p><strong>Candles are unavailable</strong></p><p class="muted">${esc(message)}</p><button class="btn btn-sm" type="button" data-act="retry-candles">Retry</button>`;
}

function onStatus(status: ChartStatus, detail?: string): void {
  $('chart-status').textContent = STATUS_TEXT[status];
  $('chart-status').dataset.state = status;
  showError(status === 'error' ? (detail ?? 'The Hyperliquid candle feed could not be reached.') : null);
}

function onPrice(price: number): void {
  const inst = currentInstrument();
  $('chart-last').textContent = inst ? fmtPrice(price, Number(inst.priceScale)) : fmtNum(price);
}

function lines(): ChartLine[] {
  const inst = currentInstrument();
  if (!inst || !S.wallet) return [];
  const scale = Number(inst.priceScale);
  const out: ChartLine[] = [];
  for (const p of S.wallet.positions) {
    if (p.instrumentId !== inst.id) continue;
    const id = String(p.positionId);
    out.push({ id: `e${id}`, price: priceFromRaw(p.entryPriceRaw, scale), title: `${p.isLong ? 'Long' : 'Short'} ${p.leverage}x`, kind: p.isLong ? 'entry-long' : 'entry-short' });
    out.push({ id: `b${id}`, price: priceFromRaw(p.bustPriceRaw, scale), title: 'Bust', kind: 'bust' });
  }
  return out;
}

function applyLines(): void {
  chart?.setLines(lines());
}

async function ensureChart(): Promise<CandleChart> {
  if (chart) return chart;
  chartLoading ??= import('./chart.js').then((m) => {
    chart = new m.CandleChart($('candle-host'), onStatus, onPrice);
  });
  await chartLoading;
  return chart as unknown as CandleChart;
}

async function loadCandles(force = false): Promise<void> {
  const inst = currentInstrument();
  if (!inst) return;
  const key = `${inst.symbol}:${interval}`;
  if (!force && key === loadedKey) return;
  loadedKey = key;
  const c = await ensureChart();
  await c.load(inst.symbol, interval as Parameters<CandleChart['load']>[1], Number(inst.priceScale));
  applyLines();
}

async function loadTradingView(): Promise<void> {
  const inst = currentInstrument();
  if (!inst || tvKey === inst.symbol) return;
  tvKey = inst.symbol;
  const m = await import('./embeds.js');
  m.mountTradingView($('tv-host'), inst.symbol);
}

function poolHost(): HTMLElement {
  return $('pool-host');
}

function renderPool(): void {
  const host = poolHost();
  const link = $<HTMLAnchorElement>('pool-link');
  if (poolState === 'loading' || poolState === 'idle') {
    host.innerHTML = '<div class="skeleton fill"></div>';
    $('pool-info').textContent = 'Finding the deepest HYPE / USDC pool...';
    link.hidden = true;
    return;
  }
  if (poolState === 'error' || !pool) {
    host.innerHTML = '<div class="state-box"><p><strong>Pool chart unavailable</strong></p><p class="muted">Could not look up the HYPE / USDC pool on GeckoTerminal.</p><button class="btn btn-sm" type="button" data-act="retry-pool">Retry</button></div>';
    $('pool-info').textContent = '';
    link.hidden = true;
    return;
  }
  const p = pool;
  if (provider === 'native') {
    const key = `native:${p.address}`;
    if (poolKey === key && poolChart) return;
    poolChart?.destroy();
    poolKey = key;
    host.replaceChildren();
    link.href = `https://www.geckoterminal.com/hyperevm/pools/${p.address}`;
    link.hidden = false;
    void import('./chart.js').then((m) => {
      if (pool !== p || provider !== 'native' || poolKey !== key) return;
      poolChart = m.mountPoolChart(host, p.address, (status, detail) => {
        $('pool-status').textContent = status === 'error' ? (detail ?? 'Pool candles are unavailable.') : STATUS_TEXT[status];
      });
    });
    $('pool-info').textContent = `${p.name} on ${p.dex}, $${fmtNum(p.liquidityUsd, 0)} liquidity, $${fmtNum(p.volume24hUsd, 0)} 24h volume`;
    return;
  }
  poolChart?.destroy();
  poolChart = null;
  void import('./embeds.js').then((m) => {
    if (pool !== p) return;
    const url = provider === 'dextools' ? m.dextoolsWidgetUrl(p.address) : m.geckoEmbedUrl(p.address);
    const key = `${provider}:${url}`;
    if (poolKey === key && host.querySelector('iframe')) return;
    poolKey = key;
    const frame = document.createElement('iframe');
    frame.src = url;
    frame.title = provider === 'dextools' ? 'DexTools HYPE / USDC pool chart' : 'GeckoTerminal HYPE / USDC pool chart';
    frame.loading = 'lazy';
    frame.referrerPolicy = 'no-referrer';
    host.replaceChildren(frame);
    link.href = provider === 'dextools' ? m.dextoolsPageUrl(p.address) : `https://www.geckoterminal.com/hyperevm/pools/${p.address}`;
    link.hidden = false;
  });
  $('pool-info').textContent = `${p.name} on ${p.dex}, $${fmtNum(p.liquidityUsd, 0)} liquidity, $${fmtNum(p.volume24hUsd, 0)} 24h volume`;
}

async function loadPool(): Promise<void> {
  if (poolState === 'ready' || poolState === 'loading') {
    renderPool();
    return;
  }
  poolState = 'loading';
  renderPool();
  try {
    const m = await import('./embeds.js');
    pool = await m.resolveHypePool();
    poolState = 'ready';
  } catch {
    poolState = 'error';
  }
  renderPool();
}

const TAB_TITLE: Record<ChartTab, (symbol: string) => string> = {
  candles: (symbol) => `${symbol} / USD`,
  tv: (symbol) => `${symbol} / USD spot`,
  pool: () => 'WHYPE / USDC pool',
};

function setTitle(): void {
  const inst = currentInstrument();
  $('chart-title').textContent = TAB_TITLE[tab](inst?.symbol ?? 'BTC');
}

export function setChartTab(next: ChartTab): void {
  tab = next;
  setTitle();
  for (const btn of qsa<HTMLButtonElement>('[data-ctab]')) {
    const on = btn.dataset.ctab === next;
    btn.setAttribute('aria-selected', String(on));
    btn.tabIndex = on ? 0 : -1;
    $(`cpane-${btn.dataset.ctab}`).hidden = !on;
  }
  $('intervals').hidden = next !== 'candles';
  $('chart-last').hidden = next !== 'candles';
  $('chart-status').hidden = next !== 'candles';
  if (next === 'candles') {
    void loadCandles();
  }
  if (next === 'tv') void loadTradingView();
  if (next === 'pool') void loadPool();
}

function renderIntervals(): void {
  const wrap = $('intervals');
  if (wrap.childElementCount === 0) {
    void import('./chart.js').then((m) => {
      wrap.innerHTML = m.CHART_INTERVALS.map((i) => `<button type="button" class="seg-btn" data-int="${i.value}" aria-pressed="false">${i.label}</button>`).join('');
      renderIntervals();
    });
    return;
  }
  for (const btn of qsa<HTMLButtonElement>('[data-int]', wrap)) btn.setAttribute('aria-pressed', String(btn.dataset.int === interval));
}

function onMarketChange(): void {
  const inst = currentInstrument();
  if (!inst) return;
  setTitle();
  if (tab === 'candles') void loadCandles();
  if (tab === 'tv') void loadTradingView();
  const hasTv = instruments().length > 0;
  $('ctab-tv').toggleAttribute('data-unavailable', !hasTv);
}

export function initCharts(): void {
  try {
    interval = localStorage.getItem(INTERVAL_KEY) || interval;
  } catch {
    interval = '15m';
  }
  renderIntervals();
  const tabs = qsa<HTMLButtonElement>('[data-ctab]');
  for (const btn of tabs) {
    btn.addEventListener('click', () => setChartTab(btn.dataset.ctab as ChartTab));
    btn.addEventListener('keydown', (event) => {
      const i = tabs.indexOf(btn);
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const target = tabs[(i + step + tabs.length) % tabs.length];
      target.focus();
      setChartTab(target.dataset.ctab as ChartTab);
    });
  }
  $('intervals').addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-int]');
    if (!btn?.dataset.int) return;
    interval = btn.dataset.int;
    try {
      localStorage.setItem(INTERVAL_KEY, interval);
    } catch {
      /* the interval simply is not remembered */
    }
    renderIntervals();
    void loadCandles();
  });
  $('sec-chart').addEventListener('click', (event) => {
    const t = event.target as HTMLElement;
    if (t.closest('[data-act="retry-candles"]')) void loadCandles(true);
    if (t.closest('[data-act="retry-pool"]')) {
      poolState = 'idle';
      void loadPool();
    }
    const p = t.closest<HTMLButtonElement>('[data-pool]');
    if (p?.dataset.pool) {
      provider = p.dataset.pool === 'gecko' ? 'gecko' : p.dataset.pool === 'dextools' ? 'dextools' : 'native';
      for (const b of qsa<HTMLButtonElement>('[data-pool]')) b.setAttribute('aria-pressed', String(b === p));
      poolKey = '';
      renderPool();
    }
  });
  on('markets', onMarketChange);
  on('market-select', onMarketChange);
  on('wallet', applyLines);
  on('account', applyLines);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    tvKey = '';
    poolKey = '';
    if (tab === 'tv') void loadTradingView();
    if (tab === 'pool') renderPool();
  });
  setChartTab('candles');
}
