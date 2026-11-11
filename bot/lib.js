// The Vault Thief bot — shared helpers. No posting, no sending; read-only RPC + file writes only.
const fs = require('fs');
const path = require('path');
const { Connection, PublicKey } = require('@solana/web3.js');

const ROOT = path.resolve(__dirname, '..');
const p = (...a) => path.join(ROOT, ...a);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2)); };

function connect(cfg) {
  const url = (cfg.rpcEndpoints && cfg.rpcEndpoints[0]) || 'https://solana-rpc.publicnode.com';
  return new Connection(url, 'confirmed');
}

/**
 * Winner detection. The puzzle wallet's key is secret until someone cracks (or leaks) it, and the game itself
 * never signs with it. So the FIRST transaction SIGNED BY the puzzle wallet is the win. We scan signatures,
 * find the earliest tx where the wallet is a required signer, and record it + the SOL it moved out.
 * Returns { tx, slot, blockTime, outLamports } or null. Pure RPC reads.
 */
async function detectWinner(conn, walletStr, afterSig) {
  const wallet = new PublicKey(walletStr);
  let sigs = await conn.getSignaturesForAddress(wallet, { limit: 1000 });
  sigs = sigs.filter(s => !s.err).reverse(); // oldest first
  for (const s of sigs) {
    if (afterSig && s.signature === afterSig) continue;
    const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 }).catch(() => null);
    if (!tx || !tx.meta) continue;
    const msg = tx.transaction.message;
    const keys = (msg.staticAccountKeys || msg.accountKeys || []).map(k => k.toBase58 ? k.toBase58() : k);
    const numSigners = msg.header ? msg.header.numRequiredSignatures : (msg.numRequiredSignatures || 1);
    const idx = keys.indexOf(walletStr);
    const isSigner = idx >= 0 && idx < numSigners;
    if (!isSigner) continue;
    const out = (tx.meta.preBalances[idx] || 0) - (tx.meta.postBalances[idx] || 0);
    return { tx: s.signature, slot: s.slot, blockTime: s.blockTime, outLamports: Math.max(0, out) };
  }
  return null;
}

/** Best-effort live prize pool (wallet + both fee vaults), for feed context. Never throws. */
async function prizePool(conn, reveals) {
  try {
    const sol = x => x / 1e9;
    const wallet = new PublicKey(reveals.wallet);
    const v = reveals.feeSplit || {};
    const [w, bc] = await Promise.all([
      conn.getBalance(wallet),
      v.bondingCurveVault ? conn.getBalance(new PublicKey(v.bondingCurveVault)) : Promise.resolve(0),
    ]);
    let amm = 0;
    if (v.ammVaultWsolAta) { try { amm = (await conn.getTokenAccountBalance(new PublicKey(v.ammVaultWsolAta))).value.uiAmount || 0; } catch {} }
    return +(sol(w) + Math.max(0, sol(bc) - 0.00089088) + amm).toFixed(4);
  } catch { return null; }
}

module.exports = { ROOT, p, readJson, writeJson, connect, detectWinner, prizePool };
