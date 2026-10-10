import { AnchorProvider, Wallet as AnchorWallet } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
// pumpdotfun-sdk: community SDK wrapping pump.fun's Anchor program (create/buy/sell +
// on-chain event subscriptions). We rely on it instead of hand-encoding raw pump.fun
// instructions ourselves, because getting bonding-curve math / instruction layout wrong
// is exactly the kind of bug that silently loses real SOL.
//
// IMPORTANT: this is a third-party package that can change its API between versions.
// Pin the version in package.json, read its README after `npm install`, and adjust the
// calls in this file (and pumpfunListener.ts / buy.ts) to match if anything doesn't
// compile. Do not assume this file is correct without testing it yourself against devnet
// or a tiny amount first.
// https://www.npmjs.com/package/pumpdotfun-sdk
import { PumpFunSDK } from "pumpdotfun-sdk";
import { getConnection } from "../wallet";

let sdkInstance: PumpFunSDK | null = null;

export function getPumpFunSdk(keypair: Keypair): PumpFunSDK {
  if (sdkInstance) return sdkInstance;
  const connection = getConnection();
  const wallet = new AnchorWallet(keypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  sdkInstance = new PumpFunSDK(provider);
  return sdkInstance;
}
