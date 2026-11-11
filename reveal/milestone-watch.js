#!/usr/bin/env node
/*
 * The Vault Thief — milestone watcher: INSTANT market-cap crossing (no sustained-duration requirement).
 *
 *   node reveal/milestone-watch.js --mint <MINT> [--once] [--interval 120] [--state reveal/milestones-state.json]
 *                                  [--timelocks site/timelocks.json] [--reveal]
 *
 * A milestone step triggers on the FIRST poll where market cap >= its threshold on ANY one reliable source
 * (DexScreener or GeckoTerminal; `minSources`, default 1). Where a source exposes a recent high — GeckoTerminal's
 * OHLCV minute high since the last poll — that high is used, so a brief spike BETWEEN polls still counts. Once a
 * milestone triggers it is PERMANENT and never un-triggers. The source / value / time that tripped it is recorded
 * in milestones-state.json (`evidence`) and shown on the site's reveal history so anyone can check it.
 *
 * Sources: dexscreener, geckoterminal (no key), birdeye (env BIRDEYE_API_KEY), pumpfun (frontend API; often
 * Cloudflare-blocked from servers). Unavailable sources are skipped. Only `reliableSources` can trip a milestone.
 * Milestones only make a reveal EARLIER: every glyph is ALSO time-locked to its deadline (the guaranteed backstop).
 *
 * TRUST NOTE: milestone-early reveals need the creator's secret (this bot or the creator publishes char+salt).
 * If the bot is down, the reveal still happens at the time-lock deadline.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * Pure trigger decision (exported for tests). `highs` maps source -> { high, highAt, spot }.
 * A milestone fires when at least `minSources` of `reliableSources` report a (recent-)high >= threshold.
 * Returns { triggered, source, mcapUsd, at, via, crossed:[...] }.
 */
function evaluateMilestone(highs, threshold, { reliableSources, minSources = 1 }) {
  const crossed = reliableSources
    .filter(s => highs[s] && isFinite(highs[s].high) && highs[s].high >= threshold)
    .map(s => ({ source: s, high: highs[s].high, highAt: highs[s].highAt, spot: highs[s].spot }));
  if (crossed.length < minSources) return { triggered: false, crossed: crossed.map(c => c.source) };
  // Prefer the reliable source with the highest reading as the headline evidence.
  const pick = crossed.slice().sort((a, b) => b.high - a.high)[0];
  const via = pick.spot != null && pick.high > pick.spot * 1.0001 ? 'recent-high' : 'spot';
  const at = via === 'recent-high' && pick.highAt ? new Date(pick.highAt).toISOString() : new Date().toISOString();
  return { triggered: true, source: pick.source, mcapUsd: Math.round(pick.high), at, via, crossed: crossed.map(c => c.source) };
}

module.exports = { evaluateMilestone };

if (require.main !== module) return;

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const MINT = opt('--mint'); if (!MINT) { console.error('missing --mint'); process.exit(1); }
const statePath = path.resolve(opt('--state', path.join(root, 'reveal/milestones-state.json')));
const tl = JSON.parse(fs.readFileSync(path.resolve(opt('--timelocks', path.join(root, 'site/timelocks.json'))), 'utf8'));
const rule = Object.assign(
  { minSources: 1, useRecentHigh: true, reliableSources: ['dexscreener', 'geckoterminal'], sources: ['dexscreener', 'geckoterminal', 'birdeye', 'pumpfun'] },
  tl.milestoneRule || {}
);
const INTERVAL = parseFloat(opt('--interval', '120')) * 1000;

async function getJson(url, headers = {}) {
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 10000);
  try { const r = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: ctl.signal });
        if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } finally { clearTimeout(to); }
}

