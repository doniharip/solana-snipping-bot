import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import { getPumpFunSdk } from "./pumpfunClient";
import { computeUnitPriceMicroLamports, DEFAULT_UNIT_LIMIT } from "./priorityFee";
import { getConnection } from "../wallet";
import { botState } from "../state";
import { DetectedToken, TradeResult } from "../types";

/**
 * Executes (or, if LIVE_TRADING=false, simulates) a buy of `botState.buyAmountSol` worth of
 * the given token on its pump.fun bonding curve.
 */
export async function executeBuy(keypair: Keypair, token: DetectedToken): Promise<TradeResult> {
  const amountSol = botState.buyAmountSol;
  const dryRun = !botState.liveTrading;

  if (dryRun) {
    botState.log(
      "warn",
      `[DRY RUN] Would buy ${amountSol} SOL of ${token.symbol ?? token.mint} (${token.mint}). ` +
        `Set LIVE_TRADING=true (and toggle it in the dashboard) once you trust the pipeline.`
    );
    const result: TradeResult = {
      ok: true,
      mint: token.mint,
      dryRun: true,
      amountSol,
      side: "buy",
      timestamp: Date.now(),
    };
    botState.addTrade(result);
    return result;
  }

  try {
    const sdk = getPumpFunSdk(keypair);
    const mint = new PublicKey(token.mint);

    const buyAmountLamports = BigInt(Math.round(amountSol * LAMPORTS_PER_SOL));
    const slippageBasisPoints = BigInt(Math.round(botState.slippageBuyPercent * 100));
    const unitPrice = computeUnitPriceMicroLamports(botState.priorityFeeSol, DEFAULT_UNIT_LIMIT);

    const txResult = await sdk.buy(
      keypair,
      mint,
      buyAmountLamports,
      slippageBasisPoints,
      {
        unitLimit: DEFAULT_UNIT_LIMIT,
        unitPrice,
      },
      "confirmed"
    );

    const signature = txResult.signature;
    const success = txResult.success;

    const result: TradeResult = {
      ok: success,
      mint: token.mint,
      signature,
      dryRun: false,
      amountSol,
      side: "buy",
      timestamp: Date.now(),
      error: success ? undefined : "transaction did not confirm as successful",
    };
    botState.addTrade(result);
    botState.log(
      success ? "info" : "error",
      success
        ? `BOUGHT ${amountSol} SOL of ${token.mint} — tx ${signature}`
        : `Buy failed for ${token.mint}`
    );

    if (success) {
      await trackNewPosition(keypair, token, amountSol, signature);
    }

    return result;
  } catch (err: any) {
    const result: TradeResult = {
      ok: false,
      mint: token.mint,
      dryRun: false,
      amountSol,
      side: "buy",
      timestamp: Date.now(),
      error: err?.message ?? String(err),
    };
    botState.addTrade(result);
    botState.log("error", `Buy error for ${token.mint}: ${result.error}`);
    return result;
  }
}

/**
 * Reads back the actual token balance received (post-slippage) and records a Position so
 * the take-profit/stop-loss monitor (trade/positionMonitor.ts) starts watching it. Best
 * effort: if this fails, the buy itself already succeeded — we just log and move on rather
 * than fail the trade over a tracking problem.
 */
async function trackNewPosition(
  keypair: Keypair,
  token: DetectedToken,
  amountSolSpent: number,
  buySignature?: string
) {
  try {
    const mint = new PublicKey(token.mint);
    const ata = getAssociatedTokenAddressSync(mint, keypair.publicKey);
    const account = await getAccount(getConnection(), ata, "confirmed");
    const tokenAmount = account.amount;
    if (tokenAmount <= 0n) {
      botState.log("warn", `Bought ${token.mint} but token balance reads 0 — skipping TP/SL tracking.`);
      return;
    }

    // Effective price actually paid (post-slippage), in lamports per raw token unit.
    const entryPriceSolPerToken = (amountSolSpent * LAMPORTS_PER_SOL) / Number(tokenAmount);

    botState.addPosition({
      mint: token.mint,
      symbol: token.symbol,
      creator: token.creator,
      entryPriceSolPerToken,
      tokenAmount: tokenAmount.toString(),
      amountSolSpent,
      takeProfitPercent: botState.takeProfitPercent,
      stopLossPercent: botState.stopLossPercent,
      openedAt: Date.now(),
      buySignature,
    });
    botState.log(
      "info",
      `Tracking position ${token.symbol ?? token.mint}: TP +${botState.takeProfitPercent}% / SL -${botState.stopLossPercent}%`
    );
  } catch (err: any) {
    botState.log(
      "warn",
      `Could not read post-buy token balance for ${token.mint}, TP/SL tracking skipped: ${err?.message ?? err}`
    );
  }
}
