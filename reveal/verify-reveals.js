#!/usr/bin/env node
/*
 * KeyPuzzle — verify a published reveals.json against the launch commitments. No secret needed.
 *   node reveal/verify-reveals.js [--reveals site/reveals.json] [--commitments public-commitment.json]
 * Checks: every revealed glyph's sha256("pos|char|salt") matches its commitment, revealed chars sit in the
 * masked string, commitments match the ones published at launch, and masked length is 44.
 */
const fs = require('fs');
const path = require('path');
const { glyphCommitment } = require('../lib/common');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const r = JSON.parse(fs.readFileSync(path.resolve(opt('--reveals', path.join(root, 'site/reveals.json'))), 'utf8'));
const pub = JSON.parse(fs.readFileSync(path.resolve(opt('--commitments', path.join(root, 'public-commitment.json'))), 'utf8'));
let bad = 0;
const commitByPos = Object.fromEntries(pub.commitments.map(c => [c.pos, c.commitment]));
if (r.puzzle.masked.length !== 44) { console.error('FAIL masked length != 44'); bad++; }
for (const g of r.glyphs) {
  if (g.commitment !== commitByPos[g.pos]) { console.error(`FAIL k=${g.k} pos=${g.pos}: commitment differs from launch`); bad++; continue; }
  if (!g.revealed) continue;
  if (glyphCommitment(g.pos, g.char, g.salt) !== g.commitment) { console.error(`FAIL k=${g.k} pos=${g.pos}: char+salt do not match commitment`); bad++; }
  else if (r.puzzle.masked[g.pos] !== g.char) { console.error(`FAIL k=${g.k} pos=${g.pos}: masked char mismatch`); bad++; }
  else console.log(`OK   k=${g.k} pos=${g.pos} '${g.char}' (${g.revealedBy || 'revealed'})`);
}
console.log(bad ? `\n${bad} problem(s).` : `\nAll ${r.glyphs.filter(g => g.revealed).length} revealed glyph(s) verify against the launch commitments.`);
process.exit(bad ? 1 : 0);