// Each source returns { mcap, high, highAt } where high >= mcap (high == mcap when no recent-high data is available).
const SOURCES = {
  async dexscreener() {
    const j = await getJson(`https://api.dexscreener.com/latest/dex/tokens/${MINT}`);
    const pairs = (j.pairs || []).filter(p => p.chainId === 'solana' && p.baseToken && p.baseToken.address === MINT);
    if (!pairs.length) throw new Error('no pairs');
    pairs.sort((a, b) => ((b.liquidity || {}).usd || 0) - ((a.liquidity || {}).usd || 0));
    const mcap = Number(pairs[0].marketCap || pairs[0].fdv);
    return { mcap, high: mcap, highAt: Date.now() }; // DexScreener's token endpoint has no OHLCV; spot only.
  },
  async geckoterminal(sinceMs) {
    const t = (await getJson(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${MINT}`)).data.attributes;
    const mcap = Number(t.market_cap_usd || t.fdv_usd);
    const price = Number(t.price_usd);
    let high = mcap, highAt = Date.now();
    if (rule.useRecentHigh && isFinite(price) && price > 0) {
      try {
        const pools = await getJson(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${MINT}/pools?page=1`);
        const pool = pools.data && pools.data[0] && pools.data[0].attributes && pools.data[0].attributes.address;
        if (pool) {
          const o = await getJson(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/minute?aggregate=1&limit=20`);
          const list = (o.data && o.data.attributes && o.data.attributes.ohlcv_list) || [];
          let hp = 0, hts = 0;
          for (const c of list) { const ts = Number(c[0]) * 1000, h = Number(c[2]); if (ts >= (sinceMs || 0) && h > hp) { hp = h; hts = ts; } }
          if (hp > 0) { const implied = mcap * (hp / price); if (implied > high) { high = implied; highAt = hts; } }
        }
      } catch { /* OHLCV optional; fall back to spot */ }
    }
    return { mcap, high, highAt };
  },
  async birdeye() {
    if (!process.env.BIRDEYE_API_KEY) throw new Error('no BIRDEYE_API_KEY');
    const j = await getJson(`https://public-api.birdeye.so/defi/token_overview?address=${MINT}`, { 'X-API-KEY': process.env.BIRDEYE_API_KEY, 'x-chain': 'solana' });
    const mcap = Number(j.data.marketCap || j.data.mc || j.data.fdv);
    return { mcap, high: mcap, highAt: Date.now() };
  },
  async pumpfun() {
    const j = await getJson(`https://frontend-api-v3.pump.fun/coins/${MINT}`);
    const mcap = Number(j.usd_market_cap);
    return { mcap, high: mcap, highAt: Date.now() };
  },
};

const loadState = () => fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { mint: MINT, samples: {}, triggered: {}, evidence: {} };
const saveState = s => fs.writeFileSync(statePath, JSON.stringify(s, null, 2));

async function tick() {
  const st = loadState(); const now = Date.now();
  st.evidence = st.evidence || {};
  const highs = {}; // source -> { high, highAt, spot }
  for (const name of rule.sources) {
    if (!SOURCES[name]) continue;
    const prevSamples = st.samples[name] || [];
    const sinceMs = prevSamples.length ? prevSamples[prevSamples.length - 1].t : now - INTERVAL;
    try {
      const { mcap, high, highAt } = await SOURCES[name](sinceMs);
      if (!isFinite(mcap) || mcap <= 0) throw new Error('bad value');
      (st.samples[name] = st.samples[name] || []).push({ t: now, mcap, high });
      highs[name] = { high: isFinite(high) ? high : mcap, highAt, spot: mcap };
      const hi = highs[name].high > mcap * 1.0001 ? `  (recent high $${Math.round(highs[name].high).toLocaleString()})` : '';
      console.log(`[${new Date(now).toISOString()}] ${name.padEnd(13)} mcap $${Math.round(mcap).toLocaleString()}${hi}`);
    } catch (e) { console.log(`[${new Date(now).toISOString()}] ${name.padEnd(13)} unavailable (${e.message})`); }
    const keep = now - 24 * 36e5; // keep a day of samples, bounded
    if (st.samples[name]) st.samples[name] = st.samples[name].filter(x => x.t >= keep);
  }
  let newly = [];
  for (const step of tl.scheduleSteps) {
    if (!step.milestone || st.triggered[step.id]) continue;
    if (Date.parse(step.deadline) <= now) continue; // time-lock already opened it
    const res = evaluateMilestone(highs, step.milestone.mcapUsd, rule);
    console.log(`  ${step.id.padEnd(8)} >= $${step.milestone.mcapUsd.toLocaleString()} ? ` +
      (res.triggered ? `YES via ${res.source} ($${res.mcapUsd.toLocaleString()}, ${res.via})` : `no (crossed on: ${res.crossed.join(',') || 'none'})`));
    if (res.triggered) {
      st.triggered[step.id] = res.at;
      st.evidence[step.id] = { source: res.source, mcapUsd: res.mcapUsd, at: res.at, via: res.via };
      newly.push(step.id);
    }
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
