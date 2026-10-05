# Landing Race

A live, always-on benchmark of Solana transaction landing. Every few minutes it sends the **same kind of transaction down three paths at once** and publishes who landed first, with a Solscan link for every transaction.

| Path | How it's sent |
|---|---|
| `public` | Public mainnet RPC (`sendTransaction`) |
| `solami` | Solami RPC (`rpc.solami.dev`) |
| `beam` | Solami Beam (QUIC straight to leaders, with an on-chain tip) |

A single neutral observer (Solami RPC) polls signature statuses, so every path is timed the same way. The leaderboard shows median and p95 landing time, landing rate, slot lag versus the fastest path, and the average cost per send (Beam's tip is shown, not hidden).

**Solami products used:** RPC (sending, blockhash, status polling, balance), Beam (priority sending + tip addresses + `/swqos/tx` lookup), Data API (`/onchain/tip-addresses`).

## Run it with your own key

1. `git clone` this repo, then `npm install` (Node 20+).
2. Create a Solami account at https://solami.dev, then make an **API key** and a **SwQoS key** in the dashboard.
3. Make a **fresh burner wallet**. Never use your main wallet. Fund it with about 0.02 SOL. One round of all paths costs about 0.000115 SOL.
4. `cp .env.example .env` and fill in:
   - `RPC_TOKEN`: your Solami API key
   - `KEYPAIR`: base58 secret key of the burner
   - `SWQOS_TOKEN`: your SwQoS key (leave empty to skip Beam)
5. `npm start`, then open http://localhost:3000

Use `ROUND_INTERVAL_MIN` to control spend. Rounds pause automatically if the wallet drops below 0.001 SOL.

## Deploy
Beam uses a native QUIC module, so it needs a long-running Node host (Railway, Render, Fly), not Vercel. Set the same env vars there.

## Honest limits
- Landing time resolution is about 250 ms because of polling.
- Results are a sample of this wallet over time, not a universal benchmark.
- `POST /api/run` (manual round) needs `ADMIN_TOKEN`, so the public page can't drain the wallet.
