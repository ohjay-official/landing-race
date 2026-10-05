// Beam (swQoS) sender. Based on Solami's official js-beam-land-transaction-raw snippet.
// QUIC to beam.solami.dev:11000, ALPN "solana-tpu", client cert = self-signed Ed25519 cert
// derived from the first 32 bytes of the swQoS key. That cert is the auth (no bearer token).
import crypto from "node:crypto";
import bs58 from "bs58";

const ENDPOINT = process.env.BEAM_ENDPOINT ?? "beam.solami.dev:11000";
const ALPN = "solana-tpu";
const KEEP_ALIVE_MS = 25 * 1000;
const MAX_IDLE_MS = 5 * 60 * 1000;
const FLUSH_DELAY_MS = 50;
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

let quic = null;

export const beamReady = () => Boolean(process.env.SWQOS_TOKEN);

async function selfSignedCert(seed) {
  const x509 = await import("@peculiar/x509");
  x509.cryptoProvider.set(crypto.webcrypto);
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(seed)]), format: "der", type: "pkcs8",
  });
  const publicKey = crypto.createPublicKey(privateKey);
  const alg = { name: "Ed25519" };
  const keys = {
    privateKey: await crypto.webcrypto.subtle.importKey("pkcs8", privateKey.export({ type: "pkcs8", format: "der" }), alg, true, ["sign"]),
    publicKey: await crypto.webcrypto.subtle.importKey("spki", publicKey.export({ type: "spki", format: "der" }), alg, true, ["verify"]),
  };
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: "01", name: "CN=solana-node",
    notBefore: new Date(), notAfter: new Date(Date.now() + 365 * 86400000),
    keys, signingAlgorithm: alg,
  });
  return { keyPem: privateKey.export({ type: "pkcs8", format: "pem" }), certPem: cert.toString("pem") };
}

async function connectBeam() {
  const { QUICClient } = await import("@matrixai/quic");
  const { keyPem, certPem } = await selfSignedCert(bs58.decode(process.env.SWQOS_TOKEN).slice(0, 32));
  const sep = ENDPOINT.lastIndexOf(":");
  return QUICClient.createQUICClient({
    host: ENDPOINT.slice(0, sep),
    port: parseInt(ENDPOINT.slice(sep + 1), 10),
    crypto: { ops: { async randomBytes(data) { new Uint8Array(data).set(crypto.randomBytes(data.byteLength)); } } },
    config: {
      key: keyPem, cert: certPem, verifyPeer: false,
      applicationProtos: [ALPN], maxIdleTimeout: MAX_IDLE_MS, keepAliveIntervalTime: KEEP_ALIVE_MS,
    },
  });
}

async function writeTx(raw) {
  const stream = quic.connection.newStream("uni");
  const writer = stream.writable.getWriter();
  await writer.write(raw);
  await writer.close();
  await new Promise((r) => setTimeout(r, FLUSH_DELAY_MS));
}

// Sends one serialized, signed tx. Reconnects once if the connection went stale.
export async function sendViaBeam(raw) {
  if (!quic) quic = await connectBeam();
  try { await writeTx(raw); }
  catch {
    try { await quic.destroy(); } catch {}
    quic = await connectBeam();
    await writeTx(raw);
  }
}
