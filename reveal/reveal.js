#!/usr/bin/env node
/*
 * KeyPuzzle — build the public site/reveals.json (v2).
 *
 *   node reveal/reveal.js [--mint <MINT>] [--now <ISO>] [--done mc-50k,...] [--public]
 *                         [--timelocks site/timelocks.json] [--state reveal/milestones-state.json] [--out site/reveals.json]
 *
 * A step is DONE when its deadline has passed (time-lock) OR its milestone triggered (milestone-watch state file,
 * or --done ids for manual override). A done step implies all earlier steps are done.
 * For every revealed glyph, reveals.json publishes char + salt, verifiable against the commitment from launch.
 *
 * --public: no secret needed. Deadline-passed glyphs are opened by decrypting the drand time-locks, so ANYONE can
 *           rebuild reveals.json if the creator disappears. (Milestone-early reveals need the creator's secret.)
 */
const fs = require('fs');
const path = require('path');
const { feeSplitAccounts, glyphCommitment, difficulty } = require('../lib/common');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const PUBLIC = args.includes('--public');
const now = Date.parse(opt('--now', new Date().toISOString()));
const MINT = opt('--mint', process.env.TOKEN_MINT || '');
const tl = JSON.parse(fs.readFileSync(path.resolve(opt('--timelocks', path.join(root, 'site/timelocks.json'))), 'utf8'));
const statePath = path.resolve(opt('--state', path.join(root, 'reveal/milestones-state.json')));
const outPath = path.resolve(opt('--out', path.join(root, 'site/reveals.json')));
const pub = JSON.parse(fs.readFileSync(path.join(root, 'public-commitment.json'), 'utf8'));
const winnerFile = opt('--winner', path.join(root, 'bot/state/winner.json'));
const winner = fs.existsSync(winnerFile) ? JSON.parse(fs.readFileSync(winnerFile, 'utf8')) : null;

const manual = new Set((opt('--done', '') || '').split(',').map(s => s.trim()).filter(Boolean));
const triggered = new Map(); // id -> ISO
const evidence = new Map(); // id -> { source, mcapUsd, at, via }
if (fs.existsSync(statePath)) { const _st = JSON.parse(fs.readFileSync(statePath, 'utf8')); for (const [id, t] of Object.entries(_st.triggered || {})) triggered.set(id, t); for (const [id, e] of Object.entries(_st.evidence || {})) evidence.set(id, e); }
for (const id of manual) if (!triggered.has(id)) triggered.set(id, new Date(now).toISOString());

const steps = tl.scheduleSteps;
let doneThrough = -1; // index of last done step
steps.forEach((s, i) => { if (Date.parse(s.deadline) <= now || triggered.has(s.id)) doneThrough = i; });

