# Solana Sniper Bot (MVP)

Bot auto-buy token pump.fun baru saat pertama kali di-deploy, dengan kontrol dari dashboard
web lokal dan/atau Telegram.

## Baca ini dulu — risiko nyata

- **Mayoritas token baru di pump.fun adalah scam/rug/honeypot.** Bot ini mendeteksi dan
  membeli secepat mungkin, tapi kecepatan tidak membuat token jadi aman. Filter keamanan di
  `src/trade/filters.ts` hanya menyaring hal yang murah dicek (mint/freeze authority,
  minimum reserve) — bukan jaminan token legit.
- **Kamu akan sering kalah cepat dari bot lain** yang pakai RPC privat/Jito bundling dan
  infrastruktur lebih mahal. RPC publik gratis di `.env.example` terlalu lambat untuk
  sniping serius — ini cukup untuk belajar & tes wiring, bukan untuk kompetisi latency
  sungguhan.
- **Jangan pernah pakai wallet utama.** Buat wallet baru khusus bot ini, isi hanya dengan
  jumlah yang siap kamu anggap hilang 100%.
- Bot start dengan `LIVE_TRADING=false` (dry-run, cuma log — tidak kirim transaksi
  sungguhan). Jangan nyalakan live trading sebelum kamu benar-benar paham alur kodenya dan
  sudah lihat log dry-run masuk akal.

## Setup

```bash
npm install
cp .env.example .env
# isi .env: PRIVATE_KEY, RPC_HTTP_URL/RPC_WSS_URL, TELEGRAM_BOT_TOKEN (opsional), dll.
npm run dev      # mode development (ts-node-dev)
# atau
npm run build && npm start
```

Setelah jalan:
- Dashboard: `http://localhost:3000` (masukkan `WEB_DASHBOARD_TOKEN` dari `.env`)
- Telegram: chat bot kamu, kirim `/help`

Engine (listener + auto-buy) **tidak otomatis jalan** saat proses start — kamu harus tekan
Start di dashboard atau kirim `/start` di Telegram. Ini sengaja, supaya kamu tidak pernah
lupa sedang dalam mode apa (dry-run vs live).

## Arsitektur

```
src/
  config.ts              # load & validasi .env
  state.ts                # shared in-memory state + event bus (dipakai web & telegram)
  devWalletsStore.ts        # persist watched dev-wallet whitelist ke data/watched-dev-wallets.json
  wallet.ts                # load keypair dari PRIVATE_KEY, koneksi RPC
  engine.ts                 # orkestrasi: listener -> filter -> buy
  listener/pumpfunListener.ts   # subscribe event "create" pump.fun (deteksi token baru)
  trade/filters.ts          # safety filter (mint/freeze authority, min reserves, dev wallet whitelist, max creator buy)
  trade/buy.ts               # eksekusi (atau simulasi) buy + mulai tracking posisi
  trade/sell.ts               # eksekusi (atau simulasi) sell satu posisi
  trade/positionMonitor.ts     # polling bonding curve tiap posisi terbuka, trigger take-profit/stop-loss
  trade/priorityFee.ts          # konversi priority fee (SOL) -> micro-lamports/CU
  trade/pumpfunClient.ts      # wrapper pumpdotfun-sdk (Anchor provider)
  web/server.ts               # REST API + serve dashboard
  telegram/bot.ts              # command handler + push notification
public/index.html            # dashboard (vanilla JS, polling tiap 2 detik)
```

## Hal yang WAJIB kamu cek sebelum live trading

1. **Versi `pumpdotfun-sdk` bisa berubah API-nya.** File `src/trade/pumpfunClient.ts`,
   `src/listener/pumpfunListener.ts`, dan `src/trade/buy.ts` ditulis mengikuti bentuk API
   versi 1.x yang umum dipakai contoh publik. Setelah `npm install`, baca
   `node_modules/pumpdotfun-sdk/README.md` dan cocokkan — kalau `tsc` error di salah satu
   file itu, itu tandanya API SDK sudah berubah, bukan bug logika.
2. **Test di devnet atau dengan jumlah sangat kecil dulu** (`BUY_AMOUNT_SOL=0.001`) sebelum
   scale up.
3. **RPC gratis akan rate-limit / lambat.** Untuk sniping serius, pakai provider seperti
   Helius/QuickNode/Triton dengan endpoint dedicated + pertimbangkan Jito bundle untuk
   priority landing.
4. Token yang sudah migrasi keluar dari bonding curve pump.fun (setelah market cap
   tertentu) tidak lagi bisa di-trade lewat `PumpFunSDK.buy` — itu butuh swap lewat
   Raydium/Jupiter. Bot ini fokus pada window sniping di bonding curve pump.fun saja
   (paling relevan untuk "beli begitu deploy").

## Fitur dashboard

Selain start/stop engine, dashboard `http://localhost:3000` bisa mengatur (langsung berlaku,
tanpa restart):

- Buy amount, slippage beli & jual (persen terpisah), priority fee (dalam SOL, bukan lamport),
  dan saldo wallet (live dari RPC, di-cache 4 detik).
- Take profit % & stop loss % — posisi yang berhasil dibeli otomatis dipantau
  (`src/trade/positionMonitor.ts`, cek tiap ~4 detik lewat bonding curve) dan dijual otomatis
  (100%) kalau target kena. Bisa juga jual manual sebagian dari tabel posisi — tombol 33% /
  50% / 100% — tanpa mematikan auto-sell TP/SL untuk sisa posisinya.
- Max creator buy (SOL) — kalau saat mau beli ternyata creator sudah menyuntik lebih dari
  jumlah ini ke bonding curve (dev-buy sendiri), bot batal beli. Ini **filter pra-beli**, bukan
  pembatalan transaksi yang sudah terkirim — begitu tx dikirim ke jaringan tidak bisa ditarik lagi.
- **Mode sniping** — toggle "Watchlist" vs "Snipe All":
  - **Watchlist** (default, aman): bot **hanya** snipe token yang creator-nya ada di daftar
    Watched Dev Wallets. Daftar kosong = bot tidak snipe siapa pun (bukan "snipe semua").
  - **Snipe All**: bot coba beli **semua** token baru yang lolos filter keamanan dasar (min
    reserves, mint/freeze authority revoked, max creator buy), tanpa peduli watchlist. Jauh
    lebih agresif/berisiko — dashboard mewajibkan kamu isi "Maksimal token dibeli per sesi"
    (>0) dulu sebelum boleh pindah ke mode ini, karena tidak ada rem lain untuk total
    pembelian. Begitu batas tercapai, engine berhenti otomatis.
- Watched dev wallets — daftar alamat wallet dev yang kamu percaya coin-nya sering graduate,
  dipakai saat mode Watchlist aktif. Tersimpan di `data/watched-dev-wallets.json` supaya
  tidak hilang saat restart.

## Yang belum ada (bisa ditambah selanjutnya)

- Deteksi bundled/sniper wallet pada wallet creator (indikator rug tambahan)
- Multi-wallet / wallet rotation
- Dukungan chain lain (EVM/BSC/Base)
- Persistensi untuk log/trade history/posisi (saat ini di memori, hilang saat restart — hanya
  watched dev wallets yang persisten)
