import { Connection, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { config } from "./config";
import { botState } from "./state";

export function loadKeypair(): Keypair {
  if (!config.privateKey) {
    throw new Error(
      "PRIVATE_KEY is not set in .env. Create a dedicated wallet for this bot and export " +
        "its base58 private key (Phantom: Settings > Export Private Key)."
    );
  }
  try {
    const secret = bs58.decode(config.privateKey);
    const kp = Keypair.fromSecretKey(secret);
    botState.walletAddress = kp.publicKey.toBase58();
    return kp;
  } catch (e) {
    throw new Error(
      "Could not parse PRIVATE_KEY. Make sure it is the base58-encoded secret key, not a seed phrase or file path."
    );
  }
}

export function getConnection(): Connection {
  return new Connection(config.rpcHttpUrl, {
    commitment: "confirmed",
    wsEndpoint: config.rpcWssUrl,
  });
}
