import { Keypair, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { getConnection } from "../wallet";
import { getPumpFunSdk } from "./pumpfunClient";
import { config } from "../config";
import { botState } from "../state";
import { DetectedToken, FilterResult } from "../types";

/**
 * Cheap, fast on-chain checks run before committing to a buy. These do NOT guarantee a
 * token is safe (pump.fun tokens can't have a freeze/mint authority to begin with — the
 * real risks are creator dumping, bundled sniper wallets, and post-migration LP pulls —
 * but they catch the cheapest, most obvious scams and are effectively free latency-wise).
 * Toggle via .env; keep them on unless you know exactly why you're turning one off.
 */
export async function runSafetyFilters(token: DetectedToken, keypair: Keypair): Promise<FilterResult> {
  const reasons: string[] = [];

  // Dev-wallet whitelist only applies in "watchlist" mode. In "all" mode the engine tries to
  // buy every new token (subject to the safety filters below) — see src/state.ts snipeMode.
  // Checked first and cheaply (no RPC call) since it rules out most tokens with zero latency cost.
  if (botState.snipeMode === "watchlist" && !botState.watchedDevWallets.includes(token.creator)) {
    reasons.push(
      botState.watchedDevWallets.length === 0
        ? "watched dev wallet list is empty — add at least one dev wallet, or switch to Snipe All mode"
        : `creator ${token.creator} is not in the watched dev wallet list`
    );
    return { passed: false, reasons };
  }

  const needsCurve = config.minInitialSolReserves > 0 || botState.maxCreatorBuySol > 0;
  if (needsCurve) {
    try {
      const sdk = getPumpFunSdk(keypair);
      const curve = await sdk.getBondingCurveAccount(new PublicKey(token.mint));
      const virtualSolReserves = curve ? Number(curve.virtualSolReserves) / 1e9 : 0;
      // realSolReserves is actual SOL that has flowed into the curve via trades so far —
      // for a token this fresh that's effectively the creator's own dev-buy (if any).
      const realSolReserves = curve ? Number(curve.realSolReserves) / 1e9 : 0;

      if (config.minInitialSolReserves > 0 && virtualSolReserves < config.minInitialSolReserves) {
        reasons.push(`SOL reserves ${virtualSolReserves} < min ${config.minInitialSolReserves}`);
      }
      if (botState.maxCreatorBuySol > 0 && realSolReserves > botState.maxCreatorBuySol) {
        reasons.push(
          `creator already bought ~${realSolReserves.toFixed(3)} SOL into the curve, exceeds max ${botState.maxCreatorBuySol} SOL`
        );
      }
    } catch (err: any) {
      reasons.push(`could not fetch bonding curve account: ${err?.message ?? err}`);
    }
  }

  if (config.requireMintAuthorityRevoked || config.requireFreezeAuthorityRevoked) {
    try {
      const connection = getConnection();
      const mintInfo = await getMint(connection, new PublicKey(token.mint));
      if (config.requireMintAuthorityRevoked && mintInfo.mintAuthority !== null) {
        reasons.push("mint authority not revoked (creator can mint more supply at will)");
      }
      if (config.requireFreezeAuthorityRevoked && mintInfo.freezeAuthority !== null) {
        reasons.push("freeze authority not revoked (creator can freeze your tokens)");
      }
    } catch (err: any) {
      reasons.push(`could not fetch mint account: ${err?.message ?? err}`);
    }
  }

  return { passed: reasons.length === 0, reasons };
}
