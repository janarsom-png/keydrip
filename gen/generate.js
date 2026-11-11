#!/usr/bin/env node
/*
 * KeyPuzzle — generate the puzzle wallet (v2: per-position commitments).
 *
 * Usage:  node gen/generate.js [--hidden 14] [--force]
 *
 * - Fresh 32-byte seed, regenerated until its base58 is EXACTLY 44 chars.
 * - Secret material goes ONLY to ../secrets/ (dir 700, files 600). Nothing secret is printed.
 * - Picks `--hidden` positions to hide. Position 0 is always hidden and revealed last (its value range is
 *   restricted to '2'..'J', so revealing it early would leak less than a normal glyph and skew the schedule).
 * - For EVERY hidden position i: random salt_i and commitment_i = sha256("<pos>|<char>|<salt_i>").
 *   Commitments are public from day 1; each reveal publishes char + salt_i so anyone can verify it instantly.
 *   The wallet address itself commits to the whole seed (only one seed derives it), so no whole-key hash is needed.
 *
 * The puzzle string is the base58 of the 32-byte SEED, not the 64-byte Phantom key (see README).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Keypair } = require('@solana/web3.js');
const { bs58, glyphCommitment, shuffle, difficulty } = require('../lib/common');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const HIDDEN = parseInt(opt('--hidden', '14'), 10);
const FORCE = args.includes('--force');

const SECRETS_DIR = path.resolve(__dirname, '..', 'secrets');
const SECRET_FILE = path.join(SECRETS_DIR, 'secret.json');
const KEYPAIR_FILE = path.join(SECRETS_DIR, 'keypair.json');
const PUBLIC_FILE = path.resolve(__dirname, '..', 'public-commitment.json');

if (fs.existsSync(SECRET_FILE) && !FORCE) {
  console.error(`Refusing to overwrite existing ${SECRET_FILE}. Use --force (old key is then LOST).`);
  process.exit(1);
}

let seed, seedB58, tries = 0;
do { seed = crypto.randomBytes(32); seedB58 = bs58.encode(seed); tries++; } while (seedB58.length !== 44);
if (seedB58.length !== 44 || bs58.decode(seedB58).length !== 32) throw new Error('seed encoding invariant broken');
const kp = Keypair.fromSeed(seed);
const address = kp.publicKey.toBase58();

if (HIDDEN < 2 || HIDDEN > 44) throw new Error('bad --hidden');
const others = shuffle([...Array(44).keys()].filter(i => i !== 0)).slice(0, HIDDEN - 1);
const revealOrder = [...shuffle(others), 0]; // position 0 last
const glyphs = revealOrder.map((pos, k) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return { k, pos, char: seedB58[pos], salt, commitment: glyphCommitment(pos, seedB58[pos], salt) };
});

fs.mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });
fs.chmodSync(SECRETS_DIR, 0o700);
const secret = {
  WARNING: 'TOP SECRET. Anyone with this file controls the wallet. Keep OFFLINE. Never commit, upload or zip it.',
  version: 2,
  createdAt: new Date().toISOString(),
  address,
  seedBase58: seedB58,                       // the puzzle string (44 chars)
  secretKeyBase58: bs58.encode(kp.secretKey), // 64-byte key, only needed by whoever sweeps
  glyphs,                                    // hidden glyphs in reveal order: {k, pos, char, salt, commitment}
};
fs.writeFileSync(SECRET_FILE, JSON.stringify(secret, null, 2), { mode: 0o600 });
fs.writeFileSync(KEYPAIR_FILE, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });

const d = difficulty(glyphs.map(g => g.pos));
const pub = {
  version: 2,
  address,
  puzzleLength: 44,
  hiddenAtStart: HIDDEN,
  masked: [...seedB58].map((c, i) => (glyphs.some(g => g.pos === i) ? '?' : c)).join(''),
  commitmentScheme: 'sha256("<pos>|<char>|<salt>") per hidden position; char+salt published at each reveal',
  commitments: glyphs.map(g => ({ k: g.k, pos: g.pos, commitment: g.commitment })),
  difficultyBits: +d.bits.toFixed(2),
  createdAt: secret.createdAt,
};
fs.writeFileSync(PUBLIC_FILE, JSON.stringify(pub, null, 2));

console.log('KeyPuzzle wallet generated (v2).');
console.log('  Public address : ' + address);
console.log(`  Seed           : 44 base58 chars (took ${tries} draw${tries > 1 ? 's' : ''}), ${HIDDEN} hidden incl. position 0`);
console.log(`  Difficulty     : ~${d.bits.toFixed(1)} bits (position 0 has only ~16.2 possible values)`);
console.log('  Commitments    : ' + PUBLIC_FILE + '  (publish before launch)');
console.log('  Secret files   : ' + SECRETS_DIR + '/  (chmod 600, keep OFFLINE)');
console.log('\nNext: node launch/timelock.js --launch <ISO time>   (time-lock every hidden glyph with drand)');
console.log('!! A key generated on a shared/online machine is a TEST key. Generate the real one on a clean offline machine.');
