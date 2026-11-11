#!/usr/bin/env node
/*
 * KeyPuzzle — time-lock EVERY hidden glyph with drand tlock (quicknet), so the game is guaranteed to end.
 *
 *   node launch/timelock.js --launch 2026-12-01T18:00:00Z [--schedule reveal/schedule.json] [--out site/timelocks.json]
 *
 * For each hidden glyph k it encrypts {"pos","char","salt"} to the drand round of its step's deadline.
 * Nobody (including the creator) can make the ciphertext open earlier; after the deadline ANYONE can decrypt it
 * (node reveal/tlock-open.js, the site itself, or https://timevault.drand.love) and verify it against the
 * per-position commitment. Milestones can only reveal EARLIER (creator publishes char+salt sooner).
 *
 * Output is PUBLIC (no secrets): publish it at launch together with public-commitment.json.
 * Trust assumption: drand's League of Entropy threshold network (no single party can decrypt early).
 */
const fs = require('fs');
const path = require('path');
const { timelockEncrypt, mainnetClient, roundAt, Buffer } = require('tlock-js');
const { loadSchedule, resolveSchedule } = require('../lib/schedule');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const launch = opt('--launch'); if (!launch) { console.error('usage: timelock.js --launch <ISO time>'); process.exit(1); }
const secret = JSON.parse(fs.readFileSync(path.resolve(opt('--secret', path.join(root, 'secrets/secret.json'))), 'utf8'));
const schedule = loadSchedule(opt('--schedule'));
const out = path.resolve(opt('--out', path.join(root, 'site/timelocks.json')));

(async () => {
  if (secret.version !== 2) throw new Error('secret.json is v1 — regenerate with gen/generate.js');
  const steps = resolveSchedule(schedule, secret.glyphs.length, launch);
  const client = mainnetClient();
  const info = await client.chain().info();
  const entries = [];
  for (const st of steps) {
    const round = roundAt(Date.parse(st.deadline), info);
    for (const k of st.glyphs) {
      const g = secret.glyphs[k];
      const payload = Buffer.from(JSON.stringify({ pos: g.pos, char: g.char, salt: g.salt }));
      const ciphertext = await timelockEncrypt(round, payload, client);
      entries.push({ k, pos: g.pos, commitment: g.commitment, step: st.id, deadline: st.deadline, round, ciphertext });
    }
  }
  const doc = {
    version: 2,
    wallet: secret.address,
    launch: new Date(Date.parse(launch)).toISOString(),
    scheduleSteps: steps,
    milestoneRule: schedule.milestoneRule || null,
    drand: { network: 'quicknet (League of Entropy)', chainHash: info.hash, period: info.period, genesisTime: info.genesis_time,
             api: 'https://api.drand.sh', format: 'age-armored tlock (tlock-js / timevault.drand.love compatible)' },
    entries,
  };
  fs.writeFileSync(out, JSON.stringify(doc, null, 2));
  console.log(`Time-locked ${entries.length} glyphs to ${steps.length} deadlines → ${out}`);
  for (const st of steps) console.log(`  ${st.id.padEnd(8)} ${st.deadline}  glyphs k=${st.glyphs.join(',')}${st.milestone ? `  (or earlier: sustained $${st.milestone.mcapUsd.toLocaleString()} mcap)` : ''}`);
  console.log('Publish this file at launch (site/timelocks.json). It contains no secrets.');
})().catch(e => { console.error('error:', e.message); process.exit(1); });
