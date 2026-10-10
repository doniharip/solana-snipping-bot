export interface DetectedToken {
  mint: string;
  creator: string;
  name?: string;
  symbol?: string;
  signature: string;
  detectedAt: number;
  initialSolReserves?: number;
}

export interface FilterResult {
  passed: boolean;
  reasons: string[];
}

export interface TradeResult {
  ok: boolean;
  mint: string;
  signature?: string;
  error?: string;
  dryRun: boolean;
  amountSol: number;
  side: "buy" | "sell";
  reason?: "take-profit" | "stop-loss" | "manual";
  timestamp: number;
}

/** An open (bought, not yet sold) snipe, tracked for take-profit / stop-loss. */
export interface Position {
  mint: string;
  symbol?: string;
  creator: string;
  /** Effective price actually paid: lamports per raw (base-unit) token, entry-side. */
  entryPriceSolPerToken: number;
  /** Raw base-unit token amount held, as a string (bigint doesn't survive JSON/EventEmitter). */
  tokenAmount: string;
  amountSolSpent: number;
  /** Snapshotted from botState at buy time, so later config changes don't retroactively move this position's targets. */
  takeProfitPercent: number;
  stopLossPercent: number;
  openedAt: number;
  buySignature?: string;
}

export interface DevWallet {
  address: string;
  label?: string;
  addedAt: number;
}

export interface BotStatusSnapshot {
  running: boolean;
  liveTrading: boolean;
  walletAddress: string | null;
  buyAmountSol: number;
  slippageBuyPercent: number;
  slippageSellPercent: number;
  priorityFeeSol: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  maxCreatorBuySol: number;
  watchedDevWalletsCount: number;
  snipeMode: "watchlist" | "all";
  maxBuysPerSession: number;
  buysThisSession: number;
  openPositions: number;
  tokensDetected: number;
  tradesAttempted: number;
  tradesSucceeded: number;
  startedAt: number | null;
}
