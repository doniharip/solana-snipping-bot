import * as fs from "fs";
import * as path from "path";

// Runs from dist/devWalletsStore.js, so ".." lands back at the project root — same pattern
// web/server.ts uses to find public/.
const DATA_DIR = path.join(__dirname, "..", "data");
const FILE_PATH = path.join(DATA_DIR, "watched-dev-wallets.json");

/**
 * The watched dev-wallet whitelist is the one piece of state worth surviving a restart —
 * unlike everything else in state.ts, it's a curated list the user builds up over time, not
 * ephemeral run state. Best-effort file persistence; falls back to .env's WATCHED_DEV_WALLETS
 * (handled by the caller) if the file doesn't exist yet or can't be read.
 */
export function loadWatchedWallets(): string[] {
  try {
    const raw = fs.readFileSync(FILE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function saveWatchedWallets(wallets: string[]): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE_PATH, JSON.stringify(wallets, null, 2), "utf-8");
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error(`Failed to persist watched dev wallets to ${FILE_PATH}:`, err?.message ?? err);
  }
}
