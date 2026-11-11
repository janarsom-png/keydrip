# The Vault Thief (KeyPuzzle) — a pump.fun meme token with a leaking dev key

The token is launched on pump.fun from your own creator wallet. pump.fun's **creator fee sharing** then routes **100% of creator fees, permanently, to a puzzle wallet**.
The puzzle wallet's secret is revealed one character at a time. Whoever reconstructs it first controls the wallet: everything in it, and every future fee that arrives there.

```
gen/generate.js          make the puzzle wallet (secret goes to secrets/, never stdout)
reveal/reveal.js         build site/reveals.json (secret, or --public from time-locks)
reveal/schedule.example.json   default schedule (copy to reveal/schedule.json and edit)
reveal/verify.js         offline checker: does a seed match the wallet?
lib/common.js            shared: fee-split/vault addrs, per-glyph commitment, difficulty (incl. pos-0)
lib/schedule.js          schedule parsing (deadlines, reveal counts)
launch/timelock.js       drand-lock every glyph to its deadline (guaranteed ending)
launch/shareholders.example.json  optional multi-recipient fee split (buyback/burn)
reveal/milestone-watch.js sustained-mcap milestone watcher (2+ sources)
reveal/tlock-open.js / verify-reveals.js  public verification helpers
crack/crack.js           public CPU cracker (+ crack/README.md GPU guide)
launch/fee-split.js      set the fee split (dry-run by default), verify the lock, distribute fees
site/                    static site (index.html, style.css, app.js, config.js, reveals.json, assets/)
                         gold vault/heist design (Cinzel / IBM Plex Mono / Inter), source: ../keypuzzle-design/
secrets/                 SECRET. In .gitignore. Never upload, zip or commit it.
```

## Setup

```bash
npm install                                            # web3.js, bs58, @pump-fun/pump-sdk, spl-token, tlock-js
node gen/generate.js --hidden 14                       # 44-char seed; writes secrets/ + public-commitment.json
cp reveal/schedule.example.json reveal/schedule.json   # edit milestones, deadlines, reveal counts
node launch/timelock.js --launch <ISO time>            # time-lock every glyph -> site/timelocks.json (publish it)
node reveal/reveal.js [--mint <MINT>]                  # writes site/reveals.json from deadlines + milestone state
cd site && python3 -m http.server 8080                 # open http://localhost:8080
```

Edit `site/config.js`: token name, ticker, contract address (CA), `feeSplitProofTx`, links, RPC endpoints.
Deploy `site/` as-is to Vercel, Netlify, GitHub Pages or Cloudflare Pages — no build step. The site re-reads `reveals.json` every 30 s.

**Publish at launch:** `public-commitment.json` (per-glyph commitments) and `site/timelocks.json` (drand ciphertexts). Both are public, no secrets.
**To advance reveals:** run `node reveal/milestone-watch.js --mint <MINT> --reveal` (loops; writes milestone triggers and rebuilds `reveals.json`), or just let the time-lock deadlines pass and re-run `node reveal/reveal.js`. Deploy the updated `reveals.json`. Anyone can reconstruct it from the time-locks with `node reveal/reveal.js --public` once deadlines pass.

Key scripts: `reveal/tlock-open.js` (open due glyphs with no secret), `reveal/verify-reveals.js` (check a published reveals.json), `crack/crack.js` (the public cracker).

## Why the seed, not the Phantom key (important)

A Solana "private key" as Phantom exports it is 64 bytes, made of `seed (32) || publicKey (32)`. **The second half is public.**
If you hid characters of that 88-char base58 string, they could be recovered **instantly** with modular arithmetic (the full number mod 2^256 equals the public key, and 58 = 2·29, so the hidden digits drop out of one linear congruence; tested — 12 hidden chars recovered in milliseconds).

So the puzzle string is the **base58 of the 32-byte seed**, regenerated until it is **exactly 44 chars** (`gen/generate.js` loops until `seedBase58.length === 44` and asserts it decodes to 32 bytes). The only way to test a guess is a full ed25519 derivation compared against the wallet address. The winner runs `node reveal/verify.js <seed> <address>` (offline) to get the Phantom-importable key.

