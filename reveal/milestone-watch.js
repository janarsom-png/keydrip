#!/usr/bin/env node
/*
 * KeyPuzzle — milestone watcher: "sustained market cap", from >= 2 independent sources.
 *
 *   node reveal/milestone-watch.js --mint <MINT> [--once] [--interval 120] [--state reveal/milestones-state.json]
 *                                  [--timelocks site/timelocks.json] [--reveal]
 *
 * A milestone step triggers only when, on at least `minSources` sources, EVERY sample in the last `windowMinutes`
 * (default 60) is >= the threshold, the samples cover the whole window, and no gap between samples exceeds
 * `maxGapMinutes`. One wash-traded bundle or a single spike can't do it: it has to hold for an hour on two feeds.
 * (Requiring every sample to stay above the threshold is stricter than an hour-long TWAP.)
 *
 * Sources: dexscreener, geckoterminal (no key), birdeye (env BIRDEYE_API_KEY), pumpfun (frontend API; often
 * Cloudflare-blocked from servers). Unavailable sources are skipped, but minSources still has to be met.
 * Triggers are appended to the state file; reveal/reveal.js reads it automatically. With --reveal it also
 * rebuilds site/reveals.json (deploying it is up to you). Milestones only make a reveal EARLIER: every glyph is
 * also time-locked to its deadline.
 *
 * TRUST NOTE: milestone-early reveals need the creator's secret (this bot or the creator publishes char+salt).
 * If the bot is down, the reveal still happens at the time-lock deadline.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const MINT = opt('--mint'); if (!MINT) { console.error('missing --mint'); process.exit(1); }
const statePath = path.resolve(opt('--state', path.join(root, 'reveal/milestones-state.json')));
const tl = JSON.parse(fs.readFileSync(path.resolve(opt('--timelocks', path.join(root, 'site/timelocks.json'))), 'utf8'));
const rule = Object.assign({ windowMinutes: 60, minSources: 2, maxGapMinutes: 10, sources: ['dexscreener', 'birdeye', 'geckoterminal', 'pumpfun'] }, tl.milestoneRule || {});
if (opt('--window-minutes')) rule.windowMinutes = parseFloat(opt('--window-minutes'));   // testing only
if (opt('--max-gap-minutes')) rule.maxGapMinutes = parseFloat(opt('--max-gap-minutes')); // testing only
const INTERVAL = parseFloat(opt('--interval', '120')) * 1000;

async function getJson(url, headers = {}) {
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 10000);
  try { const r = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: ctl.signal });
        if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } finally { clearTimeout(to); }
}
const SOURCES = {
  async dexscreener() {
    const j = await getJson(`https://api.dexscreener.com/latest/dex/tokens/${MINT}`);
    const pairs = (j.pairs || []).filter(p => p.chainId === 'solana' && p.baseToken && p.baseToken.address === MINT);
    if (!pairs.length) throw new Error('no pairs');
    pairs.sort((a, b) => ((b.liquidity || {}).usd || 0) - ((a.liquidity || {}).usd || 0));
    return Number(pairs[0].marketCap || pairs[0].fdv);
  },
  async geckoterminal() {
    const a = (await getJson(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${MINT}`)).data.attributes;
    return Number(a.market_cap_usd || a.fdv_usd);
  },
  async birdeye() {
    if (!process.env.BIRDEYE_API_KEY) throw new Error('no BIRDEYE_API_KEY');
    const j = await getJson(`https://public-api.birdeye.so/defi/token_overview?address=${MINT}`, { 'X-API-KEY': process.env.BIRDEYE_API_KEY, 'x-chain': 'solana' });
    return Number(j.data.marketCap || j.data.mc || j.data.fdv);
  },
  async pumpfun() {
    const j = await getJson(`https://frontend-api-v3.pump.fun/coins/${MINT}`);
    return Number(j.usd_market_cap);
  },
};

const loadState = () => fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { mint: MINT, samples: {}, triggered: {} };
const saveState = s => fs.writeFileSync(statePath, JSON.stringify(s, null, 2));

function sustained(samples, threshold, now) {
  const W = rule.windowMinutes * 6e4, G = rule.maxGapMinutes * 6e4;
  const inWin = samples.filter(x => x.t >= now - W - G);  // include one sample before the window start
  if (!inWin.length) return { ok: false, why: 'no samples' };
  if (inWin[0].t > now - W) return { ok: false, why: `history ${(Math.max(0, now - inWin[0].t) / 6e4).toFixed(1)}/${rule.windowMinutes} min` };
  if (now - inWin[inWin.length - 1].t > G) return { ok: false, why: 'stale' };
  for (let i = 1; i < inWin.length; i++) if (inWin[i].t - inWin[i - 1].t > G) return { ok: false, why: 'gap in data' };
  const min = Math.min(...inWin.map(x => x.mcap));
  return { ok: min >= threshold, why: `min ${Math.round(min).toLocaleString()} vs ${threshold.toLocaleString()}` };
}

async function tick() {
  const st = loadState(); const now = Date.now();
  for (const name of rule.sources) {
    if (!SOURCES[name]) continue;
    try {
      const mcap = await SOURCES[name]();
      if (!isFinite(mcap) || mcap <= 0) throw new Error('bad value');
      (st.samples[name] = st.samples[name] || []).push({ t: now, mcap });
      console.log(`[${new Date(now).toISOString()}] ${name.padEnd(13)} mcap $${Math.round(mcap).toLocaleString()}`);
    } catch (e) { console.log(`[${new Date(now).toISOString()}] ${name.padEnd(13)} unavailable (${e.message})`); }
    const keep = now - 3 * rule.windowMinutes * 6e4;
    if (st.samples[name]) st.samples[name] = st.samples[name].filter(x => x.t >= keep);
  }
  let newly = [];
  for (const step of tl.scheduleSteps) {
    if (!step.milestone || st.triggered[step.id]) continue;
    if (Date.parse(step.deadline) <= now) continue; // time-lock already opened it
    const res = Object.entries(st.samples).map(([src, s]) => [src, sustained(s, step.milestone.mcapUsd, now)]);
    const okSources = res.filter(([, r]) => r.ok).map(([s]) => s);
    console.log(`  ${step.id.padEnd(8)} ${okSources.length}/${rule.minSources} sources sustained  ` + res.map(([s, r]) => `${s}:${r.ok ? 'OK' : r.why}`).join('  '));
    if (okSources.length >= rule.minSources) { st.triggered[step.id] = new Date(now).toISOString(); st.evidence = st.evidence || {}; st.evidence[step.id] = { sources: okSources, windowMinutes: rule.windowMinutes }; newly.push(step.id); }
  }
  saveState(st);
  if (newly.length) {
    console.log(`MILESTONE TRIGGERED: ${newly.join(', ')}`);
    if (args.includes('--reveal')) {
      execFileSync(process.execPath, [path.join(root, 'reveal/reveal.js'), '--mint', MINT, '--state', statePath], { stdio: 'inherit' });
      console.log('reveals.json rebuilt — deploy site/ to publish.');
    }
  }
}
(async () => {
  await tick();
  if (args.includes('--once')) return;
  setInterval(() => tick().catch(e => console.error(e)), INTERVAL);
})();
