#!/usr/bin/env node
/*
 * The Vault Thief bot: LIVE-GAME LOOP for GitHub Actions (also runs locally).
 *
 *   node bot/ci-loop.js --mint <MINT> [--duration-min 340] [--interval-sec 60] [--heartbeat-min 10]
 *                       [--grace-min 120] [--exit-file <path>] [--dry] [-- <extra args passed to bot/run.js>]
 *
 * Every --interval-sec (default 60 s) it runs ONE tick (bot/run.js), exactly as the old 5-minute cron did, then:
 *   - if something MEANINGFUL changed (a glyph opened, a milestone triggered, a new feed event, the winner):
 *       commit + push immediately and ask GitHub to redeploy Pages (workflow_dispatch of pages.yml);
 *   - otherwise it still commits + redeploys every --heartbeat-min (default 10 min) so the prize pool and the
 *     "reveals updated" stamp on the site stay fresh, without 1,440 commits/deploys a day.
 * It stops when:
 *   - --duration-min has elapsed (default 340 min = 5h40m, under the 6 h job limit) -> reason "duration"
 *     (the workflow then dispatches a fresh run of itself so the chain continues);
 *   - the game is OVER: winner found (game.status == "won") or now > final deadline + --grace-min -> reason "over"
 *     (no successor; the throttled 5-minute cron keeps doing occasional single ticks).
 * The reason is written to --exit-file as JSON.
 *
 * --dry : never touches git or GitHub (no commit, push or dispatch), just logs what it would do. For local tests.
 *
 * Safety: like bot/run.js it never posts to X and never sends an on-chain transaction. It never prints secrets.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const p = (...a) => path.join(ROOT, ...a);

const argv = process.argv.slice(2);
const dd = argv.indexOf('--');
const own = dd >= 0 ? argv.slice(0, dd) : argv;
const extra = dd >= 0 ? argv.slice(dd + 1) : [];
const opt = (n, d) => { const i = own.indexOf(n); return i >= 0 ? own[i + 1] : d; };
const MINT = opt('--mint', process.env.TOKEN_MINT || '');
const DURATION_MS = parseFloat(opt('--duration-min', '340')) * 60e3;
const INTERVAL_MS = parseFloat(opt('--interval-sec', '60')) * 1e3;
const HEARTBEAT_MS = parseFloat(opt('--heartbeat-min', '10')) * 60e3;
const GRACE_MS = parseFloat(opt('--grace-min', '120')) * 60e3;
const EXIT_FILE = opt('--exit-file', '');
const DRY = own.includes('--dry');
const BRANCH = process.env.GITHUB_REF_NAME || 'main';
const PAGES_WORKFLOW = opt('--pages-workflow', 'pages.yml');
const TRACKED = ['site/reveals.json', 'site/feed.json', 'reveal/milestones-state.json', 'bot/state', 'drafts'];

const ts = () => new Date().toISOString();
const log = (...a) => console.log(`[${ts()}]`, ...a);
const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));
const readJson = f => { try { return JSON.parse(fs.readFileSync(p(f), 'utf8')); } catch { return null; } };
const sh = (cmd, args, o = {}) => execFileSync(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...o });
const trySh = (cmd, args) => { try { return { ok: true, out: sh(cmd, args) }; } catch (e) { return { ok: false, out: String(e.stderr || e.message || '').slice(0, 400) }; } };

if (!MINT) { console.error('ci-loop: no mint (pass --mint or set TOKEN_MINT). Refusing to loop.'); process.exit(2); }

/** Signature of the things that matter to players; volatile fields (timestamps, prize pool) are ignored. */
function signature() {
  const r = readJson('site/reveals.json') || {};
  const f = readJson('site/feed.json') || {};
  const m = readJson('reveal/milestones-state.json') || {};
  const sig = {
    glyphs: (r.glyphs || []).filter(g => g.revealed).map(g => g.k).sort((a, b) => a - b),
    steps: (r.steps || []).map(s => [s.id, !!s.done, s.doneBy || null]),
    status: (r.game || {}).status || null,
    winner: ((r.game || {}).winner || {}).tx || null,
    events: (f.events || []).map(e => e.id).sort(),
    triggered: Object.keys(m.triggered || {}).sort(),
  };
  return crypto.createHash('sha256').update(JSON.stringify(sig)).digest('hex');
}

/** Is the game over? Winner found, or past the final deadline (+grace). Deadlines come from the fresh reveals.json. */
function gameOver(now) {
  const r = readJson('site/reveals.json');
  if (!r) return null;
  if (r.game && r.game.status === 'won') return 'winner found';
  const last = Math.max(...(r.steps || []).map(s => Date.parse(s.deadline)).filter(Number.isFinite));
  if (Number.isFinite(last) && now > last + GRACE_MS) return `past final deadline ${new Date(last).toISOString()} + ${GRACE_MS / 60e3} min grace`;
  return null;
}

