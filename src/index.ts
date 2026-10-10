import { loadKeypair } from "./wallet";
import { botState } from "./state";
import { startWebServer } from "./web/server";
import { startTelegramBot } from "./telegram/bot";
import { startPositionMonitor } from "./trade/positionMonitor";
import { config } from "./config";

async function main() {
  botState.log("info", "Starting solana-sniper-bot...");

  if (config.liveTrading) {
    botState.log(
      "warn",
      "LIVE_TRADING=true in .env — the bot will submit real buy transactions as soon as you press Start."
    );
  } else {
    botState.log("info", "LIVE_TRADING=false — running in dry-run mode. No real transactions will be sent.");
  }
  botState.liveTrading = config.liveTrading;

  const keypair = loadKeypair();
  botState.log("info", `Wallet loaded: ${keypair.publicKey.toBase58()}`);

  startWebServer(keypair);
  startTelegramBot(keypair);
  // Runs independently of the detection engine below: an open position still needs its
  // take-profit/stop-loss watched even while you're not actively hunting for new tokens.
  startPositionMonitor(keypair);

  // NOTE: the engine (listener + auto-buy) does NOT start automatically here.
  // Start it explicitly from the dashboard or with /start in Telegram, so you always
  // consciously choose when detection + trading begins.
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal error on startup:", err);
  process.exit(1);
});
