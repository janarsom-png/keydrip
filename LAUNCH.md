# The Vault Thief — launch checklist

A short, do-it-in-order checklist. Nothing here posts to X or sends a transaction on your behalf;
the fee-split and generate steps are the only ones that touch a wallet, and both are dry-run / offline by default.

## 1. Generate the puzzle key (offline)
- [ ] On a **clean, offline** machine: `npm install`, then `node gen/generate.js --hidden 14`.
- [ ] This writes `secrets/secret.json` + `secrets/keypair.json` (0600) and the public `public-commitment.json`.
      `public-commitment.json` holds the puzzle wallet **address** and the per-position salted commitments — nothing secret.
- [ ] Confirm the seed base58 is **44 chars** (the generator loops until it is).

## 2. Time-lock every hidden glyph (guaranteed ending)
- [ ] Set the reveal schedule in `reveal/schedule.json` (copy from `reveal/schedule.example.json`).
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

## 6. Go live
- [ ] Run the bot once to seed the site: `node bot/run.js --mint <MINT>` (or let the `*/10` Actions schedule do it).
      It writes `site/reveals.json`, `site/feed.json`, X drafts under `drafts/`, and commits + deploys Pages.
- [ ] **Delete the seed** from any online machine. Keep `secrets/` only where you run milestone reveals (if at all);
      it is git-ignored. `public-commitment.json` and `site/timelocks.json` are enough for the trustless path.
- [ ] Announce: copy the launch tweet from `drafts/` (the bot never posts — you do).

## After a win
- When someone sweeps the vault, the next tick marks the game **won**, records the winner tx, reveals the full key,
  and flips the site to the winner state with a Solscan link.
- The split is permanent, so creator fees keep arriving at that now-public wallet — it becomes a **sweeper race**.
  This is stated openly on the site; decide in advance whether you'll run a season 2 with a fresh key.
