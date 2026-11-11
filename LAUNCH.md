# The Vault Thief — launch checklist

A short, do-it-in-order checklist. Nothing here posts to X or sends a transaction on your behalf;
the fee-split and generate steps are the only ones that touch a wallet, and both are dry-run / offline by default.

## 1. Generate the puzzle key (offline)
- [ ] On a **clean, offline** machine: `npm install`, then `node gen/generate.js --hidden 14`.
- [ ] This writes `secrets/secret.json` + `secrets/keypair.json` (0600) and the public `public-commitment.json`.
      `public-commitment.json` holds the puzzle wallet **address** and the per-position salted commitments — nothing secret.
- [ ] Confirm the seed base58 is **44 chars** (the generator loops until it is).

## 2. Time-lock every hidden glyph (guaranteed ending)
- [ ] Set the reveal schedule in `reveal/schedule.json` (copy from `reveal/schedule.example.json`). The default is a **24-hour heist**: `maxGameHours: 24`, `startHidden: 14`. Every glyph has a hard drand time-lock, and the first five steps can also be pulled **early** by market-cap milestones. Hour → hidden curve:

      | by hour | step | hidden after |
      |---|---|---|
      | 0 | launch | 14 |
      | 2.5 | `mc-30k` ($30k mcap) | 13 |
      | 5 | `mc-75k` ($75k) | 12 |
      | 7.5 | `mc-150k` ($150k) | 11 |
      | 10 | `mc-300k` ($300k) | 10 |
      | 12.5 | `mc-600k` ($600k) | 9 |
      | 15 | `drip-1` | 8 |
      | 17 | `drip-2` | 7 |
      | 19 | `drip-3` | 6 |
      | 20.5 | `drip-4` | 5 |
      | 22 | `drip-5` | 4 |
      | 24 | `final` (incl. position 0) | 0 |

      Milestones fire **instantly** — the first poll where the mcap crosses the threshold on **any one reliable feed** (DexScreener or GeckoTerminal) pops that lock, using a source's recent high so a spike between polls still counts (`milestoneRule`). The bot polls every 5 min, so a reveal lands within a few minutes. The source/value/time are recorded as `evidence` and shown on the site. A milestone only pulls a glyph *earlier*; the time-lock is the backstop.
- [ ] `node launch/timelock.js` — encrypts each hidden glyph to its step **deadline** via drand and writes
      `site/timelocks.json`. These ciphertexts are public and no one (including you) can open one early.
- [ ] Sanity check: `node reveal/verify-reveals.js` and `node reveal/tlock-open.js` (nothing due yet should open nothing).

## 3. Create the coin on pump.fun (your own wallet)
- [ ] Create the coin on pump.fun **from your creator wallet** — name, ticker, image, and the site link.
- [ ] At the fee-type prompt choose **Creator fees**, **not Holders**. Holder-reward coins can't use fee sharing
      (`HolderRewardCreatorImmutable`), which would break the whole game.

## 4. Lock 100% of creator fees to the puzzle wallet
- [ ] In the pump.fun UI (fee sharing), add the **puzzle wallet** as the only recipient at **100%**, OR run
      `node launch/fee-split.js plan` (dry-run) and review, then execute the printed transaction yourself.
- [ ] pump.fun revokes the split admin once it is written, so the split becomes **permanent**.
- [ ] Verify: `node launch/fee-split.js status --mint <MINT>` shows the puzzle wallet as a shareholder and
      `admin_revoked: true`. Also confirm on Solscan. Put the proof tx in `site/config.js` (`feeSplitProofTx`).

## 5. Publish the site + bot (GitHub)
- [ ] Push the repo to GitHub. In **Settings → Pages**, set the source to **GitHub Actions**.
- [ ] Add Actions secrets (**Settings → Secrets and variables → Actions**):
      - `TOKEN_MINT` — the mint address (required).
      - `THIEF_SECRET_B64` — `base64 -w0 secrets/secret.json` (**optional**). Needed only for *milestone-early*
        reveals and the final full-key reveal on win. Omit it and the trustless time-locked path still opens every
        glyph at its deadline. Trust note: whoever holds this can reveal early — if you'd rather GitHub not hold it,
        run `node bot/loop.js` on your own machine with `secrets/secret.json` present instead.
- [ ] Set `site/config.js` (mint, RPC endpoints, links, `feeSplitProofTx`) and `bot/config.json` (copy from
      `bot/config.example.json`).

## 6. Pre-launch gate & flipping the switch

Until you launch, the public site must **not** show the game. The GitHub Actions workflow handles this automatically using one repo variable and one secret — no code change needed to go live.

**How it works (`.github/workflows/keydrip-bot.yml`, "Assemble Pages output" step):**
- While the repo **variable** `LAUNCHED` is anything other than `true` (the default), the workflow deploys the **teaser** (`teaser/`) to the site root (`https://thethief.fun`). The teaser shows the locked-vault animation, "THE VAULT IS BEING LOCKED / Sealing the safe… / The heist opens soon." and the X link — **no countdown, no prize numbers, no hype**. It is allowed to be indexed by search engines.
- For your own private preview, the workflow publishes the **full game** at `https://thethief.fun/p/<PREVIEW_SLUG>/`, where `PREVIEW_SLUG` is a random, unguessable value stored **only** as an Actions **secret** (never committed). The preview page carries `<meta name="robots" content="noindex, nofollow">` and the deployed `robots.txt` disallows the `/p/` prefix, so it stays out of search results. The slug prefix in `robots.txt` never reveals the secret slug itself.

**One-time setup (already done for this repo):**
```sh
# random, unguessable preview slug — stored ONLY as a secret, never in git
gh secret set PREVIEW_SLUG --repo <owner>/<repo> --body "v$(openssl rand -hex 14)"
# keep the game hidden until launch
gh variable set LAUNCHED --repo <owner>/<repo> --body false
```
Your private preview URL is `https://thethief.fun/p/<the-slug-you-set>/`. Keep it to yourself; anyone with the full URL can view the full game.

**To flip the switch and go live (after steps 1–5 and the token is created):**
```sh
gh variable set LAUNCHED --repo <owner>/<repo> --body true
gh workflow run "The Vault Thief bot" --repo <owner>/<repo>   # or just wait for the next */5 tick
```
That single change makes the next deploy publish the **full game at the site root** and open `robots.txt` to full indexing. To pull it back to teaser-only, set `LAUNCHED` to `false` again. (The same `teaser/` page is what everyone sees pre-launch; edit it there if you want different copy.)

## 7. Go live
- [ ] Run the bot once to seed the site: `node bot/run.js --mint <MINT>` (or let the `*/5` Actions schedule do it).
      It writes `site/reveals.json`, `site/feed.json`, X drafts under `drafts/`, and commits + deploys Pages.
- [ ] **Delete the seed** from any online machine. Keep `secrets/` only where you run milestone reveals (if at all);
      it is git-ignored. `public-commitment.json` and `site/timelocks.json` are enough for the trustless path.
- [ ] Announce: copy the launch tweet from `drafts/` (the bot never posts — you do).

## After a win
- When someone sweeps the vault, the next tick marks the game **won**, records the winner tx, reveals the full key,
  and flips the site to the winner state with a Solscan link.
- The split is permanent, so creator fees keep arriving at that now-public wallet — it becomes a **sweeper race**.
  This is stated openly on the site; decide in advance whether you'll run a season 2 with a fresh key.
