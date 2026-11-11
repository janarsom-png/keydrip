// Shared helpers for KeyPuzzle (Node.js, CommonJS).
const crypto = require('crypto');
const { PublicKey } = require('@solana/web3.js');
const bs58 = require('bs58').default || require('bs58');

// pump.fun program IDs (mainnet). Verify against https://github.com/pump-fun/pump-public-docs before launch.
const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');      // bonding curve
const PUMP_AMM_PROGRAM = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');  // PumpSwap
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = new PublicKey('ATokenGPvbd2DfqCmQYbBFWLsGxpQr1QQM3m7eTqmrAH');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

/** Where unclaimed pump.fun creator fees sit for a given creator wallet. */
function creatorVaults(creatorStr) {
  const creator = new PublicKey(creatorStr);
  const [bondingCurveVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('creator-vault'), creator.toBuffer()], PUMP_PROGRAM);
  const [ammVaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('creator_vault'), creator.toBuffer()], PUMP_AMM_PROGRAM);
  const [ammVaultWsolAta] = PublicKey.findProgramAddressSync(
    [ammVaultAuthority.toBuffer(), TOKEN_PROGRAM.toBuffer(), WSOL_MINT.toBuffer()], ATA_PROGRAM);
  return {
    bondingCurveVault: bondingCurveVault.toBase58(),
    ammVaultAuthority: ammVaultAuthority.toBase58(),
    ammVaultWsolAta: ammVaultWsolAta.toBase58(),
  };
}

const PUMP_FEES_PROGRAM = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ'); // pump-fees (fee sharing)

/**
 * Fee-shared coin: where creator fees wait before they are distributed to shareholders (the puzzle wallet).
 * sharing_config = PDA ["sharing-config", mint] (pump-fees). Once a coin is fee-shared, bonding_curve.creator
 * (and pool.coin_creator) == sharing_config, so the vaults are keyed by sharing_config, not by any wallet.
 */
function feeSplitAccounts(mintStr) {
  const mint = new PublicKey(mintStr);
  const [sharingConfig] = PublicKey.findProgramAddressSync([Buffer.from('sharing-config'), mint.toBuffer()], PUMP_FEES_PROGRAM);
  const v = creatorVaults(sharingConfig.toBase58());
  return { mint: mint.toBase58(), sharingConfig: sharingConfig.toBase58(), ...v };
}

/** Salted commitment: SHA-256(salt + ":" + seedBase58), hex. Salt stays secret until the game ends. */
function commitment(salt, seedBase58) {
  return crypto.createHash('sha256').update(`${salt}:${seedBase58}`, 'utf8').digest('hex');
}

/** Fisher-Yates with crypto randomness. */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const BITS_PER_CHAR = Math.log2(58); // ~5.858
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * A 32-byte seed whose base58 is exactly 44 chars has value in [58^43, 2^256), so its FIRST char can only be
 * '2'..'J' (digit 1..17; '1' would mean a leading zero byte and a 43-char string, and digit 17 is only ~23% usable).
 * Effective choices for position 0: (2^256 - 58^43) / 58^43 ~= 16.23 (~4.02 bits) instead of 58 (~5.86 bits).
 */
const FIRST_CHAR_TRIES = 17;
const FIRST_CHAR_EFFECTIVE = Number((2n ** 256n - 58n ** 43n) * 10000n / 58n ** 43n) / 10000; // ~16.2296
function difficulty(hiddenPositions) {
  let tries = 1n, eff = 1;
  for (const p of hiddenPositions) { if (p === 0) { tries *= BigInt(FIRST_CHAR_TRIES); eff *= FIRST_CHAR_EFFECTIVE; } else { tries *= 58n; eff *= 58; } }
  return { tries, effective: eff, bits: Math.log2(eff), expectedTries: eff / 2 };
}

/** Per-position commitment: sha256("<pos>|<char>|<salt>") hex. Salt = 16 random bytes hex, unique per position. */
function glyphCommitment(pos, ch, salt) {
  return crypto.createHash('sha256').update(`${pos}|${ch}|${salt}`, 'utf8').digest('hex');
}

module.exports = { bs58, ALPHABET, difficulty, glyphCommitment, FIRST_CHAR_TRIES, FIRST_CHAR_EFFECTIVE, creatorVaults, feeSplitAccounts, PUMP_FEES_PROGRAM, commitment, shuffle, BITS_PER_CHAR, PUMP_PROGRAM, PUMP_AMM_PROGRAM };