function tick() {
  const t0 = Date.now();
  try {
    execFileSync(process.execPath, [p('bot/run.js'), '--mint', MINT, ...extra], { cwd: ROOT, stdio: 'inherit' });
  } catch (e) { log('tick returned non-zero (non-fatal); continuing'); }
  return Date.now() - t0;
}

/** Commit tracked state and push to origin/<branch>. Bot files win on conflict (-X theirs = the bot's commit while rebasing). */
function persist(reason) {
  if (DRY) { log(`DRY: would commit + push (${reason})`); return true; }
  for (const f of TRACKED) if (fs.existsSync(p(f))) trySh('git', ['add', '--', f]);
  const staged = trySh('git', ['diff', '--cached', '--quiet']);
  if (staged.ok) { log('nothing to commit'); return true; }
  const c = trySh('git', ['commit', '-q', '-m', `bot tick ${ts()} (${reason})`]);
  if (!c.ok) { log('commit failed:', c.out); return false; }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const pull = trySh('git', ['pull', '-q', '--rebase', '-X', 'theirs', 'origin', BRANCH]);
    if (!pull.ok) { log(`pull --rebase failed (attempt ${attempt}):`, pull.out); trySh('git', ['rebase', '--abort']); continue; }
    const push = trySh('git', ['push', '-q', 'origin', `HEAD:${BRANCH}`]);
    if (push.ok) { log(`pushed (${reason})`); return true; }
    log(`push failed (attempt ${attempt}):`, push.out);
  }
  log('could not push this tick; will retry next tick (commit kept locally)');
  return false;
}

/** Ask GitHub to rebuild + deploy Pages from the pushed commit. workflow_dispatch is allowed from GITHUB_TOKEN. */
function deploy() {
  if (DRY) { log(`DRY: would dispatch ${PAGES_WORKFLOW} on ${BRANCH}`); return true; }
  const r = trySh('gh', ['workflow', 'run', PAGES_WORKFLOW, '--ref', BRANCH]);
  if (r.ok) log(`Pages deploy dispatched (${PAGES_WORKFLOW})`); else log('Pages dispatch failed (will retry next tick):', r.out);
  return r.ok;
}

function finish(reason, detail) {
  log(`loop exit: ${reason}${detail ? ' (' + detail + ')' : ''}`);
  if (EXIT_FILE) fs.writeFileSync(EXIT_FILE, JSON.stringify({ reason, detail: detail || null, at: ts() }) + '\n');
  process.exit(0);
}

(async () => {
  const start = Date.now();
  log(`ci-loop start: every ${INTERVAL_MS / 1e3}s for up to ${DURATION_MS / 60e3} min, heartbeat ${HEARTBEAT_MS / 60e3} min${DRY ? ', DRY RUN' : ''}`);
  let lastSig = null, lastPublish = 0, pendingPush = false, pendingDeploy = false, n = 0;
  for (;;) {
    const tickStart = Date.now();
    n++;
    const took = tick();
    const sig = signature();
    const changed = lastSig !== null && sig !== lastSig;
    const first = lastSig === null;
    lastSig = sig;
    const heartbeat = Date.now() - lastPublish >= HEARTBEAT_MS;
    const over = gameOver(Date.now());
    log(`tick #${n} took ${(took / 1e3).toFixed(1)}s; changed=${changed} first=${first} heartbeat=${heartbeat} over=${!!over}`);
    if (changed || first || heartbeat || over || pendingPush || pendingDeploy) {
      const reason = changed ? 'change' : over ? 'game over' : first ? 'loop start' : pendingPush || pendingDeploy ? 'retry' : 'heartbeat';
      const pushed = persist(reason);
      pendingPush = !pushed;
      if (pushed) { pendingDeploy = !deploy(); if (!pendingDeploy) lastPublish = Date.now(); }
    }
    if (over && !pendingPush) finish('over', over);
    const elapsed = Date.now() - start;
    if (elapsed + INTERVAL_MS > DURATION_MS) {
      if (pendingPush || pendingDeploy) { const ok = persist('final'); if (ok) deploy(); }
      finish('duration', `${(elapsed / 60e3).toFixed(1)} min, ${n} ticks`);
    }
    await sleep(tickStart + INTERVAL_MS - Date.now());
  }
})().catch(e => { console.error('ci-loop error:', e && e.message); process.exit(1); });
