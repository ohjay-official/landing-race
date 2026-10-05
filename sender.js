import { Connection, Keypair, PublicKey, SystemProgram, TransactionInstruction,
  TransactionMessage, VersionedTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";
import { beamReady, sendViaBeam } from "./beam.js";

const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const BASE_FEE = 5000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const env = process.env;
export const payer = Keypair.fromSecretKey(bs58.decode(env.KEYPAIR));
const solami = new Connection(`https://rpc.solami.dev/sol?api_key=${env.RPC_TOKEN}`, "confirmed");
const pub = new Connection(env.PUBLIC_RPC || "https://api.mainnet-beta.solana.com", "confirmed");
const TIP = Number(env.TIP_LAMPORTS || 100000);

export const activePaths = () => ["public", "solami", ...(beamReady() ? ["beam"] : [])];

async function tipAddress() {
  const tips = await (await fetch("https://api.solami.dev/onchain/tip-addresses")).json();
  return new PublicKey(tips[Math.floor(Math.random() * tips.length)]);
}

function build(path, roundId, blockhash, tip) {
  const ixs = [new TransactionInstruction({
    programId: MEMO, keys: [],
    data: Buffer.from(`landing-race:${path}:${roundId}`),
  })];
  if (path === "beam") ixs.push(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: tip, lamports: TIP }));
  const msg = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([payer]);
  return { tx, sig: bs58.encode(tx.signatures[0]) };
}

export async function balanceSol() {
  return (await solami.getBalance(payer.publicKey)) / LAMPORTS_PER_SOL;
}

export async function runRound() {
  const roundId = Date.now();
  const paths = activePaths();
  const { blockhash } = await solami.getLatestBlockhash("confirmed");
  const tip = paths.includes("beam") ? await tipAddress() : null;

  const rec = {}, sentAt = {}, built = {};
  for (const p of paths) {
    built[p] = build(p, roundId, blockhash, tip);
    rec[p] = { sig: built[p].sig, status: "pending", costLamports: BASE_FEE + (p === "beam" ? TIP : 0) };
  }

  // Fire all paths at the same moment.
  await Promise.all(paths.map(async (p) => {
    const raw = built[p].tx.serialize();
    sentAt[p] = performance.now();
    try {
      if (p === "beam") await sendViaBeam(raw);
      else await (p === "solami" ? solami : pub).sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
    } catch (e) { rec[p].status = "send_error"; rec[p].error = String(e.message || e).slice(0, 120); }
  }));

  // One neutral observer (Solami RPC) polls all signatures, so every path is timed the same way.
  const pending = new Set(paths.filter((p) => rec[p].status === "pending"));
  const deadline = performance.now() + 60000;
  while (pending.size && performance.now() < deadline) {
    const list = [...pending];
    const { value } = await solami.getSignatureStatuses(list.map((p) => rec[p].sig));
    const now = performance.now();
    list.forEach((p, i) => {
      const s = value[i];
      if (s?.err) { rec[p].status = "failed"; pending.delete(p); }
      else if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) {
        Object.assign(rec[p], { status: "landed", slot: s.slot, landMs: Math.round(now - sentAt[p]) });
        pending.delete(p);
      }
    });
    await sleep(250);
  }
  for (const p of pending) rec[p].status = "dropped";

  const slots = Object.values(rec).filter((v) => v.status === "landed").map((v) => v.slot);
  const minSlot = Math.min(...slots);
  for (const v of Object.values(rec)) if (v.status === "landed") v.slotLag = v.slot - minSlot;

  if (rec.beam?.status === "landed") {
    try {
      const j = await (await fetch(`https://api.solami.dev/swqos/tx/${rec.beam.sig}`)).json();
      rec.beam.region = j.region; rec.beam.viaJito = j.landed_via_jito;
    } catch {}
  }
  return { roundId, paths: rec };
}
