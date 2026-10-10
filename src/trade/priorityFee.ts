import { LAMPORTS_PER_SOL } from "@solana/web3.js";

// Compute unit budget requested per buy/sell tx (matches what pumpdotfun-sdk's example
// callers use). Priority fee math below depends on this being the actual unitLimit passed
// alongside unitPrice — keep them paired.
export const DEFAULT_UNIT_LIMIT = 300_000;

/**
 * Solana priority fees are set as a compute-unit *price* (micro-lamports per CU), not a
 * total SOL amount — but thinking in total SOL is much more intuitive than picking a
 * micro-lamports/CU number out of the air. This converts a target total priority fee (in
 * SOL) into the unitPrice value pumpdotfun-sdk's PriorityFee expects, given the compute
 * unit limit the transaction will request:
 *
 *   totalFeeLamports = unitPriceMicroLamports * unitLimit / 1_000_000
 *   => unitPriceMicroLamports = totalFeeLamports * 1_000_000 / unitLimit
 */
export function computeUnitPriceMicroLamports(
  priorityFeeSol: number,
  unitLimit: number = DEFAULT_UNIT_LIMIT
): number {
  if (!(priorityFeeSol > 0) || !(unitLimit > 0)) return 0;
  const feeLamports = priorityFeeSol * LAMPORTS_PER_SOL;
  return Math.max(0, Math.round((feeLamports * 1_000_000) / unitLimit));
}
