// Schedule helpers shared by launch/timelock.js, reveal/reveal.js and reveal/milestone-watch.js.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');

function loadSchedule(p) {
  const file = p || (fs.existsSync(path.join(root, 'reveal/schedule.json')) ? path.join(root, 'reveal/schedule.json') : path.join(root, 'reveal/schedule.example.json'));
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  s._file = file;
  return s;
}
function parseDeadline(spec, launchMs) {
  const m = /^\+(\d+(?:\.\d+)?)([mhd])$/.exec(spec);
  if (m) return launchMs + parseFloat(m[1]) * { m: 6e4, h: 36e5, d: 864e5 }[m[2]];
  const t = Date.parse(spec); if (isNaN(t)) throw new Error('bad deadline ' + spec); return t;
}
/** Map steps -> glyph indices k (reveal order) + absolute deadlines. Validates totals and monotonic deadlines. */
function resolveSchedule(schedule, hiddenCount, launchIso) {
  const launchMs = Date.parse(launchIso); if (isNaN(launchMs)) throw new Error('bad launch time');
  let k = 0, prev = -Infinity;
  const steps = schedule.steps.map((st, i) => {
    const n = st.reveal || 1; const deadline = parseDeadline(st.deadline, launchMs);
    if (deadline <= prev) throw new Error(`deadline of step ${st.id} must be later than the previous step`);
    prev = deadline;
    const ks = Array.from({ length: n }, (_, j) => k + j); k += n;
    return { index: i, id: st.id, label: st.label, milestone: st.milestone || null, deadline: new Date(deadline).toISOString(), glyphs: ks };
  });
  if (k !== hiddenCount) throw new Error(`schedule reveals ${k} glyphs but ${hiddenCount} are hidden — fix "reveal" counts`);
  // Enforce the hard game length cap (default 24h): the last deadline must not exceed maxGameHours from launch.
  const maxHours = schedule.maxGameHours;
  if (maxHours != null) {
    const lastMs = Date.parse(steps[steps.length - 1].deadline);
    const spanHours = (lastMs - launchMs) / 36e5;
    if (spanHours > maxHours + 1e-6) throw new Error(`schedule runs ${spanHours.toFixed(2)}h but maxGameHours is ${maxHours} — the final deadline must be <= ${maxHours}h after launch`);
  }
  return steps;
}
module.exports = { loadSchedule, resolveSchedule, parseDeadline };
