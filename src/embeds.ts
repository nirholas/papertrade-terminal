import { MAINNET } from 'papertrade-sdk';

/** TradingView symbols for each Papertrade market (major US-accessible spot venue). */
export const TRADINGVIEW_SYMBOLS: Record<string, string> = {
  BTC: 'COINBASE:BTCUSD',
  ETH: 'COINBASE:ETHUSD',
};

export const TRADINGVIEW_SCRIPT = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';

export function darkMode(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Mount the free TradingView Advanced Chart widget into `host`, replacing whatever was there. */
export function mountTradingView(host: HTMLElement, market: string) {
  const symbol = TRADINGVIEW_SYMBOLS[market];
  host.replaceChildren();
  if (!symbol) {
    host.textContent = `No TradingView symbol is mapped for ${market}.`;
    return;
  }
  const container = document.createElement('div');
  container.className = 'tradingview-widget-container';
  container.style.height = '100%';
  container.style.width = '100%';
  const widget = document.createElement('div');
  widget.className = 'tradingview-widget-container__widget';
  widget.style.height = '100%';
  widget.style.width = '100%';
  const script = document.createElement('script');
  script.src = TRADINGVIEW_SCRIPT;
  script.async = true;
  script.textContent = JSON.stringify({
    autosize: true,
    symbol,
    interval: '15',
    timezone: 'Etc/UTC',
    theme: darkMode() ? 'dark' : 'light',
    style: '1',
    locale: 'en',
    allow_symbol_change: false,
    hide_side_toolbar: false,
    save_image: false,
    support_host: 'https://www.tradingview.com',
  });
  container.append(widget, script);
  host.append(container);
}

export interface PoolInfo {
  address: string;
  name: string;
  dex: string;
  liquidityUsd: number;
  volume24hUsd: number;
}

/** DexTools identifies HyperEVM with this chain slug in widget URLs. */
export const DEXTOOLS_CHAIN = 'hyperevm';
export const GECKO_NETWORK = 'hyperevm';

/**
 * Resolve the deepest USDC/WHYPE pool at runtime from GeckoTerminal, so the
 * embedded chart follows liquidity instead of a hardcoded pool address.
 */
export async function resolveHypePool(signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<PoolInfo> {
  const url = `https://api.geckoterminal.com/api/v2/networks/${GECKO_NETWORK}/tokens/${MAINNET.contracts.usdc}/pools?page=1`;
  const res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal });
  if (!res.ok) throw new Error(`GeckoTerminal pool lookup failed (HTTP ${res.status}).`);
  const body = (await res.json()) as { data?: Array<{ attributes: { address: string; name: string; reserve_in_usd: string; volume_usd: { h24: string } }; relationships: { dex: { data: { id: string } } } }> };
  const pools = (body.data ?? [])
    .filter((p) => /^USDC \/ WHYPE\b/.test(p.attributes.name) && /^0x[0-9a-fA-F]{40}$/.test(p.attributes.address))
    .map((p) => ({
      address: p.attributes.address,
      name: p.attributes.name,
      dex: p.relationships.dex.data.id,
      liquidityUsd: Number(p.attributes.reserve_in_usd),
      volume24hUsd: Number(p.attributes.volume_usd.h24),
    }))
    .sort((a, b) => b.liquidityUsd - a.liquidityUsd);
  if (!pools.length) throw new Error('No USDC/WHYPE pool found on HyperEVM.');
  return pools[0];
}

export function dextoolsWidgetUrl(pool: string): string {
  const theme = darkMode() ? 'dark' : 'light';
  return `https://www.dextools.io/widget-chart/en/${DEXTOOLS_CHAIN}/pe-${theme}/${pool}?theme=${theme}&chartType=2&chartResolution=30&drawingToolbars=false`;
}

export function dextoolsPageUrl(pool: string): string {
  return `https://www.dextools.io/app/en/${DEXTOOLS_CHAIN}/pair-explorer/${pool}`;
}

export function geckoEmbedUrl(pool: string): string {
  return `https://www.geckoterminal.com/${GECKO_NETWORK}/pools/${pool}?embed=1&info=0&swaps=0&grayscale=0&light_chart=${darkMode() ? '0' : '1'}&chart_type=price&resolution=15m`;
}
