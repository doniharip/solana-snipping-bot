const { Keypair } = require("@solana/web3.js");
const bs58 = require("bs58");

const kp = Keypair.generate();
console.log("Address :", kp.publicKey.toBase58());
console.log("Private :", bs58.encode(kp.secretKey)); // ini yang masuk ke PRIVATE_KEY di .env