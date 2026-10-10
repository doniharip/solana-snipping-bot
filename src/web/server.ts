import express from "express";
import path from "path";
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { config } from "../config";
import { botState } from "../state";
import { startEngine, stopEngine } from "../engine";
import { executeSell } from "../trade/sell";
import { getPumpFunSdk } from "../trade/pumpfunClient";
import { computeLivePnlPercent } from "../trade/positionMonitor";
import { getConnection } from "../wallet";

const WALLET_BALANCE_CACHE_MS = 4000;
let cachedBalance: { walletAddress: string; solBalance: number; fetchedAt: number } | null = null;

/** Cached so the dashboard's 2s polling doesn't hammer the RPC endpoint with getBalance calls. */
async function getWalletBalanceSol(keypair: Keypair): Promise<number | null> {
  const address = keypair.publicKey.toBase58();
  const now = Date.now();
  if (cachedBalance && cachedBalance.walletAddress === address && now - cachedBalance.fetchedAt < WALLET_BALANCE_CACHE_MS) {
    return cachedBalance.solBalance;
  }
  try {
    const lamports = await getConnection().getBalance(keypair.publicKey);
    const solBalance = lamports / LAMPORTS_PER_SOL;
    cachedBalance = { walletAddress: address, solBalance, fetchedAt: now };
    return solBalance;
  } catch {
    return cachedBalance && cachedBalance.walletAddress === address ? cachedBalance.solBalance : null;
  }
}

function requireToken(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.header("x-dashboard-token") || req.query.token;
  if (token !== config.webDashboardToken) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

function isValidPublicKey(address: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

export function startWebServer(keypair: Keypair) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "..", "..", "public")));

  app.get("/api/status", requireToken, async (_req, res) => {
    const walletBalanceSol = await getWalletBalanceSol(keypair);
    res.json({ ...botState.snapshot(), walletBalanceSol });
  });

  app.get("/api/logs", requireToken, (_req, res) => {
    res.json(botState.logs.slice(-200));
  });

  app.get("/api/tokens", requireToken, (_req, res) => {
    res.json(botState.detectedTokens.slice(0, 50));
  });

  app.get("/api/trades", requireToken, (_req, res) => {
    res.json(botState.trades.slice(0, 50));
  });

  app.post("/api/start", requireToken, (_req, res) => {
    startEngine(keypair);
    res.json(botState.snapshot());
  });

  app.post("/api/stop", requireToken, (_req, res) => {
    stopEngine();
    res.json(botState.snapshot());
  });

  app.post("/api/config", requireToken, (req, res) => {
    const {
      buyAmountSol,
      slippageBuyPercent,
      slippageSellPercent,
      priorityFeeSol,
      takeProfitPercent,
      stopLossPercent,
      maxCreatorBuySol,
      maxBuysPerSession,
      snipeMode,
      liveTrading,
    } = req.body ?? {};

    if (typeof buyAmountSol === "number" && buyAmountSol > 0) {
      botState.buyAmountSol = buyAmountSol;
    }
    if (typeof slippageBuyPercent === "number" && slippageBuyPercent >= 0) {
      botState.slippageBuyPercent = slippageBuyPercent;
    }
    if (typeof slippageSellPercent === "number" && slippageSellPercent >= 0) {
      botState.slippageSellPercent = slippageSellPercent;
    }
    if (typeof priorityFeeSol === "number" && priorityFeeSol >= 0) {
      botState.priorityFeeSol = priorityFeeSol;
    }
    if (typeof takeProfitPercent === "number" && takeProfitPercent >= 0) {
      botState.takeProfitPercent = takeProfitPercent;
    }
    if (typeof stopLossPercent === "number" && stopLossPercent >= 0) {
      botState.stopLossPercent = stopLossPercent;
    }
    if (typeof maxCreatorBuySol === "number" && maxCreatorBuySol >= 0) {
      botState.maxCreatorBuySol = maxCreatorBuySol;
    }
    if (typeof maxBuysPerSession === "number" && maxBuysPerSession >= 0) {
      botState.maxBuysPerSession = Math.floor(maxBuysPerSession);
    }
    if (snipeMode === "watchlist" || snipeMode === "all") {
      if (snipeMode === "all" && botState.maxBuysPerSession <= 0) {
        res.status(400).json({
          error:
            "Set a buy cap (maxBuysPerSession) greater than 0 before switching to Snipe All mode — it has no other brake on total spend.",
        });
        return;
      }
      if (snipeMode !== botState.snipeMode) {
        botState.snipeMode = snipeMode;
        botState.log(
          "warn",
          `Sniping mode changed to ${snipeMode === "all" ? "SNIPE ALL (every new token)" : "WATCHLIST (dev wallets only)"} via dashboard.`
        );
      }
    }
    if (typeof liveTrading === "boolean") {
      botState.liveTrading = liveTrading;
      botState.log("warn", `LIVE_TRADING toggled to ${liveTrading} via dashboard.`);
    }
    res.json(botState.snapshot());
  });

  // ---- Dev wallet watchlist ----

  app.get("/api/watchlist", requireToken, (_req, res) => {
    res.json(botState.watchedDevWallets);
  });

  app.post("/api/watchlist/add", requireToken, (req, res) => {
    const address = String(req.body?.address ?? "").trim();
    if (!address || !isValidPublicKey(address)) {
      res.status(400).json({ error: "invalid Solana address" });
      return;
    }
    const added = botState.addWatchedWallet(address);
    res.json({ added, watchedDevWallets: botState.watchedDevWallets });
  });

  app.post("/api/watchlist/remove", requireToken, (req, res) => {
    const address = String(req.body?.address ?? "").trim();
    const removed = botState.removeWatchedWallet(address);
    res.json({ removed, watchedDevWallets: botState.watchedDevWallets });
  });

  // ---- Open positions (take-profit / stop-loss) ----

  app.get("/api/positions", requireToken, async (_req, res) => {
    const sdk = getPumpFunSdk(keypair);
    const positions = await Promise.all(
      botState.positions.map(async (p) => {
        let pnlPercent: number | null = null;
        try {
          const curve = await sdk.getBondingCurveAccount(new PublicKey(p.mint));
          if (curve) {
            pnlPercent = computeLivePnlPercent(
              p.entryPriceSolPerToken,
              curve.virtualSolReserves,
              curve.virtualTokenReserves
            );
          }
        } catch {
          // leave pnlPercent null if the curve lookup fails (e.g. token already migrated out)
        }
        return { ...p, pnlPercent };
      })
    );
    res.json(positions);
  });

  app.post("/api/positions/sell", requireToken, async (req, res) => {
    const mint = String(req.body?.mint ?? "").trim();
    const position = botState.getPosition(mint);
    if (!position) {
      res.status(404).json({ error: "no open position for that mint" });
      return;
    }
    const rawPercent = req.body?.percent;
    const percent =
      typeof rawPercent === "number" && rawPercent > 0 && rawPercent <= 100 ? rawPercent : 100;
    const result = await executeSell(keypair, position, "manual", percent);
    res.json(result);
  });

  app.listen(config.webPort, () => {
    botState.log("info", `Dashboard running at http://localhost:${config.webPort}`);
  });
}
