import { MAINNET } from 'papertrade-sdk';
import type { Address, Hex } from 'viem';

/**
 * HyperEVM swaps through the KyberSwap aggregator. Verified live: the public
 * `hyperevm` endpoint returns real routes for chain 999 and sends CORS headers
 * for both the GET quote and the POST build, so the browser calls it directly.
 * (LI.FI also quotes chain 999 but its anonymous quota is 75 requests per two
 * hours, too low for as-you-type quotes.)
 */
export const KYBER_BASE = 'https://aggregator-api.kyberswap.com/hyperevm/api/v1';
export const KYBER_CLIENT_ID = 'papertrade-terminal';
export const NATIVE_TOKEN: Address = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
export const WHYPE: Address = '0x5555555555555555555555555555555555555555';

export interface SwapToken {
  symbol: 'USDC' | 'HYPE';
  address: Address;
  decimals: number;
  native: boolean;
}

export const USDC_TOKEN: SwapToken = { symbol: 'USDC', address: MAINNET.contracts.usdc as Address, decimals: 6, native: false };
export const HYPE_TOKEN: SwapToken = { symbol: 'HYPE', address: NATIVE_TOKEN, decimals: 18, native: true };

/** HYPE kept back from "Max" so the wallet can still pay gas. */
export const GAS_RESERVE_WEI = 20_000_000_000_000_000n;

export class SwapError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
    this.name = 'SwapError';
  }
}

interface RouteHop {
  pool: string;
  tokenIn: string;
  tokenOut: string;
  swapAmount: string;
  amountOut: string;
  exchange: string;
}

export interface RouteSummary {
  tokenIn: string;
  amountIn: string;
  amountInUsd: string;
  tokenOut: string;
  amountOut: string;
  amountOutUsd: string;
  gas: string;
  gasPrice: string;
  gasUsd: string;
  route: RouteHop[][];
  routeID: string;
  checksum: string;
  timestamp: number;
  [key: string]: unknown;
}

export interface SwapQuote {
  routeSummary: RouteSummary;
  routerAddress: Address;
  amountIn: bigint;
  amountOut: bigint;
  amountInUsd: number;
  amountOutUsd: number;
  gasUsd: number;
  /** Venues the route touches, in order, deduplicated. */
  venues: string[];
  /** Number of parallel splits in the first leg. */
  splits: number;
}

export interface BuiltSwap {
  to: Address;
  data: Hex;
  value: bigint;
  amountOut: bigint;
  minReceived: bigint;
  gas: bigint;
  gasUsd: number;
}

type Fetcher = typeof fetch;

async function kyberJson<T>(res: Response): Promise<T> {
  type Body = { code?: number; message?: string; data?: T };
  let body: Body | null;
  try {
    body = (await res.json()) as Body | null;
  } catch {
    throw new SwapError(`KyberSwap returned an unreadable response (HTTP ${res.status}).`);
  }
  if (res.status === 429) throw new SwapError('KyberSwap is rate limiting quotes. Wait a few seconds and retry.', 429);
  if (!res.ok || !body || body.code !== 0 || !body.data) {
    throw new SwapError(body?.message ? `KyberSwap: ${body.message}` : `KyberSwap request failed (HTTP ${res.status}).`, body?.code ?? res.status);
  }
  return body.data;
}

export function parseQuote(data: { routeSummary: RouteSummary; routerAddress: Address }): SwapQuote {
  const rs = data.routeSummary;
  const venues: string[] = [];
  for (const leg of rs.route) for (const hop of leg) if (!venues.includes(hop.exchange)) venues.push(hop.exchange);
  return {
    routeSummary: rs,
    routerAddress: data.routerAddress,
    amountIn: BigInt(rs.amountIn),
    amountOut: BigInt(rs.amountOut),
    amountInUsd: Number(rs.amountInUsd),
    amountOutUsd: Number(rs.amountOutUsd),
    gasUsd: Number(rs.gasUsd),
    venues,
    splits: rs.route[0]?.length ?? 1,
  };
}

export async function fetchQuote(params: { tokenIn: SwapToken; tokenOut: SwapToken; amountIn: bigint; signal?: AbortSignal; fetchImpl?: Fetcher }): Promise<SwapQuote> {
  const { tokenIn, tokenOut, amountIn, signal } = params;
  const url = new URL(`${KYBER_BASE}/routes`);
  url.searchParams.set('tokenIn', tokenIn.address);
  url.searchParams.set('tokenOut', tokenOut.address);
  url.searchParams.set('amountIn', amountIn.toString());
  const res = await (params.fetchImpl ?? fetch)(url, { headers: { 'x-client-id': KYBER_CLIENT_ID }, signal });
  return parseQuote(await kyberJson<{ routeSummary: RouteSummary; routerAddress: Address }>(res));
}

/** Price impact as the USD value lost between input and output, as a fraction. Negative values clamp to zero. */
export function priceImpact(quote: Pick<SwapQuote, 'amountInUsd' | 'amountOutUsd'>): number {
  if (!(quote.amountInUsd > 0)) return 0;
  return Math.max(0, (quote.amountInUsd - quote.amountOutUsd) / quote.amountInUsd);
}

export function minReceived(amountOut: bigint, slippageBps: number): bigint {
  return (amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
}

/** Ask KyberSwap to encode the swap for `sender`. Nothing is sent: the wallet signs the returned transaction. */
export async function buildSwap(params: { quote: SwapQuote; sender: Address; slippageBps: number; signal?: AbortSignal; fetchImpl?: Fetcher }): Promise<BuiltSwap> {
  const { quote, sender, slippageBps, signal } = params;
  const res = await (params.fetchImpl ?? fetch)(`${KYBER_BASE}/route/build`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-id': KYBER_CLIENT_ID },
    body: JSON.stringify({ routeSummary: quote.routeSummary, sender, recipient: sender, slippageTolerance: slippageBps }),
    signal,
  });
  const data = await kyberJson<{ amountOut: string; data: Hex; routerAddress: Address; gas: string; gasUsd: string }>(res);
  if (data.routerAddress.toLowerCase() !== quote.routerAddress.toLowerCase()) throw new SwapError('The router changed between the quote and the build. Refresh the quote.');
  const out = BigInt(data.amountOut);
  const nativeIn = quote.routeSummary.tokenIn.toLowerCase() === NATIVE_TOKEN.toLowerCase();
  return {
    to: data.routerAddress,
    data: data.data,
    value: nativeIn ? quote.amountIn : 0n,
    amountOut: out,
    minReceived: minReceived(out, slippageBps),
    gas: BigInt(data.gas),
    gasUsd: Number(data.gasUsd),
  };
}

export function shortVenue(name: string): string {
  return name.replace(/-v\d+$/i, (m) => m.toUpperCase()).replace(/[-_]/g, ' ');
}
