#!/usr/bin/env node
/*
 * The Vault Thief bot — ONE tick. Safe by design: read-only RPC + file writes only. Never posts to X, never sends on-chain.
 *
 *   node bot/run.js [--config bot/config.json] [--mock-winner <file>] [--now <ISO>] [--no-winner-scan]
 *
 * Steps:
 *   1. milestone-watch (one sample; sustained-window state persists in reveal/milestones-state.json — commit it).
 *   2. winner scan: is there a transaction signed by the puzzle wallet? If yes -> bot/state/winner.json.
 *   3. build site/reveals.json:
 *        - secret available (secrets/secret.json or env THIEF_SECRET_B64)  -> milestone-early + final-on-win reveals
 *        - otherwise `--public`: deadline-passed glyphs opened from drand time-locks, NO secret needed.
 *   4. diff vs last tick -> events (reveal / milestone / endgame / win) -> site/feed.json + drafts/<ts>-<type>.txt.
 *
 * Env: THIEF_SECRET_B64 (base64 of secret.json) enables milestone-early reveals on CI; omit for the trustless
 * time-locked path. See LAUNCH.md / README operator runbook.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT, p, readJson, writeJson, connect, detectWinner, prizePool } = require('./lib');
const { tweetFor } = require('./tweets');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const now = Date.parse(opt('--now', new Date().toISOString()));
const cfg = readJson(path.resolve(opt('--config', p('bot/config.json'))), null) || readJson(p('bot/config.example.json'), {});
const MINT = opt('--mint', cfg.mint || process.env.TOKEN_MINT || '');
const STATE = p('bot/state');
const SNAP = path.join(STATE, 'last-reveals.json');
const WINNER = path.join(STATE, 'winner.json');
const node = process.execPath;
const run = (file, a) => { try { execFileSync(node, [p(file), ...a], { stdio: 'pipe' }); return true; } catch (e) { console.error(`  ${file} failed: ${(e.stderr || e.message || '').toString().slice(0, 300)}`); return false; } };

function materializeSecret() {
  if (fs.existsSync(p('secrets/secret.json'))) return p('secrets/secret.json');
  if (process.env.THIEF_SECRET_B64) {
    const f = path.join(STATE, 'secret.runtime.json');
    fs.mkdirSync(STATE, { recursive: true });
    fs.writeFileSync(f, Buffer.from(process.env.THIEF_SECRET_B64, 'base64').toString('utf8'), { mode: 0o600 });
    return f;
  }
  return null;
}

(async () => {
  console.log(`The Vault Thief tick @ ${new Date(now).toISOString()}  mint=${MINT || '(unset)'}`);
  const already = readJson(WINNER, null);

  // 1. milestone sample (skip if already won)
  if (MINT && !already && !args.includes('--no-milestone')) {
    console.log('1. milestone-watch…');
    run('reveal/milestone-watch.js', ['--mint', MINT, '--once']);
  }

  // 2. winner scan
  let winner = already;
  const mock = opt('--mock-winner') || process.env.THIEF_MOCK_WINNER;
  if (mock && !winner) { winner = readJson(path.resolve(mock), null); if (winner) { writeJson(WINNER, winner); console.log('2. winner injected (mock).'); } }
  else if (!winner && MINT && !args.includes('--no-winner-scan')) {
    console.log('2. winner scan…');
    const prev = readJson(SNAP, {});
    try {
      const conn = connect(cfg);
      const wallet = (prev.wallet) || readJson(p('public-commitment.json'), {}).address;
      const w = wallet ? await detectWinner(conn, wallet) : null;
      if (w) { w.at = w.blockTime ? new Date(w.blockTime * 1000).toISOString() : new Date(now).toISOString(); writeJson(WINNER, w); winner = w; console.log(`   WINNER: ${w.tx} (${(w.outLamports / 1e9).toFixed(4)} SOL out)`); }
      else console.log('   no winning signature yet.');
    } catch (e) { console.error('   winner scan RPC error:', e.message); }
  }

  // 3. build reveals.json
  console.log('3. reveals.json…');
  const secretFile = materializeSecret();
  const revArgs = ['--mint', MINT, '--now', new Date(now).toISOString()];
  if (winner) revArgs.push('--winner', WINNER);
  if (secretFile) revArgs.push('--secret', secretFile); else revArgs.push('--public');
  run('reveal/reveal.js', revArgs);
  const reveals = readJson(p('site/reveals.json'), null);
  if (!reveals) { console.error('no reveals.json produced; aborting feed.'); process.exit(1); }
  reveals.prizePoolSol = MINT ? await prizePool(connect(cfg), reveals).catch(() => null) : null;
  writeJson(p('site/reveals.json'), reveals);

  // 4. events + feed + drafts
  console.log('4. feed + drafts…');
  const prev = readJson(SNAP, { glyphs: [], steps: [], game: { status: 'live' } });
  const prevRevealed = new Set((prev.glyphs || []).filter(g => g.revealed).map(g => g.k));
  const feed = readJson(p('site/feed.json'), { tokenName: cfg.tokenName, ticker: cfg.ticker, events: [] });
  const seen = new Set(feed.events.map(e => e.id));
  const newEvents = [];
  const add = ev => { ev.id = ev.id || `${ev.type}-${ev.ref}`; if (seen.has(ev.id)) return; ev.ts = ev.ts || new Date(now).toISOString(); ev.text = tweetFor(ev, cfg, reveals); newEvents.push(ev); seen.add(ev.id); };
  const stepById = Object.fromEntries(reveals.steps.map(s => [s.id, s]));

  // One event per newly revealed glyph, typed by how it opened.
  for (const g of reveals.glyphs) {
    if (!g.revealed || prevRevealed.has(g.k)) continue;
    const st = stepById[g.step] || {};
    const type = g.revealedBy === 'milestone' ? 'milestone'
      : (/drip|final/.test(g.step || '') ? 'endgame' : 'reveal');
    add({ type, ref: `glyph-${g.k}`, pos: g.pos, char: g.char, label: st.label, revealedBy: g.revealedBy, evidence: g.evidence || null, verified: true, title: st.label || `Glyph ${g.k} revealed` });
  }
  if (reveals.game && reveals.game.status === 'won' && prev.game.status !== 'won') {
    const w = reveals.game.winner || {};
    add({ type: 'win', ref: w.tx || 'win', tx: w.tx, amountSol: w.amountSol, solscan: w.solscan, title: 'Vault cracked' });
  }

  const drafts = p('drafts');
  fs.mkdirSync(drafts, { recursive: true });
  for (const ev of newEvents) {
    const stamp = ev.ts.replace(/[:.]/g, '-');
    const slug = String(ev.ref).replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 40);
    fs.writeFileSync(path.join(drafts, `${stamp}-${ev.type}-${slug}.txt`), ev.text + '\n');
    console.log(`   + ${ev.type} (${ev.ref}) -> draft`);
  }
  feed.events = [...feed.events, ...newEvents].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  feed.updatedAt = new Date(now).toISOString();
  feed.tokenName = cfg.tokenName; feed.ticker = cfg.ticker;
  feed.game = reveals.game;
  writeJson(p('site/feed.json'), feed);

  // snapshot for next diff
  writeJson(SNAP, { wallet: reveals.wallet, glyphs: reveals.glyphs, steps: reveals.steps, game: reveals.game });
  console.log(`Done. ${newEvents.length} new event(s). status=${reveals.game.status} hidden=${reveals.puzzle.hiddenCount}`);
})().catch(e => { console.error('tick error:', e); process.exit(1); });
