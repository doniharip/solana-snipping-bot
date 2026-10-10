import { Keypair, PublicKey } from "@solana/web3.js";
import { getPumpFunSdk } from "../trade/pumpfunClient";
import { botState } from "../state";
import { DetectedToken } from "../types";

export type NewTokenHandler = (token: DetectedToken) => void;

/**
 * Subscribes to pump.fun's on-chain "create" event, i.e. the moment a new token is
 * deployed on the bonding curve. Fires `onNewToken` for every token as soon as it's seen
 * — filtering (rug checks, min liquidity, etc.) happens downstream, not here, so detection
 * latency stays as low as possible.
 */
export function startPumpFunListener(keypair: Keypair, onNewToken: NewTokenHandler): () => void {
  const sdk = getPumpFunSdk(keypair);

  // pumpdotfun-sdk's "createEvent" payload only carries name/symbol/uri/mint/bondingCurve/user
  // (checked against node_modules/pumpdotfun-sdk/dist/cjs/types.d.ts) — no reserves and no
  // signature on the event itself; the signature comes as the callback's 3rd argument.
  // Reserve/liquidity numbers are fetched separately in trade/filters.ts right before buying,
  // since they change with every trade and the event-time value would already be stale.
  const listenerId = sdk.addEventListener("createEvent", (event, _slot, signature) => {
    try {
      const token: DetectedToken = {
        mint: event.mint.toBase58(),
        creator: event.user.toBase58(),
        name: event.name,
        symbol: event.symbol,
        signature,
        detectedAt: Date.now(),
      };
      botState.addDetectedToken(token);
      // The log panel would otherwise be flooded (pump.fun spawns tokens constantly) — only
      // surface a log line for creators actually on the watchlist, since those are the only
      // ones the engine will ever buy. The detected-tokens table (unfiltered) still records
      // everything for visibility.
      if (botState.watchedDevWallets.includes(token.creator)) {
        botState.log(
          "info",
          `New token detected: ${token.symbol ?? "?"} (${token.mint}) by watched dev ${token.creator}`
        );
      }
      onNewToken(token);
    } catch (err: any) {
      botState.log("error", `Failed to parse createEvent: ${err?.message ?? err}`);
    }
  });

  botState.log("info", "pump.fun listener started, watching for new token deployments...");

  return () => {
    try {
      sdk.removeEventListener(listenerId);
    } catch {
      /* ignore */
    }
    botState.log("info", "pump.fun listener stopped.");
  };
}

export async function getMintPublicKey(mint: string): Promise<PublicKey> {
  return new PublicKey(mint);
}