(async () => {
  // Which glyph values can we publish?
  let opened = new Map(); // k -> {char, salt}
  let dueKs = steps.slice(0, doneThrough + 1).flatMap(s => s.glyphs);
  const secretPath = path.resolve(opt('--secret', path.join(root, 'secrets/secret.json')));
  const haveSecret = fs.existsSync(secretPath);
  if (winner) { // game over: try to reveal everything. Prefer secret; else whatever time-locks are already open.
    if (haveSecret) dueKs = tl.entries.map(e => e.k);
    else dueKs = [...new Set([...dueKs, ...tl.entries.filter(e => Date.parse(e.deadline) <= now).map(e => e.k)])];
  }
  if (PUBLIC) {
    const { timelockDecrypt, mainnetClient } = require('tlock-js');
    const client = mainnetClient();
    for (const e of tl.entries) {
      if (!dueKs.includes(e.k)) continue;
      if (Date.parse(e.deadline) > now) { console.warn(`k=${e.k}: milestone-early reveal needs the creator's secret (time-lock opens ${e.deadline})`); continue; }
      try { const p = JSON.parse((await timelockDecrypt(e.ciphertext, client)).toString()); opened.set(e.k, p); }
      catch (err) { console.warn(`k=${e.k}: could not open time-lock yet (${err.message.slice(0, 60)})`); }
    }
  } else {
    const secret = JSON.parse(fs.readFileSync(path.resolve(opt('--secret', path.join(root, 'secrets/secret.json'))), 'utf8'));
    if (secret.address !== tl.wallet) throw new Error('timelocks.json belongs to a different wallet');
    for (const k of dueKs) opened.set(k, { pos: secret.glyphs[k].pos, char: secret.glyphs[k].char, salt: secret.glyphs[k].salt });
  }

  const masked = [...pub.masked];
  const glyphs = tl.entries.map(e => {
    const st = steps.find(s => s.id === e.step);
    const o = opened.get(e.k);
    const g = { k: e.k, pos: e.pos, commitment: e.commitment, step: e.step, deadline: e.deadline, round: e.round, revealed: false };
    if (o) {
      if (o.pos !== e.pos || glyphCommitment(e.pos, o.char, o.salt) !== e.commitment) throw new Error(`commitment mismatch at k=${e.k}`);
      const byDeadline = Date.parse(e.deadline) <= now;
      const byMilestone = st && triggered.has(st.id);
      const revealedBy = byDeadline ? 'timelock' : (byMilestone ? 'milestone' : 'winner');
      Object.assign(g, { revealed: true, char: o.char, salt: o.salt,
        revealedBy, revealedAt: byDeadline ? e.deadline : (byMilestone ? triggered.get(st.id) : new Date(now).toISOString()) });
      if (revealedBy === 'milestone' && st && evidence.has(st.id)) g.evidence = evidence.get(st.id);
      masked[e.pos] = o.char;
    }
    return g;
  });
  const hiddenPos = glyphs.filter(g => !g.revealed).map(g => g.pos);
  const d = difficulty(hiddenPos);
  const nextStep = steps.find((s, i) => i > doneThrough) || null;
  const out = {
    version: 2,
    generatedAt: new Date().toISOString(),
    wallet: tl.wallet,
    feeSplit: MINT ? feeSplitAccounts(MINT) : null,
    puzzle: {
      encoding: 'base58 of the 32-byte ed25519 seed (exactly 44 chars)',
      masked: masked.join(''),
      length: 44,
      hiddenCount: hiddenPos.length,
      revealedCount: 44 - hiddenPos.length,
      revealsDone: doneThrough + 1,
      firstCharHidden: hiddenPos.includes(0),
      bitsRemaining: +d.bits.toFixed(1),
      searchSpace: hiddenPos.length ? (hiddenPos.includes(0) ? `17 × 58^${hiddenPos.length - 1}` : `58^${hiddenPos.length}`) + ` ≈ ${Number(d.tries).toExponential(2)}` : 'solved',
      expectedTries: d.expectedTries,
    },
    glyphs,
    steps: steps.map((s, i) => ({ id: s.id, label: s.label, milestone: s.milestone, deadline: s.deadline, glyphs: s.glyphs.length,
      done: i <= doneThrough, doneBy: i > doneThrough ? null : (Date.parse(s.deadline) <= now ? 'timelock' : 'milestone'), evidence: evidence.get(s.id) || null })),
    next: nextStep ? { id: nextStep.id, label: nextStep.label, deadline: nextStep.deadline, milestone: nextStep.milestone } : null,
    milestoneRule: tl.milestoneRule,
    timelock: { file: 'timelocks.json', ...tl.drand },
    commitmentScheme: 'sha256("<pos>|<char>|<salt>")',
    final: hiddenPos.length === 0,
    game: {
      status: winner ? 'won' : 'live',
      winner: winner ? { tx: winner.tx, solscan: `https://solscan.io/tx/${winner.tx}`,
        amountSol: winner.outLamports != null ? +(winner.outLamports / 1e9).toFixed(4) : null,
        at: winner.at || (winner.blockTime ? new Date(winner.blockTime * 1000).toISOString() : null) } : null,
      sweeperRaceNotice: 'The split is locked, so creator fees keep arriving at this now-public wallet. First to move each new fee keeps it.',
    },
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`Wrote ${outPath}${PUBLIC ? ' (public mode, from time-locks)' : ''}`);
  console.log(`  masked : ${out.puzzle.masked}`);
  console.log(`  hidden : ${out.puzzle.hiddenCount} (~${out.puzzle.bitsRemaining} bits), next: ${nextStep ? nextStep.label + ' — at the latest ' + nextStep.deadline : '—'}`);
})().catch(e => { console.error('error:', e.message); process.exit(1); });
