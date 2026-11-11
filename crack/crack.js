#!/usr/bin/env node
/*
 * KeyPuzzle — public CPU cracker. Anyone can run it (Node 18+, no install).
 *
 *   node crack/crack.js --reveals <url-or-file>     # e.g. https://<site>/reveals.json
 *   node crack/crack.js --masked "?wEC...?t8H" --address <WALLET>
 *   node crack/crack.js --bench
 *   options: --threads N (default: all cores), --limit N (stop after N tries, for testing)
 *
 * For each candidate it fills the '?' positions, base58-decodes to 32 bytes, derives the ed25519 public key
 * and compares it to the wallet address. Position 0 can only be '2'..'J' (17 values): the seed is exactly 44
 * base58 chars. Found key -> written to crack/FOUND.txt (chmod 600), never printed.
 *
 * Honest note: this CPU tool is for taking part and for small remaining spaces. People renting GPUs are MUCH
 * faster (tens to hundreds of millions of keys/s per card vs ~1e4-1e5/s per CPU core). See crack/README.md.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAP = Object.fromEntries([...ALPHABET].map((c, i) => [c, i]));
const PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex'); // ed25519 private-key DER prefix

function decode44(str) { // base58 (44 chars) -> 32-byte Buffer, or null if >32 bytes
  let n = 0n; for (const c of str) { const v = MAP[c]; if (v === undefined) return null; n = n * 58n + BigInt(v); }
  const b = Buffer.alloc(32); for (let i = 31; i >= 0; i--) { b[i] = Number(n & 255n); n >>= 8n; } if (n) return null; return b;
}
function pubFromSeed(seed32) {
  const kp = crypto.createPrivateKey({ key: Buffer.concat([PKCS8, seed32]), format: 'der', type: 'pkcs8' });
  return crypto.createPublicKey(kp).export({ format: 'der', type: 'spki' }).subarray(12); // last 32 bytes
}
function b58encode(buf) { let n = 0n; for (const x of buf) n = n * 256n + BigInt(x); let s = ''; while (n > 0n) { s = ALPHABET[Number(n % 58n)] + s; n /= 58n; } for (const x of buf) { if (x === 0) s = '1' + s; else break; } return s; }

function candValues(pos) { return pos === 0 ? '23456789ABCDEFGHJ' : ALPHABET; } // pos0: digits 1..17 => '2'..'J'

if (!isMainThread) {
  const { masked, addressB58, positions, shard, threads, limit } = workerData;
  const target = b58_to_bytes(addressB58);
  const chars = [...masked];
  const radix = positions.map(candValues);
  const total = radix.reduce((a, r) => a * BigInt(r.length), 1n);
  let tried = 0n, report = 0n;
  for (let idx = BigInt(shard); idx < total; idx += BigInt(threads)) {
    let x = idx;
    for (let d = positions.length - 1; d >= 0; d--) { const r = radix[d]; chars[positions[d]] = r[Number(x % BigInt(r.length))]; x /= BigInt(r.length); }
    const seed = decode44(chars.join(''));
    if (seed) { const pub = pubFromSeed(seed); if (pub.equals(target)) { parentPort.postMessage({ found: chars.join('') }); return; } }
    if (++tried - report >= 20000n) { parentPort.postMessage({ progress: tried - report }); report = tried; }
    if (limit && tried >= BigInt(limit)) break;
  }
  parentPort.postMessage({ progress: tried - report, done: true });
  function b58_to_bytes(s) { let n = 0n; for (const c of s) n = n * 58n + BigInt(MAP[c]); const b = []; while (n > 0n) { b.unshift(Number(n & 255n)); n >>= 8n; } for (const c of s) { if (c === '1') b.unshift(0); else break; } return Buffer.from(b); }
  return;
}

// ---- main
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const THREADS = parseInt(opt('--threads', String(os.cpus().length)), 10);

async function getReveals(src) {
  if (/^https?:/.test(src)) return await (await fetch(src)).json();
  return JSON.parse(fs.readFileSync(src, 'utf8'));
}
function bench() {
  const seed = crypto.randomBytes(32); const N = 20000; const t = Date.now();
  for (let i = 0; i < N; i++) { seed[0] = i & 255; seed[1] = (i >> 8) & 255; pubFromSeed(seed); }
  const rate = Math.round(N / ((Date.now() - t) / 1000));
  console.log(`Single-core: ~${rate.toLocaleString()} keys/s. With ${THREADS} cores: ~${(rate * THREADS).toLocaleString()} keys/s.`);
  return rate * THREADS;
}

(async () => {
  if (args.includes('--bench')) { const total = bench();
    for (const h of [6, 7, 8, 9, 10]) { const space = h === 1 ? 17 : 17 * 58 ** (h - 1); const sec = space / 2 / total;
      console.log(`  ${h} hidden (incl. pos0): ~${fmt(sec)} on this machine`); } return; }

  let masked = opt('--masked'), address = opt('--address');
  if (!masked) { const r = await getReveals(opt('--reveals', path.resolve(__dirname, '..', 'site/reveals.json'))); masked = r.puzzle.masked; address = r.wallet; }
  const positions = [...masked].map((c, i) => c === '?' ? i : -1).filter(i => i >= 0);
  if (!address || !positions.length) { console.error('need a masked key with ? and an address'); process.exit(1); }
  const space = positions.reduce((a, p) => a * BigInt(candValues(p).length), 1n);
  const perCore = bench() / THREADS;
  console.log(`\nTarget ${address}`);
  console.log(`Masked ${masked}`);
  console.log(`${positions.length} hidden position(s)${positions.includes(0) ? ' (incl. restricted pos 0)' : ''}, search space ${Number(space).toExponential(2)} (~${Math.log2(Number(space)).toFixed(1)} bits)`);
  console.log(`Estimated worst case on this machine: ${fmt(Number(space) / (perCore * THREADS))} (expected ~half).`);
  if (Number(space) > 5e11 && !args.includes('--force')) { console.log('\nThis is too large for a CPU in reasonable time. Rent GPUs (see crack/README.md) or wait for more reveals. Use --force to run anyway.'); return; }

  const limit = opt('--limit') ? parseInt(opt('--limit'), 10) : 0;
  let total = 0n; const start = Date.now(); let found = null; let doneCount = 0;
  await new Promise(resolve => {
    const workers = Array.from({ length: THREADS }, (_, shard) => {
      const w = new Worker(__filename, { workerData: { masked, addressB58: address, positions, shard, threads: THREADS, limit: limit ? Math.ceil(limit / THREADS) : 0 } });
      w.on('message', m => {
        if (m.progress) { total += BigInt(m.progress);
          if (total % 200000n < 20000n) { const rate = Number(total) / ((Date.now() - start) / 1000); process.stdout.write(`\r  tried ${Number(total).toExponential(2)}  ${Math.round(rate).toLocaleString()}/s   `); } }
        if (m.found) { found = m.found; workers.forEach(x => x.terminate()); resolve(); }
        if (m.done && ++doneCount >= THREADS) resolve();
      });
      return w;
    });
  });
  process.stdout.write('\n');
  if (found) {
    const seed = decode44(found); const full = b58encode(Buffer.concat([seed, pubFromSeed(seed)]));
    const outFile = path.join(__dirname, 'FOUND.txt');
    fs.writeFileSync(outFile, `seedBase58: ${found}\naddress: ${address}\nphantomPrivateKey(base58): ${full}\n`, { mode: 0o600 });
    console.log(`\n*** SOLVED *** key written to ${outFile} (chmod 600). Import it FAST and move the funds — it's a race.`);
  } else console.log(`No match in the searched range (${Number(total).toLocaleString()} tried).`);
})();

function fmt(sec) {
  if (!isFinite(sec)) return '∞';
  for (const [u, d] of [['years', 31557600], ['days', 86400], ['h', 3600], ['min', 60]]) if (sec >= d) return `${(sec / d).toFixed(1)} ${u}`;
  return `${sec.toFixed(1)} s`;
}
