# Cracking The Vault Thief

The puzzle is the base58 of the vault wallet's 32-byte ed25519 seed (exactly 44 chars). Hidden glyphs show as `?`.
To win: fill the `?`s, derive the ed25519 public key, and find the one combination whose public key equals the wallet address. Then import that key and move the funds before anyone else. **It's a race — first confirmed transaction wins.**

## CPU tool (included, no install)

```bash
node crack/crack.js --reveals https://<site>/reveals.json   # pulls the live masked key + address
node crack/crack.js --bench                                 # measure your machine's speed
node crack/crack.js --masked "?wEC...?t8H" --address <WALLET> --threads 8
```

It fans out across your cores and, when it finds the key, writes it to `crack/FOUND.txt` (chmod 600) instead of printing it. On a typical 8-core laptop that's ~100k–150k keys/s.

## GPU is much faster (be honest with yourself)

A single high-end GPU does **tens to hundreds of millions** of ed25519 keypairs per second — thousands of times a CPU. People who rent GPUs have a real edge. Open-source grinders you can adapt:

- [cavemanloverboy/vanity](https://github.com/cavemanloverboy/vanity) — CUDA/OpenCL/Metal, `grind-keypair` matches a full public key; ~240M keys/s on an RTX 4090.
- [WincerChan/SolVanityCL](https://github.com/WincerChan/SolVanityCL) — OpenCL, Docker + vast.ai/runpod templates.
- [ChorusOne/solanity](https://github.com/ChorusOne/solanity) — the original CUDA finder.

These grind for a *prefix/suffix*. For this puzzle you instead enumerate the `?` positions and compare the whole 32-byte public key. The math is the same ed25519 scalar-mult per candidate, so the throughput numbers carry over; you (or a dev you hire) adapt the kernel's match step.

## Difficulty: base58 ≈ 5.86 bits per hidden glyph

Each hidden glyph is 1 of 58, except **position 0**: the seed is exactly 44 chars, so its value is in `[58^43, 2^256)` and the first glyph can only be `2`..`J` — about **16.2 effective values (~4.0 bits)**, not 58. The site counts this.

### Cost-to-crack vs. pot size

Assumes ~100M keys/s per rented GPU (RTX 4090 class) and ~$0.40/GPU-hour. Times are the full space; expected is ~half.

| hidden glyphs | bits | search space | 1 GPU | 10 GPUs | 100 GPUs | rough $ to crack |
|---|---|---|---|---|---|---|
| 6 | 35 | 3.8e10 | 3 min | 19 s | 2 s | <$1 |
| 7 | 41 | 2.2e12 | 3 h | 18 min | 2 min | ~$1 |
| **8** | 47 | 1.3e14 | 7 days | 18 h | **1.8 h** | **~$70** |
| **9** | 53 | 7.4e15 | 1.2 yr | 43 days | **4.3 days** | **~$4,000** |
| 10 | 59 | 4.3e17 | 68 yr | 7 yr | 249 days | ~$240,000 |
| 11 | 64 | 2.5e19 | 4,000 yr | 400 yr | 40 yr | ~$14M |

Read it against the pot: a rational cracker spends up to roughly the pot's value. **At 8 hidden glyphs (~$70) a pot worth more than ~$100 is already crackable within hours.** At 9 (~$4k) it falls once the pot clears a few thousand dollars. 10+ is effectively safe for now. That is why the default schedule drips the endgame one glyph per ~7 days from 9 → 8 → 7 → 6: it keeps the pot climbing while the cost-to-crack falls past it, so the race has a window instead of ending instantly.
