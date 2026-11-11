#!/usr/bin/env node
/*
 * KeyPuzzle — winner/verifier helper. Runs fully offline.
 *   node reveal/verify.js <fullSeedBase58> <walletAddress> [salt] [commitmentHex]
 * Checks the seed derives the wallet, prints the 64-byte Phantom-importable key to a file (not stdout),
 * and optionally checks the salted commitment.
 */
const fs = require('fs');
const { Keypair } = require('@solana/web3.js');
const { bs58, commitment } = require('../lib/common');
const [seedB58, addr, salt, commit] = process.argv.slice(2);
if (!seedB58 || !addr) { console.error('usage: verify.js <seedBase58> <address> [salt] [commitment]'); process.exit(1); }
const seed = bs58.decode(seedB58);
if (seed.length !== 32) { console.error('seed must decode to 32 bytes'); process.exit(1); }
const kp = Keypair.fromSeed(seed);
const ok = kp.publicKey.toBase58() === addr;
console.log(ok ? 'MATCH: seed controls ' + addr : 'NO MATCH (derives ' + kp.publicKey.toBase58() + ')');
if (salt && commit) console.log('commitment ' + (commitment(salt, seedB58) === commit ? 'VALID' : 'INVALID'));
if (ok) {
  fs.writeFileSync('winner-key.txt', bs58.encode(kp.secretKey) + '\n', { mode: 0o600 });
  console.log('Phantom-importable private key written to ./winner-key.txt (chmod 600).');
}
process.exit(ok ? 0 : 2);
