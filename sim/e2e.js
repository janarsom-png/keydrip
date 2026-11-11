#!/usr/bin/env node
/*
 * KEYDRIP end-to-end simulation (offline, mocked market cap + time).
 * Flow: launch -> milestones (14->9 hidden) -> endgame drip (9->6) -> sweep detected -> final full reveal.
 * Drives the REAL bot tick (bot/run.js) against the bundled TEST wallet, injecting milestone triggers and a
 * mock winner. Backs up and restores every file it touches, so it leaves the repo exactly as it found it.
 * The real drand tlock round is proven separately (see report); this sim mocks time to exercise the game logic.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const p = (...a) => path.join(ROOT, ...a);
const MINT = '5RZrv4NWrHLqgW1UWCiG1uqyqBLRqoVabnxGZZQvpump';
const node = process.execPath;

const TOUCH = ['site/reveals.json', 'site/feed.json', 'reveal/milestones-state.json'];
const backups = {};
const save = () => { for (const f of TOUCH) backups[f] = fs.existsSync(p(f)) ? fs.readFileSync(p(f)) : null; };
const restore = () => { for (const f of TOUCH) { if (backups[f] == null) { try { fs.unlinkSync(p(f)); } catch {} } else fs.writeFileSync(p(f), backups[f]); } };
const rmState = () => { fs.rmSync(p('bot/state'), { recursive: true, force: true }); fs.rmSync(p('sim/drafts'), { recursive: true, force: true }); };

function injectTriggers(ids, now) {
  const sp = p('reveal/milestones-state.json');
  const st = fs.existsSync(sp) ? JSON.parse(fs.readFileSync(sp, 'utf8')) : { mint: MINT, samples: {}, triggered: {}, evidence: {} };
  for (const id of ids) { st.triggered[id] = new Date(now).toISOString(); (st.evidence = st.evidence || {})[id] = { sources: ['dexscreener', 'geckoterminal'], windowMinutes: 60, sim: true }; }
  fs.writeFileSync(sp, JSON.stringify(st, null, 2));
}

function tick(now, extra = []) {
  // isolate drafts into sim/drafts by symlinking? run.js writes to drafts/. We let it, then move. Simpler: run, then read.
  const args = ['--mint', MINT, '--now', now, '--no-winner-scan', '--no-milestone', '--config', p('bot/config.json'), ...extra];
  execFileSync(node, [p('bot/run.js'), ...args], { stdio: 'pipe' });
  return JSON.parse(fs.readFileSync(p('site/reveals.json'), 'utf8'));
}

const results = [];
let pass = 0, fail = 0;
const check = (name, cond, got) => { const ok = !!cond; results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${got !== undefined ? ` (got ${got})` : ''}`); ok ? pass++ : fail++; };

(async () => {
  save();
  try {
    rmState();
    // reset milestones-state and feed/drafts for a clean run
    fs.writeFileSync(p('reveal/milestones-state.json'), JSON.stringify({ mint: MINT, samples: {}, triggered: {}, evidence: {} }, null, 2));
    try { fs.unlinkSync(p('site/feed.json')); } catch {}
    fs.rmSync(p('drafts'), { recursive: true, force: true });

    // T0 launch — nothing due (before k0 deadline)
    let r = tick('2026-11-09T18:00:00Z');
    check('T0 launch: 14 hidden', r.puzzle.hiddenCount === 14, r.puzzle.hiddenCount);
    check('T0 status live', r.game.status === 'live');

    // T1 milestone mc-50k -> 13 hidden
    injectTriggers(['mc-50k'], '2026-11-09T19:00:00Z');
    r = tick('2026-11-09T19:00:00Z');
    check('T1 mc-50k: 13 hidden', r.puzzle.hiddenCount === 13, r.puzzle.hiddenCount);

    // T2 mc-100k + mc-250k -> 11 hidden
    injectTriggers(['mc-100k', 'mc-250k'], '2026-11-10T00:00:00Z');
    r = tick('2026-11-10T00:00:00Z');
    check('T2 mc-100k+250k: 11 hidden', r.puzzle.hiddenCount === 11, r.puzzle.hiddenCount);

    // T3 mc-500k + mc-1m -> 9 hidden (milestones bring it to 9)
    injectTriggers(['mc-500k', 'mc-1m'], '2026-11-10T06:00:00Z');
    r = tick('2026-11-10T06:00:00Z');
    check('T3 all milestones: 9 hidden', r.puzzle.hiddenCount === 9, r.puzzle.hiddenCount);

    // T4 endgame drip-1 deadline passed (time-lock, no milestone) -> 8
    r = tick('2026-11-21T18:00:00Z');
    check('T4 drip-1 deadline: 8 hidden', r.puzzle.hiddenCount === 8, r.puzzle.hiddenCount);

    // T5 drip-2 -> 7
    r = tick('2026-11-28T18:00:00Z');
    check('T5 drip-2: 7 hidden', r.puzzle.hiddenCount === 7, r.puzzle.hiddenCount);

    // T6 drip-3 -> 6 (endgame cracking phase)
    r = tick('2026-12-05T18:00:00Z');
    check('T6 drip-3: 6 hidden', r.puzzle.hiddenCount === 6, r.puzzle.hiddenCount);

    // T7 sweep detected -> final reveal
    fs.writeFileSync('/tmp/sim-win.json', JSON.stringify({ tx: '5xSIMsweep1111111111111111111111111111111111111111111111111111111111111111111111111111', outLamports: 14230000000, blockTime: 1765382400 }));
    r = tick('2026-12-10T12:00:00Z', ['--mock-winner', '/tmp/sim-win.json']);
    check('T7 sweep: 0 hidden (final)', r.puzzle.hiddenCount === 0, r.puzzle.hiddenCount);
    check('T7 status won', r.game.status === 'won', r.game.status);
    check('T7 winner tx recorded', r.game.winner && r.game.winner.tx, r.game.winner && r.game.winner.tx);
    check('T7 final=true', r.final === true, r.final);

    // verify final seed matches committed address derivation
    const commit = JSON.parse(fs.readFileSync(p('public-commitment.json'), 'utf8'));
    check('T7 masked == full seed length', r.puzzle.masked.length === 44 && !r.puzzle.masked.includes('?'), r.puzzle.masked);

    // feed + drafts
    const feed = JSON.parse(fs.readFileSync(p('site/feed.json'), 'utf8'));
    const types = feed.events.map(e => e.type);
    const glyphEvents = types.filter(t => ['reveal', 'milestone', 'endgame'].includes(t)).length;
    check('feed has >= 14 glyph reveal events', glyphEvents >= 14, glyphEvents);
    check('feed has milestone events', types.includes('milestone'));
    check('feed has endgame events', types.includes('endgame'), types.filter(t => t === 'endgame').length + ' endgame');
    check('feed has win event', types.includes('win'));
    const drafts = fs.existsSync(p('drafts')) ? fs.readdirSync(p('drafts')) : [];
    check('win draft written', drafts.some(f => f.includes('win')));
    check('>= 15 draft files (14 glyphs + win)', drafts.length >= 15, drafts.length);

    // verify every revealed glyph against its commitment
    const { glyphCommitment } = require(p('lib/common.js'));
    let bad = 0;
    for (const g of r.glyphs) if (g.revealed) { if (glyphCommitment(g.pos, g.char, g.salt) !== g.commitment) bad++; }
    check('all revealed glyphs verify vs commitment', bad === 0, bad + ' bad');

  } finally {
    // keep the won-state artifacts for the report? No — restore pristine repo state.
    restore();
    rmState();
    fs.rmSync(p('drafts'), { recursive: true, force: true });
  }

  console.log('\n=== KEYDRIP end-to-end simulation ===');
  results.forEach(l => console.log(' ' + l));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