## Fairness: per-glyph commitments + drand time-lock (v2)

Two independent guarantees, both verifiable by anyone, no trust in us required for either:

**1. Per-position commitments.** At launch we publish, for *every* hidden glyph, `commitment_i = sha256("<position>|<char>|<salt_i>")` (`public-commitment.json`). Each reveal publishes that glyph's `char` + `salt_i`, so it can be checked the instant it appears — `node reveal/verify-reveals.js`, or the site does it live in your browser (`site/verify.js`). We dropped the old whole-key hash: the **wallet address already commits to the whole seed** (only one seed derives it), and per-glyph commitments make every single reveal verifiable immediately instead of only at the end. The salt stops a commitment from being a brute-force shortcut.

**2. Time-lock (guaranteed ending).** Every hidden glyph is also encrypted with [drand](https://drand.love) time-lock (`tlock`, quicknet / League of Entropy) to its step's **deadline**, and all ciphertexts are published at launch (`site/timelocks.json`, no secrets). Nobody — including us — can decrypt one early. After a deadline, **anyone** can decrypt it (`node reveal/tlock-open.js` or https://timevault.drand.love) and verify it against its commitment. So even if the creator and the milestone bot both vanish, the vault still opens on schedule and the game is guaranteed to end. Trust assumption: drand's threshold network (no single party can decrypt early).

**Milestones only accelerate.** A milestone reveal happens *earlier* than the deadline; it can never delay one. Milestone-early reveals are published by us (we hold the char+salt until the trigger), so for those you trust us not to sit on a triggered milestone — the time-lock is the backstop. This is stated plainly on the site.

## Milestones: sustained market cap, two sources

`reveal/milestone-watch.js` triggers a milestone only when the market cap holds **continuously** at or above the threshold for `windowMinutes` (default 60) on at least `minSources` (default 2) **independent** price feeds — DexScreener, GeckoTerminal, Birdeye (needs `BIRDEYE_API_KEY`), pump.fun. Every sample in the window must be above the line and cover it with no gap longer than `maxGapMinutes`, so a single wash-traded bundle or a one-block spike can't trigger it. Triggers (with which sources agreed) are written to `reveal/milestones-state.json`, which `reveal.js` reads. Run it as `node reveal/milestone-watch.js --mint <MINT> --reveal` (loop) and deploy the updated `reveals.json`.

## Difficulty, schedule, and cost-to-crack

Base58 is ~5.86 bits per hidden glyph, **except position 0**: the seed is exactly 44 chars, so the first glyph is restricted to `2`..`J` (~16.2 effective values, ~4.0 bits, not 5.86). `lib/common.js difficulty()` accounts for this, and `gen/generate.js` always hides position 0 and reveals it **last**.

The full cost-to-crack table (GPU times and rough $ vs. pot size) is in **`crack/README.md`**. Summary at ~100M keys/s per rented GPU, ~$0.40/GPU-hour:

| hidden | ~$ to crack | note |
|---|---|---|
| 8 | ~$70 | few hours on rented GPUs |
| 9 | ~$4,000 | a few days on 100 GPUs |
| 10 | ~$240k | effectively safe for now |
| 6 or fewer | <$1 | seconds |

**Default schedule (`reveal/schedule.example.json`):** start **14 hidden**; five market-cap milestones bring it 14 → 9; then a slow endgame drip 9 → 8 → 7 → 6 (one glyph every ~7 days); a final step reveals the rest. So the cracking phase (8–9 hidden) lasts weeks while the pot keeps climbing, and because every step is time-locked the vault always opens. The schedule is fully configurable: `startHidden`, per-step `milestone.mcapUsd`, `deadline` (`+1d`, `+36h`, or absolute ISO), and `reveal` (glyphs per step; the `reveal` values must sum to `startHidden`). After editing, re-run `launch/timelock.js` to re-lock to the new deadlines.

## Public cracking tool

`node crack/crack.js --reveals <url>` is a multi-core CPU cracker anyone can run (no install); it writes a found key to `crack/FOUND.txt`, never to stdout. It is honest that **GPU renters have a large edge** and links real GPU grinders. See `crack/README.md`.


## Launch flow on pump.fun (fee-sharing model)

The coin is created from **your own creator wallet**. The puzzle wallet never touches pump.fun and is never imported into Phantom.
Right after launch, pump.fun's **creator fee sharing** routes 100% of creator fees to the puzzle wallet. Writing that split permanently revokes the split admin.

1. **Generate the real puzzle key on a clean, offline machine**: `node gen/generate.js --hidden 14`.
   The key in this repo is a throwaway TEST key. Keep `secrets/` offline. You only need the puzzle **address** online.
2. **Time-lock the glyphs:** pick a launch time and run `node launch/timelock.js --launch <ISO>`. Then **publish before launch** (site + X): `public-commitment.json` (per-glyph commitments) and `site/timelocks.json` (drand ciphertexts, no secrets), plus the puzzle wallet address.
3. **Create the coin on pump.fun from your creator wallet** (name, ticker, image, link to the site). Pair it with SOL.
   - Leave creator fees going to the **creator**. Do **not** choose *Holders* (holder rewards).
     A holder-reward coin's creator cannot be changed, so fee sharing becomes impossible.
     We confirmed this in simulation: `create_fee_sharing_config` fails with error 6083 `HolderRewardCreatorImmutable`.
   - Don't pick charity or cashback either.
4. **Route 100% of creator fees to the puzzle wallet. This is permanent, so do it immediately after creation.** Two ways:
   - **pump.fun UI:** on the coin page open creator fees / *fee sharing*, add the puzzle wallet as the only recipient at **100%**, and confirm with your creator wallet.
     pump.fun announced that creators can set splits in the app and web UI (see sources).
     **Double-check the address character by character first.**
   - **Script (dry-run by default):**
     ```bash
     node launch/fee-split.js plan --mint <MINT> --creator <YOUR_CREATOR_WALLET>          # builds + simulates, sends nothing
     node launch/fee-split.js plan --mint <MINT> --creator <YOUR_CREATOR_WALLET> \
          --send --keypair <your-creator-keypair.json>                                      # asks you to type "LOCK xxxxxx", then sends
     ```
     The script builds ONE transaction: `sweep_creator_fee` → (`sweep_pool_creator_fee` if graduated) → `create_fee_sharing_config` → `update_fee_shares_v2(shareholders)`.
     It simulates it and prints the **simulated post-state** of the `sharing_config`. Expected: `adminRevoked=true`, `editable=false`, puzzle wallet in the shareholders.
     It refuses to send if the simulation fails, if the keypair isn't the coin's creator, or if a split already exists.
   For a buyback/burn or holder share, pass `--shareholders launch/shareholders.example.json` (default is 100% puzzle).
5. **Verify** (anyone can do this, see below): `node launch/fee-split.js status --mint <MINT>` must end in `RESULT: LOCKED. Puzzle wallet gets 100% ...`.
6. **Configure and deploy the site.**
   - In `site/config.js`, set `contractAddress` and `feeSplitProofTx` (the Solscan link of the step-4 transaction).
   - Run `node reveal/reveal.js --mint <MINT>`, then deploy `site/` (including `timelocks.json`).
   - The site's *Fee split* box reads the `sharing_config` live and shows **LOCKED** only if every check passes.
7. **Advance reveals:** run the watcher `node reveal/milestone-watch.js --mint <MINT> --reveal` (keeps running; triggers on sustained mcap and rebuilds `reveals.json`). Glyphs also auto-unlock at their deadlines — re-run `node reveal/reveal.js --mint <MINT>` (or `--public`) and redeploy `site/reveals.json`.
8. *(Optional, any time)* Push accrued fees into the puzzle wallet so the pot is visible as real wallet SOL. This is permissionless and any wallet can pay the network fee:
   `node launch/fee-split.js distribute --mint <MINT> --payer <ANY_WALLET>` (dry-run; add `--send --keypair` to send).

### Verify the lock yourself on Solscan (for players)

1. Compute or copy the `sharing_config` address. It is the pump-fees PDA `["sharing-config", mint]` under program `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ`.
   The site links it ("sharing_config account"), and `reveals.json → feeSplit.sharingConfig` contains it.
2. Open `https://solscan.io/account/<sharing_config>`. The owner must be the pump-fees program above. In the decoded data (Anchor IDL tab), check:
   - `shareholders` = exactly one entry, `address` = the puzzle wallet, `share_bps` = `10000`
   - `admin_revoked` = `true` (the split can never be updated: program errors 6009 `SharingConfigAdminRevoked` / 6024 "Reward split can only be updated once")
   - `mint` = the token's CA
3. Open the coin's bonding curve account (`["bonding-curve", mint]` under the Pump program). Its `creator` must equal the `sharing_config` address, not a wallet.
4. Open the fee-split transaction (`feeSplitProofTx`). It should show `create_fee_sharing_config` and `update_fee_shares_v2` with the puzzle wallet at 10000 bps.
5. Or run it locally: `node launch/fee-split.js status --mint <MINT> --puzzle <PUZZLE_ADDRESS>` (read-only).

### How pump.fun creator fees work with fee sharing (verified Nov 2026)

- **Fee rate:** 0.30% creator fee per trade on the bonding curve. On PumpSwap it is tiered by market cap (0.95% at 420–1470 SOL market cap, then stepping down to 0.05%). Source: [pump.fun/docs/fees](https://pump.fun/docs/fees).
- **Lifecycle** (official [CREATOR_FEE_SHARING.md](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/CREATOR_FEE_SHARING.md)):
  - `create_fee_sharing_config` points the coin's creator at a `sharing_config` PDA. The initial shareholder is the creator at 100%.
  - `update_fee_shares_v2` sets the final shareholder list. It "replaces the current shareholders and **sets `admin_revoked = true`**, so this instruction can only effectively be used once".
  - **The revoke is automatic, in the same instruction, with no separate step.** We confirmed this by simulating the exact transaction against a real graduated mainnet coin. The simulated post-state was `adminRevoked=true`, editable `false`.
  - The older standalone `revoke_fee_sharing_authority` / `transfer_fee_sharing_authority` instructions are empty stubs in the current [pump_fees IDL](https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump_fees.json).
- **Who receives the fees:** the puzzle wallet does **not** need to claim. Fees accrue in two vaults keyed by the `sharing_config`:
  - bonding curve: `["creator-vault", sharing_config]` under the Pump program
  - PumpSwap: the wSOL ATA of `["creator_vault", sharing_config]` under the PumpSwap program
  - `transfer_creator_fees_to_pump_v2` and `distribute_creator_fees_v2` are **permissionless**. Anyone can call them, and for SOL coins lamports are sent **directly to each shareholder address**.
  - So pending fees always end up in the puzzle wallet. The site's prize pool = puzzle wallet balance + pending SOL in both vaults (minus the bonding-curve vault's rent reserve).
  - Small amounts in v3 "curve buckets" (swept on the next distribute) aren't counted, so the shown pot can lag slightly.
- **Pre-launch flow:** OTC Desks ([otcdesks.cash/docs](https://otcdesks.cash/docs)) and Payday ([payday.foundation/docs/for-creators](https://www.payday.foundation/docs/for-creators)) both run this exact pattern.
  - They create the coin in one transaction, then run `createFeeSharingConfig` + `updateFeeSharesV2` with 10000 bps to one wallet in a second transaction.
  - Both state that the split locks when it is written. That matches the official docs.
- **UI:** pump.fun announced that creators (and CTO admins) can assign fee-sharing percentages in the pump.fun app/web after launch ([cryptonews](https://cryptonews.com/news/pump-fun-creator-fee-update-token-ownership/)). Menu names change, and the script is the fallback.
- **The winner can no longer redirect future fees.** The puzzle wallet is a shareholder, not the admin, and the admin is revoked. Future fees keep flowing to the configured shareholders; see "After someone wins" above.
- **Up to 10 recipients** are allowed, so an optional buyback/burn or holder share is possible (`launch/shareholders.example.json`); default is 100% puzzle wallet.

## After someone wins: the fee stream problem (point 5)

Once the key is out, the vault wallet is compromised but the locked fee split keeps sending creator fees to it forever. We researched the options against the official pump-fees IDL:

- **Multiple recipients are supported.** A `sharing_config` holds **1–10 shareholders**, each a plain wallet pubkey, shares in basis points summing to 10000. `distribute_creator_fees_v2` sends SOL **directly to each shareholder address** and is permissionless.
- **A PDA/program recipient is possible but pointless here.** A shareholder is just a pubkey, so it could be a PDA — but nothing would be able to spend from it without a custom program, and the split is locked, so it can't rescue the post-win stream. The address still has to receive like any wallet.
- **The split can't be re-pointed after a win.** `admin_revoked` is set when the split is written. The only override is pump.fun's own `admin_cto` (see caveats). So "rotate the recipient after someone wins" is **not** available to us.

**What we picked (and why):** keep it honest and simple. **Default: 100% to the puzzle wallet, and the site/README state plainly that after a win it becomes a sweeper race** — whoever moves each new fee first keeps it; "you win what's in the vault now, plus whatever you can grab later." That's the only option that needs no trusted off-chain actor and no misleading promise.

**Optional, configurable:** `launch/fee-split.js --shareholders launch/shareholders.example.json` lets you split, e.g. 80% puzzle wallet + 20% a **buyback/burn wallet you control**, so the project keeps a revenue stream after a win while the puzzle reward stays the majority. This is off by default (set it only if you want it). A "season 2" rotation (new coin, new puzzle) is a product decision, not something the locked split can do.

## Security caveats (read these)

- **The creator always knows the key.** The commitment proves the puzzle wasn't swapped, and the fee lock proves where fees go, but nothing prevents the creator from sweeping the puzzle wallet. Players have to trust you, and they can watch it on-chain.
- **pump.fun platform override (CTO):** the official SDK documents `admin_cto`, a community-takeover instruction signed by pump.fun's `Global.adminSetCreatorAuthority`.
  On a fee-shared coin it "rewrites the config to newCreator at 100%" (or switches it to holder rewards). So the lock is final against you and against the winner, **but not against pump.fun itself**, for example if a community requests a CTO.
  pump.fun's programs are also upgradeable by pump.fun. Say this honestly in the rules (the site does).
- Every device the puzzle key touches is a leak risk. With the fee-sharing model it **never** needs to be in Phantom or online until the game ends.
- **Race:** once the key is known, anyone who knows it can take the funds, including bots watching the reveals. First confirmed transaction wins.
- Don't put anything else in the puzzle wallet. Don't reuse it.
- **Legal:** a paid-entry, prize-for-luck/skill game may be treated as a lottery, gambling or an unregistered offering in some jurisdictions (including the EU/Estonia). Get advice. The site carries disclaimers, but they don't make it legal.
- Public RPCs rate-limit. `api.mainnet-beta.solana.com` returned 403 from our test box, and `solana-rpc.publicnode.com` worked with CORS. Use your own RPC key for production.

## Site design

The site uses the gold vault/heist design from `keypuzzle-design/design.md`:
- brass-framed lock cells for the seed (revealed glyphs in `#F5D76E`, sealed ones shown as `•`)
- an engraved gold prize number with SOL next to it
- a round dial countdown labelled "until next glyph". The ring shrinks toward the next timed reveal; for milestone steps it shows overall progress.
- a live *Fee split* box that reads the `sharing_config` from chain (LOCKED / not set / mismatch). Decoder in `site/sharing.js`, cross-checked against the official SDK decoder.
- `assets/logo-vault-keyhole-512.png` is used as the favicon and nav logo. `assets/banner-header.png` is used as the OG/X card image and a faded hero backdrop.

The bundled `site/reveals.json` is from a throwaway TEST wallet (3 reveals done) and is there for demo only. Regenerate it with your real key.

## Operator runbook — the bot (automation)

The bot is **read-only + file-writes**. It never posts to X and never signs an on-chain transaction; X posts are
written as draft text files for you to send.

**One tick** — `node bot/run.js --mint <MINT>`:
1. `reveal/milestone-watch.js --once` samples market cap into `reveal/milestones-state.json` (sustained-window state).
2. **Winner scan** — looks for the first transaction *signed by* the puzzle wallet (the win signal) via RPC; on a hit
   it writes `bot/state/winner.json`.
3. Rebuilds `site/reveals.json`: with a secret present it does milestone-early and final-on-win reveals; without one
   it runs `--public` and opens only glyphs whose drand deadline has passed (no secret needed).
4. Diffs against the last tick and emits events (reveal / milestone / endgame / win) into `site/feed.json` and as
   ready-to-post tweets under `drafts/<timestamp>-<type>.txt`.

**Loop locally / on a VPS** — `node bot/loop.js --mint <MINT> --interval 120` runs the tick on an interval. Run it
here (with `secrets/secret.json` present) if you want milestone-early reveals without GitHub holding the secret.

**GitHub Actions** — `.github/workflows/keydrip-bot.yml` runs the tick every 10 minutes, commits
`site/reveals.json`, `site/feed.json`, `reveal/milestones-state.json`, `bot/state/`, `drafts/`, and deploys `site/`
to GitHub Pages. Secrets: `TOKEN_MINT` (required), `THIEF_SECRET_B64` = `base64 -w0 secrets/secret.json` (optional,
only for milestone-early + final reveals; omit for the fully trustless time-locked path). `reveal/milestones-state.json`
is committed so the sustained-market-cap window survives across runs.

**State files:** `bot/state/winner.json` (set once, sticky), `bot/state/last-reveals.json` (diff snapshot),
`reveal/milestones-state.json` (mcap samples + triggered milestones). `bot/state/secret.runtime.json` (only if
`THIEF_SECRET_B64` is used) is git-ignored.

**Winner state:** once won, `site/reveals.json` carries `game.status: "won"`, the winner tx + Solscan link + swept
amount, and the fully-revealed key; the site flips to the winner view and keeps showing the sweeper-race notice.

See **[LAUNCH.md](LAUNCH.md)** for the full step-by-step launch checklist.

## Heist theme — animated crew & effects

The site is themed as a safe-cracking heist: the creator-fee vault is a **safe**, each revealed glyph is a **cracked tumbler**, milestones are **locks popping**, and the winner is **the thief who cracked the vault**. This is purely cosmetic — the commitments, drand time-locks, verification and all game mechanics are unchanged.

- `site/thieves.js` — SVG/CSS thief sprites that ring the safe (drill with sparks, stethoscope, crowbar, laptop, lockpick), with idle loops and occasional failure gags. The visitor's own thief is labelled **you**. It thins to fewer characters on mobile and goes still under `prefers-reduced-motion`.
- `site/effects.js` — a small capped canvas particle engine (drill sparks, gold-coin bursts on reveals, dust + a vault shake on milestones, an alarm flash) plus the big **VAULT CRACKED** sequence for the winner state. It also diffs `reveals.json` across refreshes and emits `vault:fx` events the crew reacts to. It pauses when the tab is hidden.
- The vault door, dial and tumblers are inline SVG in `index.html`, driven by `app.js` (`updateVault` lights one tumbler per cracked glyph).

### Live thief presence (optional, OFF by default)
GitHub Pages is static, so there is **no** true "one thief per live visitor" count out of the box — the site shows an **ambient crew** instead (a few thieves, your own labelled *you*). A pluggable hook is built in and disabled by default:

```js
// site/config.js
presence: { enabled: false, endpoint: '' }
```

To show real concurrent visitors, stand up any realtime presence backend that broadcasts a live count (e.g. a free tier of a hosted realtime/websocket service, or a tiny Cloudflare Durable Object / Ably / Pusher / Supabase Realtime channel), then set `presence.enabled = true` and `presence.endpoint` to a WebSocket URL that emits either a bare number or `{ "count": N }`. The crew size follows that number (capped). Nothing is signed up for or contacted while it's off.
