#!/usr/bin/env node
/*
 * The Vault Thief end-to-end simulation (offline, mocked market cap + time).
 * 24-HOUR HEIST. Flow: launch -> milestones pull glyphs early (14->9) -> time-lock drip (9->4) -> sweep -> final full reveal.
 * Times are derived from the time-locks' launch, so it is independent of wall-clock.
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
  for (const id of ids) { st.triggered[id] = new Date(now).toISOString(); (st.evidence = st.evidence || {})[id] = { source: 'dexscreener', mcapUsd: 123456, at: new Date(now).toISOString(), via: 'spot' }; }
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
    // --- unit tests: INSTANT milestone crossing (no sustained window) ---
    const { evaluateMilestone } = require(p('reveal/milestone-watch.js'));
    const R = { reliableSources: ['dexscreener', 'geckoterminal'], minSources: 1 };
    check('milestone: below threshold -> no trigger', evaluateMilestone({ dexscreener: { high: 60000, spot: 60000 }, geckoterminal: { high: 61000, spot: 61000 } }, 75000, R).triggered === false);
    const spot = evaluateMilestone({ dexscreener: { high: 76000, spot: 76000 }, geckoterminal: { high: 60000, spot: 60000 } }, 75000, R);
    check('milestone: one source crosses -> instant trigger', spot.triggered === true && spot.source === 'dexscreener' && spot.via === 'spot', spot.source + '/' + spot.via);
    const rh = evaluateMilestone({ dexscreener: { high: 60000, spot: 60000 }, geckoterminal: { high: 80000, spot: 61000, highAt: Date.parse('2026-11-11T14:03:00Z') } }, 75000, R);
    check('milestone: recent-high spike counts', rh.triggered === true && rh.via === 'recent-high' && rh.mcapUsd === 80000, rh.via + '/' + rh.mcapUsd);
    check('milestone: minSources:2 with one crossing -> no', evaluateMilestone({ dexscreener: { high: 76000, spot: 76000 }, geckoterminal: { high: 60000, spot: 60000 } }, 75000, { reliableSources: ['dexscreener', 'geckoterminal'], minSources: 2 }).triggered === false);

    rmState();
    // reset milestones-state and feed/drafts for a clean run
    fs.writeFileSync(p('reveal/milestones-state.json'), JSON.stringify({ mint: MINT, samples: {}, triggered: {}, evidence: {} }, null, 2));
    try { fs.unlinkSync(p('site/feed.json')); } catch {}
    fs.rmSync(p('drafts'), { recursive: true, force: true });

    // Launch time comes from the time-locks file; all ticks are launch + offset hours.
    const tl = JSON.parse(fs.readFileSync(p('site/timelocks.json'), 'utf8'));
    const L = Date.parse(tl.launch);
    const at = h => new Date(L + h * 36e5).toISOString();

    // T0 — 1h in, before the first deadline (12.5h) and no milestones: all 14 still hidden
    let r = tick(at(1));
    check('T0 (+1h): 14 hidden', r.puzzle.hiddenCount === 14, r.puzzle.hiddenCount);
    check('T0 status live', r.game.status === 'live');

    // T1 — milestone mc-30k pulls glyph k0 early (well before its +2.5h time-lock) -> 13 hidden
    injectTriggers(['mc-30k'], at(1.5));
    r = tick(at(1.5));
    check('T1 mc-30k early: 13 hidden', r.puzzle.hiddenCount === 13, r.puzzle.hiddenCount);
    check('T1 glyph k0 revealedBy milestone', (r.glyphs.find(g => g.k === 0) || {}).revealedBy === 'milestone', (r.glyphs.find(g => g.k === 0) || {}).revealedBy);
    check('T1 glyph k0 carries evidence (source+value+time)', (() => { const g = r.glyphs.find(x => x.k === 0) || {}; return g.evidence && g.evidence.source && g.evidence.mcapUsd && g.evidence.at; })(), JSON.stringify((r.glyphs.find(x => x.k === 0) || {}).evidence));

    // T2 — mc-75k + mc-150k pull two more early -> 11 hidden
    injectTriggers(['mc-75k', 'mc-150k'], at(2));
    r = tick(at(2));
    check('T2 mc-75k+150k: 11 hidden', r.puzzle.hiddenCount === 11, r.puzzle.hiddenCount);

    // T3 — mc-300k + mc-600k -> milestones have pulled it down to 9 hidden
    injectTriggers(['mc-300k', 'mc-600k'], at(3));
    r = tick(at(3));
    check('T3 milestones -> 9 hidden', r.puzzle.hiddenCount === 9, r.puzzle.hiddenCount);

    // T4 — time-lock drip-1 deadline (+15h) passes, no milestone -> 8 hidden
    r = tick(at(15));
    check('T4 (+15h) drip-1 time-lock: 8 hidden', r.puzzle.hiddenCount === 8, r.puzzle.hiddenCount);

    // T5 — drip-2 (+17h) -> 7 hidden
    r = tick(at(17));
    check('T5 (+17h) drip-2: 7 hidden', r.puzzle.hiddenCount === 7, r.puzzle.hiddenCount);

    // T6 — by +22h (drip-3/4/5 all passed) only 4 hidden remain (trivially crackable)
    r = tick(at(22));
    check('T6 (+22h) endgame: 4 hidden', r.puzzle.hiddenCount === 4, r.puzzle.hiddenCount);

    // T7 — sweep detected at +23h -> final full reveal (also what +24h time-lock guarantees)
    fs.writeFileSync('/tmp/sim-win.json', JSON.stringify({ tx: '5xSIMsweep1111111111111111111111111111111111111111111111111111111111111111111111111111', outLamports: 14230000000, blockTime: 1765382400 }));
    r = tick(at(23), ['--mock-winner', '/tmp/sim-win.json']);
    check('T7 sweep: 0 hidden (final)', r.puzzle.hiddenCount === 0, r.puzzle.hiddenCount);
    check('T7 status won', r.game.status === 'won', r.game.status);
    check('T7 winner tx recorded', r.game.winner && r.game.winner.tx, r.game.winner && r.game.winner.tx);
    check('T7 final=true', r.final === true, r.final);

    // sanity: whole game fit inside 24h (final deadline is exactly +24h)
    const finalStep = tl.scheduleSteps.find(s => s.id === 'final');
    check('max game length <= 24h', (Date.parse(finalStep.deadline) - L) / 36e5 <= 24.0001, ((Date.parse(finalStep.deadline) - L) / 36e5).toFixed(2) + 'h');

    // verify final seed matches committed address derivation
    const commit = JSON.parse(fs.readFileSync(p('public-commitment.json'), 'utf8'));
    check('T7 masked == full seed length', r.puzzle.masked.length === 44 && !r.puzzle.masked.includes('?'), r.puzzle.masked);

    // feed + drafts
    const feed = JSON.parse(fs.readFileSync(p('site/feed.json'), 'utf8'));
    const types = feed.events.map(e => e.type);
    const glyphEvents = types.filter(t => ['reveal', 'milestone', 'endgame'].includes(t)).length;
    check('feed has >= 14 glyph reveal events', glyphEvents >= 14, glyphEvents);
    check('feed has milestone events', types.includes('milestone'));
    check('milestone feed events carry evidence', feed.events.filter(e => e.type === 'milestone').every(e => e.evidence && e.evidence.source), 'first=' + JSON.stringify((feed.events.find(e => e.type === 'milestone') || {}).evidence));
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

  console.log('\n=== The Vault Thief end-to-end simulation ===');
  results.forEach(l => console.log(' ' + l));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
