#!/usr/bin/env node
/*
 * KeyPuzzle — open any time-locked glyph whose deadline has passed, with NO secret.
 * Lets anyone rebuild reveals.json if the creator disappears.
 *   node reveal/tlock-open.js [--timelocks site/timelocks.json] [--k 0]   # one glyph, or all that are due
 * Verifies each opened glyph against its per-position commitment.
 */
const fs = require('fs');
const path = require('path');
const { timelockDecrypt, mainnetClient } = require('tlock-js');
const { glyphCommitment } = require('../lib/common');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const tl = JSON.parse(fs.readFileSync(path.resolve(opt('--timelocks', path.join(__dirname, '..', 'site/timelocks.json'))), 'utf8'));
const only = opt('--k');
(async () => {
  const client = mainnetClient(); const now = Date.now();
  for (const e of tl.entries) {
    if (only !== undefined && String(e.k) !== only) continue;
    if (Date.parse(e.deadline) > now) { console.log(`k=${e.k} pos=${e.pos}: locked until ${e.deadline}`); continue; }
    try {
      const p = JSON.parse((await timelockDecrypt(e.ciphertext, client)).toString());
      const ok = p.pos === e.pos && glyphCommitment(e.pos, p.char, p.salt) === e.commitment;
      console.log(`k=${e.k} pos=${e.pos}: '${p.char}'  commitment ${ok ? 'VALID' : 'INVALID'}  (step ${e.step})`);
    } catch (err) { console.log(`k=${e.k} pos=${e.pos}: not open yet (${err.message.slice(0, 50)})`); }
  }
})().catch(e => { console.error(e.message); process.exit(1); });
