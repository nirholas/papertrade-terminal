/**
 * Deep links that open the terminal with the order ticket prefilled, e.g.
 * /app/?market=BTC&side=long&margin=50&leverage=10. The MCP build_trade_plan tool emits these.
 * Parsing only reads a form: nothing is signed or sent until the user reviews and confirms.
 */
export type LinkSide = 'long' | 'short';

export interface Prefill {
  /** Symbol (BTC) or numeric market id, resolved against the live market list. */
  market?: string;
  side?: LinkSide;
  /** Margin in USD as a plain decimal string. */
  margin?: string;
  leverage?: number;
}

export interface LinkState {
  prefill: Prefill | null;
  embed: boolean;
}

const MAX_MARGIN = 10_000_000;

export function parseLink(search: string): LinkState {
  const q = new URLSearchParams(search);
  const embed = q.get('embed') === '1';
  const out: Prefill = {};

  const market = q.get('market')?.trim();
  if (market && /^[A-Za-z0-9]{1,12}$/.test(market)) out.market = market;

  const side = q.get('side')?.trim().toLowerCase();
  if (side === 'long' || side === 'short') out.side = side;

  const margin = q.get('margin')?.trim().replace(/,/g, '');
  if (margin && /^\d{1,8}(\.\d{1,6})?$/.test(margin)) {
    const n = Number(margin);
    if (n > 0 && n <= MAX_MARGIN) out.margin = String(n);
  }

  const lev = q.get('leverage')?.trim();
  if (lev && /^\d{1,4}$/.test(lev)) {
    const n = Number(lev);
    if (n >= 1 && n <= 1000) out.leverage = n;
  }

  return { prefill: Object.keys(out).length ? out : null, embed };
}

/** The same query without the prefill keys, so a reload does not re-apply a stale link. */
export function stripPrefill(search: string): string {
  const q = new URLSearchParams(search);
  for (const k of ['market', 'side', 'margin', 'leverage']) q.delete(k);
  const rest = q.toString();
  return rest ? `?${rest}` : '';
}
