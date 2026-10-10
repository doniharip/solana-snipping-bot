import { Keypair, PublicKey } from "@solana/web3.js";
import { getPumpFunSdk } from "./pumpfunClient";
import { executeSell } from "./sell";
import { botState } from "../state";

const POLL_INTERVAL_MS = 4000;

let timer: ReturnType<typeof setInterval> | null = null;
let checking = false;

/**
 * Polls the bonding curve of every open position and sells (take-profit or stop-loss) when
 * the configured target is hit. Runs for the lifetime of the process, independent of the
 * detection engine's start/stop — closing an already-open position shouldn't depend on
 * whether you're still actively hunting for new tokens.
 */
export function startPositionMonitor(keypair: Keypair) {
  if (timer) return;
  timer = setInterval(() => {
    if (checking) return; // skip overlapping ticks if a previous check is still in flight
    checking = true;
    checkPositions(keypair)
      .catch((err: any) => botState.log("error", `Position monitor error: ${err?.message ?? err}`))
      .finally(() => {
        checking = false;
      });
  }, POLL_INTERVAL_MS);
  botState.log("info", "Position monitor started (take-profit / stop-loss watcher).");
}

export function stopPositionMonitor() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Current unrealized PnL % for a position, based on live bonding curve reserves. */
export function computeLivePnlPercent(entryPriceSolPerToken: number, virtualSolReserves: bigint, virtualTokenReserves: bigint): number | null {
  if (virtualTokenReserves <= 0n || entryPriceSolPerToken <= 0) return null;
  const currentPrice = Number(virtualSolReserves) / Number(virtualTokenReserves);
  return (currentPrice / entryPriceSolPerToken - 1) * 100;
}

async function checkPositions(keypair: Keypair) {
  if (botState.positions.length === 0) return;
  const sdk = getPumpFunSdk(keypair);

  for (const position of [...botState.positions]) {
    try {
      const curve = await sdk.getBondingCurveAccount(new PublicKey(position.mint));
      if (!curve) continue;

      const pnlPercent = computeLivePnlPercent(
        position.entryPriceSolPerToken,
        curve.virtualSolReserves,
        curve.virtualTokenReserves
      );
      if (pnlPercent === null) continue;

      let reason: "take-profit" | "stop-loss" | null = null;
      if (position.takeProfitPercent > 0 && pnlPercent >= position.takeProfitPercent) {
        reason = "take-profit";
      } else if (position.stopLossPercent > 0 && pnlPercent <= -position.stopLossPercent) {
        reason = "stop-loss";
      }

      if (reason) {
        botState.log(
          "warn",
          `${reason === "take-profit" ? "TAKE PROFIT" : "STOP LOSS"} hit for ${
            position.symbol ?? position.mint
          } (${pnlPercent.toFixed(1)}%) — selling.`
        );
        await executeSell(keypair, position, reason);
      }
    } catch (err: any) {
      botState.log("error", `Position monitor: failed to check ${position.mint}: ${err?.message ?? err}`);
    }
  }
}
