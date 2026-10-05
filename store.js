import fs from "node:fs";
const DIR = "data", FILE = `${DIR}/rounds.json`, KEEP = 2000;
let rounds = [];
try { rounds = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch {}

export function addRound(r) {
  rounds.push(r);
  if (rounds.length > KEEP) rounds = rounds.slice(-KEEP);
  try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(rounds)); } catch {}
}
export const recent = (n = 30) => rounds.slice(-n).reverse();

const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
};

export function stats() {
  const out = {};
  for (const r of rounds) for (const [path, v] of Object.entries(r.paths)) {
    const o = (out[path] ||= { sent: 0, landed: 0, ms: [], lag: [], cost: 0 });
    o.sent++; o.cost += v.costLamports || 0;
    if (v.status === "landed") { o.landed++; o.ms.push(v.landMs); o.lag.push(v.slotLag ?? 0); }
  }
  return Object.fromEntries(Object.entries(out).map(([k, o]) => [k, {
    sent: o.sent, landed: o.landed,
    landRate: o.sent ? o.landed / o.sent : 0,
    medianMs: pct(o.ms, 0.5), p95Ms: pct(o.ms, 0.95),
    avgSlotLag: o.lag.length ? o.lag.reduce((a, b) => a + b, 0) / o.lag.length : null,
    avgCostLamports: o.sent ? Math.round(o.cost / o.sent) : 0,
  }]));
}
