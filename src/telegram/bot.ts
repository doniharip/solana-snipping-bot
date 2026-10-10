import TelegramBot from "node-telegram-bot-api";
import { Keypair } from "@solana/web3.js";
import { config } from "../config";
import { botState } from "../state";
import { startEngine, stopEngine } from "../engine";

function isAllowed(userId: number | undefined): boolean {
  if (!userId) return false;
  if (config.telegramAllowedUserIds.length === 0) {
    // No allowlist configured: refuse everyone rather than silently being open to the world.
    return false;
  }
  return config.telegramAllowedUserIds.includes(userId);
}

export function startTelegramBot(keypair: Keypair) {
  if (!config.telegramBotToken) {
    botState.log("warn", "TELEGRAM_BOT_TOKEN not set — Telegram control disabled.");
    return null;
  }
  if (config.telegramAllowedUserIds.length === 0) {
    botState.log(
      "warn",
      "TELEGRAM_ALLOWED_USER_IDS not set — Telegram control disabled (would otherwise be " +
        "open to anyone who finds your bot)."
    );
    return null;
  }

  const bot = new TelegramBot(config.telegramBotToken, { polling: true });

  function guard(msg: TelegramBot.Message, handler: () => void) {
    if (!isAllowed(msg.from?.id)) {
      bot.sendMessage(msg.chat.id, "⛔ Kamu tidak diizinkan mengontrol bot ini.");
      botState.log("warn", `Unauthorized Telegram access attempt from user ${msg.from?.id}`);
      return;
    }
    handler();
  }

  bot.onText(/\/start$/, (msg) => {
    guard(msg, () => {
      startEngine(keypair);
      bot.sendMessage(
        msg.chat.id,
        `▶️ Engine started. Mode: ${botState.liveTrading ? "🔴 LIVE" : "🔵 DRY RUN"}`
      );
    });
  });

  bot.onText(/\/stop$/, (msg) => {
    guard(msg, () => {
      stopEngine();
      bot.sendMessage(msg.chat.id, "⏹ Engine stopped.");
    });
  });

  bot.onText(/\/status$/, (msg) => {
    guard(msg, () => {
      const s = botState.snapshot();
      bot.sendMessage(
        msg.chat.id,
        [
          `Engine: ${s.running ? "RUNNING" : "STOPPED"}`,
          `Mode: ${s.liveTrading ? "LIVE" : "DRY RUN"}`,
          `Wallet: ${s.walletAddress ?? "-"}`,
          `Buy amount: ${s.buyAmountSol} SOL`,
          `Slippage: buy ${s.slippageBuyPercent}% / sell ${s.slippageSellPercent}%`,
          `Priority fee: ${s.priorityFeeSol} SOL`,
          `Take profit: +${s.takeProfitPercent}% / Stop loss: -${s.stopLossPercent}%`,
          `Max creator buy: ${s.maxCreatorBuySol > 0 ? s.maxCreatorBuySol + " SOL" : "off"}`,
          `Watched dev wallets: ${s.watchedDevWalletsCount}`,
          `Open positions: ${s.openPositions}`,
          `Tokens detected: ${s.tokensDetected}`,
          `Trades: ${s.tradesSucceeded}/${s.tradesAttempted} succeeded`,
        ].join("\n")
      );
    });
  });

  bot.onText(/\/setamount (\d+(\.\d+)?)/, (msg, match) => {
    guard(msg, () => {
      const amount = parseFloat(match![1]);
      botState.buyAmountSol = amount;
      bot.sendMessage(msg.chat.id, `✅ Buy amount diset ke ${amount} SOL`);
    });
  });

  bot.onText(/\/setslippage (\d+(\.\d+)?)/, (msg, match) => {
    guard(msg, () => {
      const pct = parseFloat(match![1]);
      botState.slippageBuyPercent = pct;
      botState.slippageSellPercent = pct;
      bot.sendMessage(msg.chat.id, `✅ Slippage (buy & sell) diset ke ${pct}%`);
    });
  });

  bot.onText(/\/live (on|off)/, (msg, match) => {
    guard(msg, () => {
      const on = match![1] === "on";
      botState.liveTrading = on;
      bot.sendMessage(
        msg.chat.id,
        on
          ? "🔴 LIVE TRADING DIAKTIFKAN. Bot akan submit transaksi beli sungguhan."
          : "🔵 Live trading dimatikan, kembali ke dry run."
      );
    });
  });

  bot.onText(/\/help$/, (msg) => {
    guard(msg, () => {
      bot.sendMessage(
        msg.chat.id,
        [
          "/start - jalankan engine",
          "/stop - hentikan engine",
          "/status - lihat status",
          "/setamount <sol> - set jumlah beli per snipe",
          "/setslippage <persen> - set slippage",
          "/live on|off - aktif/nonaktifkan live trading",
        ].join("\n")
      );
    });
  });

  // Push notifications for detected tokens / trades to all allowed users.
  botState.on("token", (t) => {
    for (const uid of config.telegramAllowedUserIds) {
      bot
        .sendMessage(uid, `🔎 Token baru: ${t.symbol ?? "?"}\nMint: ${t.mint}`)
        .catch(() => {});
    }
  });
  botState.on("trade", (t) => {
    for (const uid of config.telegramAllowedUserIds) {
      const label = t.dryRun ? "DRY RUN" : t.ok ? "✅ BERHASIL" : "❌ GAGAL";
      bot
        .sendMessage(uid, `${label} beli ${t.amountSol} SOL\nMint: ${t.mint}${t.signature ? `\nTx: ${t.signature}` : ""}`)
        .catch(() => {});
    }
  });

  botState.log("info", "Telegram bot started.");
  return bot;
}
