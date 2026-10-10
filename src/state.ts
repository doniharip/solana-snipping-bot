import { EventEmitter } from "events";
import { config } from "./config";
import { loadWatchedWallets, saveWatchedWallets } from "./devWalletsStore";
import { BotStatusSnapshot, DetectedToken, Position, TradeResult } from "./types";

/**
 * Central in-memory state + event bus shared by the listener, trade engine,
 * web dashboard and Telegram bot. Kept deliberately simple (no DB) for the MVP.
 * The one exception is watchedDevWallets, which is persisted to disk — see devWalletsStore.ts.
 */
class BotState extends EventEmitter {
  running = false;
  startedAt: number | null = null;
  walletAddress: string | null = null;

  buyAmountSol = config.buyAmountSol;
  slippageBuyPercent = config.slippageBuyPercent;
  slippageSellPercent = config.slippageSellPercent;
  priorityFeeSol = config.priorityFeeSol;
  takeProfitPercent = config.takeProfitPercent;
  stopLossPercent = config.stopLossPercent;
  maxCreatorBuySol = config.maxCreatorBuySol;
  liveTrading = config.liveTrading;

  snipeMode: "watchlist" | "all" = config.snipeMode;
  maxBuysPerSession = config.maxBuysPerSession;
  /** How many buys the engine has executed since the last Start. Reset in start(). */
  buysThisSession = 0;

  watchedDevWallets: string[];
  positions: Position[] = [];

  logs: { ts: number; level: "info" | "warn" | "error"; msg: string }[] = [];
  detectedTokens: DetectedToken[] = [];
  trades: TradeResult[] = [];

  private readonly MAX_LOGS = 500;

  constructor() {
    super();
    const stored = loadWatchedWallets();
    this.watchedDevWallets = stored.length > 0 ? stored : config.watchedDevWallets;
  }

  log(level: "info" | "warn" | "error", msg: string) {
    const entry = { ts: Date.now(), level, msg };
    this.logs.push(entry);
    if (this.logs.length > this.MAX_LOGS) this.logs.shift();
    this.emit("log", entry);
    // eslint-disable-next-line no-console
    console.log(`[${level.toUpperCase()}] ${msg}`);
  }

  addDetectedToken(t: DetectedToken) {
    this.detectedTokens.unshift(t);
    if (this.detectedTokens.length > 200) this.detectedTokens.pop();
    this.emit("token", t);
  }

  addTrade(t: TradeResult) {
    this.trades.unshift(t);
    if (this.trades.length > 200) this.trades.pop();
    this.emit("trade", t);
  }

  addWatchedWallet(address: string): boolean {
    if (this.watchedDevWallets.includes(address)) return false;
    this.watchedDevWallets.push(address);
    saveWatchedWallets(this.watchedDevWallets);
    this.log("info", `Watchlist: added dev wallet ${address}`);
    return true;
  }

  removeWatchedWallet(address: string): boolean {
    const before = this.watchedDevWallets.length;
    this.watchedDevWallets = this.watchedDevWallets.filter((a) => a !== address);
    const removed = this.watchedDevWallets.length !== before;
    if (removed) {
      saveWatchedWallets(this.watchedDevWallets);
      this.log("info", `Watchlist: removed dev wallet ${address}`);
    }
    return removed;
  }

  addPosition(position: Position) {
    this.positions.unshift(position);
    this.emit("position", position);
  }

  removePosition(mint: string) {
    this.positions = this.positions.filter((p) => p.mint !== mint);
  }

  getPosition(mint: string): Position | undefined {
    return this.positions.find((p) => p.mint === mint);
  }

  start() {
    this.running = true;
    this.startedAt = Date.now();
    this.buysThisSession = 0;
    this.emit("statusChange");
  }

  stop() {
    this.running = false;
    this.emit("statusChange");
  }

  snapshot(): BotStatusSnapshot {
    return {
      running: this.running,
      liveTrading: this.liveTrading,
      walletAddress: this.walletAddress,
      buyAmountSol: this.buyAmountSol,
      slippageBuyPercent: this.slippageBuyPercent,
      slippageSellPercent: this.slippageSellPercent,
      priorityFeeSol: this.priorityFeeSol,
      takeProfitPercent: this.takeProfitPercent,
      stopLossPercent: this.stopLossPercent,
      maxCreatorBuySol: this.maxCreatorBuySol,
      watchedDevWalletsCount: this.watchedDevWallets.length,
      snipeMode: this.snipeMode,
      maxBuysPerSession: this.maxBuysPerSession,
      buysThisSession: this.buysThisSession,
      openPositions: this.positions.length,
      tokensDetected: this.detectedTokens.length,
      tradesAttempted: this.trades.length,
      tradesSucceeded: this.trades.filter((t) => t.ok).length,
      startedAt: this.startedAt,
    };
  }
}

export const botState = new BotState();
