import {
  distanceToLiquidation,
  estimateClose,
  liquidationPriceRaw,
  priceFromRaw,
  priceToRaw,
  unrealizedPnlUsd,
  usdToWad,
  wadToNumber,
  type AccountTrade,
  type CloseEstimate,
  type Instrument,
  type OpenPosition,
} from 'papertrade-sdk';

export type Side = 'long' | 'short';

export interface Scenario {
  /** Signed price move as a fraction of entry (0.01 is +1%). */
  move: number;
  exitPrice: number;
  estimate: CloseEstimate;
}

export interface OpenPreview {
  entryRaw: bigint;
  entryPrice: number;
  bustRaw: bigint;
  bustPrice: number;
  /** Fraction of entry price the market can move against the position before it busts. */
  bustDistance: number;
  marginUsd: number;
  notionalUsd: number;
  scenarios: Scenario[];
}

/** Fractions of the bust distance the scenario ladder probes on each side. */
export const SCENARIO_STEPS = [0.25, 0.5, 0.9] as const;

/**
 * Everything the pre-trade panel shows, from the live mark. Bust price and the
 * close outcomes come straight from the SDK's verified settlement math.
 */
export function previewOpen(params: { instrument: Instrument; side: Side; marginUsd: number; leverage: number; markPrice: number }): OpenPreview {
  const { instrument, side, marginUsd, leverage, markPrice } = params;
  const isLong = side === 'long';
  const scale = Number(instrument.priceScale);
  const entryRaw = priceToRaw(markPrice, scale);
  const bustRaw = liquidationPriceRaw({ entryPriceRaw: entryRaw, leverage, isLong, bustBufferRaw: instrument.bustBufferRaw });
  const bustDistance = Math.abs(Number(entryRaw - bustRaw)) / Number(entryRaw);
  const marginRaw = usdToWad(marginUsd.toFixed(18));
  const favourable = isLong ? 1 : -1;
  const moves = [
    ...SCENARIO_STEPS.map((s) => -s * bustDistance * favourable).reverse(),
    ...SCENARIO_STEPS.map((s) => s * bustDistance * favourable),
  ];
  const scenarios = moves.map((move) => {
    const exitRaw = priceToRaw(markPrice * (1 + move), scale);
    return {
      move: isLong ? Number(exitRaw - entryRaw) / Number(entryRaw) : Number(entryRaw - exitRaw) / Number(entryRaw),
      exitPrice: priceFromRaw(exitRaw, scale),
      estimate: estimateClose({ instrument, isLong, entryPriceRaw: entryRaw, exitPriceRaw: exitRaw, marginRaw, leverage }),
    };
  });
  return { entryRaw, entryPrice: priceFromRaw(entryRaw, scale), bustRaw, bustPrice: priceFromRaw(bustRaw, scale), bustDistance, marginUsd, notionalUsd: marginUsd * leverage, scenarios };
}

export interface PositionView {
  entryPrice: number;
  bustPrice: number;
  marginUsd: number;
  notionalUsd: number;
  unrealizedUsd: number;
  roe: number;
  /** What a close at the current mark would pay after the deadband, impact haircut and fee. */
  closeEstimate: CloseEstimate;
  distance: number;
}

export function positionView(position: OpenPosition, instrument: Instrument, markPrice: number): PositionView {
  const scale = Number(instrument.priceScale);
  const markRaw = priceToRaw(markPrice, scale);
  const marginUsd = wadToNumber(position.marginRaw);
  const unrealizedUsd = unrealizedPnlUsd({ isLong: position.isLong, entryPriceRaw: position.entryPriceRaw, markPriceRaw: markRaw, marginRaw: position.marginRaw, leverage: position.leverage });
  return {
    entryPrice: priceFromRaw(position.entryPriceRaw, scale),
    bustPrice: priceFromRaw(position.bustPriceRaw, scale),
    marginUsd,
    notionalUsd: marginUsd * position.leverage,
    unrealizedUsd,
    roe: marginUsd > 0 ? unrealizedUsd / marginUsd : 0,
    closeEstimate: estimateClose({ instrument, isLong: position.isLong, entryPriceRaw: position.entryPriceRaw, exitPriceRaw: markRaw, marginRaw: position.marginRaw, leverage: position.leverage }),
    distance: distanceToLiquidation({ isLong: position.isLong, markPriceRaw: markRaw, bustPriceRaw: position.bustPriceRaw }),
  };
}

/** Net PnL of a settled trade row: the adjusted PnL minus the win fee the trader paid. */
export function tradeNetPnlUsd(trade: Pick<AccountTrade, 'adjustedPnlRaw' | 'userPaidFeeRaw'>): number {
  return wadToNumber(BigInt(trade.adjustedPnlRaw) - BigInt(trade.userPaidFeeRaw));
}
