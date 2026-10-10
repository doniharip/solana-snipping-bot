import { Keypair } from "@solana/web3.js";
import { startPumpFunListener } from "./listener/pumpfunListener";
import { runSafetyFilters } from "./trade/filters";
import { executeBuy } from "./trade/buy";
import { botState } from "./state";
import { DetectedToken } from "./types";

let stopListener: (() => void) | null = null;

export function isRunning() {
  return botState.running;
}

export function startEngine(keypair: Keypair) {
  if (botState.running) {
    botState.log("warn", "Engine already running.");
    return;
  }

  if (botState.snipeMode === "watchlist" && botState.watchedDevWallets.length === 0) {
    botState.log(
      "warn",
      "Watched dev wallet list is empty — engine will run but won't buy anything until you add at least one dev wallet (or switch to Snipe All mode)."
    );
  }
  if (botState.snipeMode === "all") {
    botState.log(
      "warn",
      `SNIPE ALL mode active — the bot will try to buy EVERY new token that passes the basic safety filters, not just watchlist creators. Buy cap this session: ${
        botState.maxBuysPerSession > 0 ? botState.maxBuysPerSession : "UNLIMITED"
      }.`
    );
  }

  stopListener = startPumpFunListener(keypair, async (token: DetectedToken) => {
    if (!botState.running) return; // stopped between detection and here

    // Session buy cap: applies in both modes, but is the main brake on Snipe All. Checked
    // before filters too so a saturated cap doesn't keep spending RPC calls on lookups.
    if (botState.maxBuysPerSession > 0 && botState.buysThisSession >= botState.maxBuysPerSession) {
      return;
    }

    const filterResult = await runSafetyFilters(token, keypair);
    if (!filterResult.passed) {
      // Log noise concern: in watchlist mode almost every pump.fun token fails the
      // whitelist check (that's the point), so only log a "Skipping" line for tokens from a
      // watched dev that got filtered out for some *other* reason. In "all" mode there's no
      // whitelist-noise source left, so every skip reason is worth surfacing.
      if (botState.snipeMode === "all" || botState.watchedDevWallets.includes(token.creator)) {
        botState.log(
          "warn",
          `Skipping ${token.symbol ?? token.mint}: ${filterResult.reasons.join("; ")}`
        );
      }
      return;
    }

    if (botState.maxBuysPerSession > 0 && botState.buysThisSession >= botState.maxBuysPerSession) {
      return; // re-check: another detection could have filled the cap while we awaited filters above
    }
    botState.buysThisSession += 1;

    await executeBuy(keypair, token);

    if (botState.maxBuysPerSession > 0 && botState.buysThisSession >= botState.maxBuysPerSession) {
      botState.log(
        "warn",
        `Buy cap reached (${botState.buysThisSession}/${botState.maxBuysPerSession}) — stopping engine automatically.`
      );
      stopEngine();
    }
  });

  botState.start();
  botState.log(
    "info",
    `Engine started. Mode=${botState.snipeMode === "all" ? "SNIPE ALL" : "WATCHLIST"}, LIVE_TRADING=${botState.liveTrading} — ${
      botState.liveTrading ? "REAL trades will be submitted." : "dry-run only, no real trades."
    }`
  );
}

export function stopEngine() {
  if (!botState.running) {
    botState.log("warn", "Engine already stopped.");
    return;
  }
  if (stopListener) {
    stopListener();
    stopListener = null;
  }
  botState.stop();
  botState.log("info", "Engine stopped.");
}
