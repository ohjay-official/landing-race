import express from "express";
import { payer, runRound, balanceSol, activePaths } from "./sender.js";
import { addRound, recent, stats } from "./store.js";

const INTERVAL = Number(process.env.ROUND_INTERVAL_MIN || 15) * 60_000;
const MIN_SOL = 0.001;
const app = express();
app.get("/", (_, res) => res.sendFile("index.html", { root: process.cwd() }));

const clients = new Set();
let health = { lastRoundAt: null, lastError: null, balanceSol: null, running: false };
const snapshot = () => ({
  rounds: recent(30), stats: stats(), health,
  config: { wallet: payer.publicKey.toBase58(), intervalMin: INTERVAL / 60000, paths: activePaths() },
});
const push = () => { const d = `data: ${JSON.stringify(snapshot())}\n\n`; clients.forEach((c) => c.write(d)); };

async function tick() {
  if (health.running) return;
  health.running = true;
  try {
    health.balanceSol = await balanceSol();
    if (health.balanceSol < MIN_SOL) throw new Error(`Wallet low (${health.balanceSol.toFixed(4)} SOL). Top up to continue.`);
    addRound(await runRound());
    health.lastRoundAt = Date.now(); health.lastError = null;
  } catch (e) { health.lastError = String(e.message || e); console.error(health.lastError); }
  health.running = false; push();
}

app.get("/api/state", (_, res) => res.json(snapshot()));
app.get("/events", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
  clients.add(res); req.on("close", () => clients.delete(res));
});
app.post("/api/run", (req, res) => {
  if (!process.env.ADMIN_TOKEN || req.get("x-admin-token") !== process.env.ADMIN_TOKEN) return res.sendStatus(401);
  tick(); res.json({ started: true });
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Landing Race on :${process.env.PORT || 3000} | wallet ${payer.publicKey.toBase58()} | paths ${activePaths()}`);
  if (process.env.RUN_ON_START !== "false") tick();
  setInterval(tick, INTERVAL);
});
