import { Keypair, PublicKey } from "@solana/web3.js";
import { getPumpFunSdk } from "./pumpfunClient";
import { computeUnitPriceMicroLamports, DEFAULT_UNIT_LIMIT } from "./priorityFee";
import { botState } from "../state";
import { Position, TradeResult } from "../types";

/**
 * Sells all or part of an open position (or, if LIVE_TRADING=false, simulates it). Called by
 * the take-profit/stop-loss monitor (always sellPercent=100, full exit) and by the manual
 * "sell now" dashboard action (33/50/100%, user's choice) — same code path either way.
 */
export async function executeSell(
  keypair: Keypair,
  position: Position,
  reason: "take-profit" | "stop-loss" | "manual",
  sellPercent: number = 100
): Promise<TradeResult> {
  const dryRun = !botState.liveTrading;
  const pct = Math.min(100, Math.max(1, sellPercent));

  const totalTokenAmount = BigInt(position.tokenAmount);
  const rawSellAmount = pct >= 100 ? totalTokenAmount : (totalTokenAmount * BigInt(Math.round(pct * 100))) / 10000n;
  // Guards a near-dust remaining position (e.g. repeated partial sells) where percent math
  // would otherwise round down to 0 raw units and send a no-op sell to the chain.
  const sellTokenAmount = rawSellAmount > 0n ? rawSellAmount : totalTokenAmount;
  const isFullSell = sellTokenAmount >= totalTokenAmount;
  const remainingTokenAmount = totalTokenAmount - sellTokenAmount;
  // Cost basis of the slice being sold, proportional to how much of the position it is —
  // keeps "SOL masuk" on whatever position remains accurate after a partial sell.
  const soldAmountSolBasis =
    (position.amountSolSpent * Number(sellTokenAmount)) / Number(totalTokenAmount);

  // Remove from the tracked list up front so a slow-confirming tx doesn't get double-sold
  // by the next monitor tick. Re-added (in full, or reduced) below depending on outcome.
  botState.removePosition(position.mint);

  function keepRemainder() {
    if (!isFullSell) {
      botState.addPosition({
        ...position,
        tokenAmount: remainingTokenAmount.toString(),
        amountSolSpent: position.amountSolSpent - soldAmountSolBasis,
      });
    }
  }

  if (dryRun) {
    botState.log(
      "warn",
      `[DRY RUN] Would sell ${pct}% of position ${position.symbol ?? position.mint} (${reason}).`
    );
    const result: TradeResult = {
      ok: true,
      mint: position.mint,
      dryRun: true,
      amountSol: soldAmountSolBasis,
      side: "sell",
      reason,
      timestamp: Date.now(),
    };
    botState.addTrade(result);
    keepRemainder();
    return result;
  }

  try {
    const sdk = getPumpFunSdk(keypair);
    const mint = new PublicKey(position.mint);
    const slippageBasisPoints = BigInt(Math.round(botState.slippageSellPercent * 100));
    const unitPrice = computeUnitPriceMicroLamports(botState.priorityFeeSol, DEFAULT_UNIT_LIMIT);

    const txResult = await sdk.sell(
      keypair,
      mint,
      sellTokenAmount,
      slippageBasisPoints,
      {
        unitLimit: DEFAULT_UNIT_LIMIT,
        unitPrice,
      },
      "confirmed"
    );

    const success = txResult.success;
    const result: TradeResult = {
      ok: success,
      mint: position.mint,
      signature: txResult.signature,
      dryRun: false,
      amountSol: soldAmountSolBasis,
      side: "sell",
      reason,
      timestamp: Date.now(),
      error: success ? undefined : "sell transaction did not confirm as successful",
    };
    botState.addTrade(result);
    botState.log(
      success ? "info" : "error",
      success
        ? `SOLD ${pct}% of ${position.symbol ?? position.mint} (${reason}) — tx ${txResult.signature}`
        : `Sell failed for ${position.mint} (${reason})`
    );

    if (success) {
      keepRemainder();
    } else {
      botState.addPosition(position); // sell failed outright — restore full position, retry later
    }
    return result;
  } catch (err: any) {
    const result: TradeResult = {
      ok: false,
      mint: position.mint,
      dryRun: false,
      amountSol: soldAmountSolBasis,
      side: "sell",
      reason,
      timestamp: Date.now(),
      error: err?.message ?? String(err),
    };
    botState.addTrade(result);
    botState.log("error", `Sell error for ${position.mint} (${reason}): ${result.error}`);
    botState.addPosition(position); // restore full position, retry later
    return result;
  }
}
