import * as dotenv from "dotenv";
dotenv.config();

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v.toLowerCase() === "true" || v === "1";
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`Env var ${name} must be a number, got "${v}"`);
  return n;
}

export const config = {
  privateKey: process.env.PRIVATE_KEY ?? "",
  rpcHttpUrl: required("RPC_HTTP_URL", "https://api.mainnet-beta.solana.com"),
  rpcWssUrl: required("RPC_WSS_URL", "wss://api.mainnet-beta.solana.com"),

  buyAmountSol: num("BUY_AMOUNT_SOL", 0.01),
  // Separate buy/sell slippage: sell often needs more headroom (price already moved by the
  // time take-profit/stop-loss fires) than the initial snipe buy does.
  slippageBuyPercent: num("SLIPPAGE_BUY_PERCENT", num("SLIPPAGE_PERCENT", 10)),
  slippageSellPercent: num("SLIPPAGE_SELL_PERCENT", num("SLIPPAGE_PERCENT", 15)),
  // Target total priority fee per transaction, in SOL (not micro-lamports/CU — converted
  // internally in trade/priorityFee.ts using the tx's compute unit limit).
  priorityFeeSol: num("PRIORITY_FEE_SOL", 0.00006),
  liveTrading: bool("LIVE_TRADING", false),

  // Auto-sell: percent move (relative to actual entry price paid) that triggers a sell.
  // 0 disables that side of the auto-sell.
  takeProfitPercent: num("TAKE_PROFIT_PERCENT", 50),
  stopLossPercent: num("STOP_LOSS_PERCENT", 20),

  requireMintAuthorityRevoked: bool("REQUIRE_MINT_AUTHORITY_REVOKED", true),
  requireFreezeAuthorityRevoked: bool("REQUIRE_FREEZE_AUTHORITY_REVOKED", true),
  minInitialSolReserves: num("MIN_INITIAL_SOL_RESERVES", 1),
  // If creator has already routed more than this much SOL into the bonding curve by the
  // time we check (their own dev-buy), skip the snipe. 0 disables the check.
  maxCreatorBuySol: num("MAX_CREATOR_BUY_SOL", 0),

  // Only snipe tokens deployed by these wallets (base58, comma-separated). Empty = no
  // restriction. Editable at runtime from the dashboard; persisted to data/watched-dev-wallets.json.
  watchedDevWallets: (process.env.WATCHED_DEV_WALLETS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // "watchlist" (default, safe): only buy tokens from watchedDevWallets above.
  // "all": ignore the whitelist and try to buy every new token that passes the other safety
  // filters (min reserves, authorities revoked, max creator buy). Much higher volume/risk —
  // pair with maxBuysPerSession below.
  snipeMode: (process.env.SNIPE_MODE === "all" ? "all" : "watchlist") as "watchlist" | "all",
  // Caps how many buys the engine will execute in one Start->Stop run, regardless of mode.
  // 0 = unlimited. The dashboard requires this to be set (>0) before it'll let you switch
  // into "all" mode, since that mode has no other brake on total spend.
  maxBuysPerSession: num("MAX_BUYS_PER_SESSION", 0),

  webPort: num("WEB_PORT", 3000),
  webDashboardToken: process.env.WEB_DASHBOARD_TOKEN ?? "change-me",

  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramAllowedUserIds: (process.env.TELEGRAM_ALLOWED_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number),
};

export type AppConfig = typeof config;
