(() => {
  const C = window.KEYPUZZLE_CONFIG || {};
  const $ = s => document.querySelector(s);
  const LAMPORTS = 1e9;
  let reveals = null;

  // ---- static config binding
  document.querySelectorAll('[data-bind]').forEach(el => { const v = C[el.dataset.bind]; if (v) el.textContent = v; });
  document.querySelectorAll('[data-link]').forEach(el => { el.href = (C.links || {})[el.dataset.link] || '#'; });
  if (C.tokenName) document.title = `${C.tokenName} — crack the key, take the pot`;
  if (C.contractAddress) { $('#caBox').hidden = false; $('#ca').textContent = C.contractAddress; }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-copy]'); if (!b) return;
    const t = $(b.dataset.copy).textContent;
    navigator.clipboard?.writeText(t).then(() => { b.textContent = 'copied'; setTimeout(() => b.textContent = 'copy', 1200); });
  });

  // ---- reveals.json
  async function loadReveals() {
    if (C.demo && window.KEYPUZZLE_DEMO_REVEALS) { reveals = window.KEYPUZZLE_DEMO_REVEALS; renderReveals(); return; }
    try {
      const r = await fetch(`${C.revealsUrl || 'reveals.json'}?t=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      reveals = await r.json();
      renderReveals();
    } catch (e) {
      $('#key').textContent = 'reveals.json not found — run: node reveal/reveal.js';
    }
  }
  function renderReveals() {
    const p = reveals.puzzle;
    const byPos = {}; (reveals.glyphs || []).forEach(g => { byPos[g.pos] = g; });
    const key = $('#key'); key.innerHTML = '';
    for (let i = 0; i < p.masked.length; i++) {
      const ch = p.masked[i], hidden = ch === '?', g = byPos[i];
      const c = document.createElement('div');
      c.className = hidden ? 'cell hidden' : 'cell';
      c.textContent = hidden ? '•' : ch;
      if (!hidden && g && g.revealed && C.verify !== false && window.KP_verifyGlyph) {
        const ok = window.KP_verifyGlyph(g.pos, g.char, g.salt, g.commitment);
        c.classList.add(ok ? 'verified' : 'badglyph');
        c.title = ok ? `verified: sha256(${g.pos}|${g.char}|salt) matches the launch commitment (${g.revealedBy || 'revealed'})` : 'WARNING: does not match commitment';
      } else if (hidden && g) { c.title = `sealed until ${new Date(g.deadline).toUTCString()} (or earlier on a milestone)`; }
      key.appendChild(c);
    }
    $('#hiddenCount').textContent = p.hiddenCount;
    $('#revealedMeta').textContent = `${p.revealedCount} / ${p.length}`;
    $('#wallet').textContent = reveals.wallet;
    $('#walletLink').href = `https://solscan.io/account/${reveals.wallet}`;
    $('#space').textContent = p.searchSpace;
    $('#bits').textContent = `${p.bitsRemaining} bits` + (p.firstCharHidden ? ' · incl. restricted first glyph' : '');
    const verifiedCount = (reveals.glyphs || []).filter(g => g.revealed).length;
    $('#commit').textContent = `Per-glyph commitments: sha256("pos|char|salt"). ${verifiedCount} revealed glyph(s)` +
      (C.demo ? ' (demo).' : ' verify in your browser.') + (reveals.timelock ? `\nTime-lock: drand ${reveals.timelock.network || 'quicknet'} — every sealed glyph opens at its deadline no matter what.` : '');
    $('#nextLabel').textContent = reveals.final ? 'Vault cracked. Full seed revealed.'
      : (reveals.next ? `Next: ${reveals.next.label}` : 'All glyphs due. Brute-force time.');
    const ol = $('#schedule'); ol.innerHTML = '';
    (reveals.steps || []).forEach((st, i) => {
      const li = document.createElement('li');
      const when = st.deadline ? ` · by ${new Date(st.deadline).toUTCString().replace(':00 GMT', ' UTC')}` : '';
      const extra = st.glyphs > 1 ? ` (${st.glyphs} glyphs)` : '';
      li.textContent = st.label + extra + when;
      li.className = st.done ? 'done' : (i === p.revealsDone ? 'cur' : '');
      if (st.done && st.doneBy) li.title = `revealed by ${st.doneBy}`;
      ol.appendChild(li);
    });
    $('#updated').textContent = `reveals updated ${new Date(reveals.generatedAt).toLocaleString()}`;
    renderWinner();
    renderTriggers();
    tick();
    refreshPot();
    checkSplit();
    loadFeed();
  }

  function renderWinner() {
    const g = reveals.game || {};
    const b = $('#winnerBanner'); if (!b) return;
    if (g.status === 'won') {
      b.hidden = false;
      const w = g.winner || {};
      $('#winnerText').textContent = w.amountSol != null
        ? `The key was reconstructed and ${w.amountSol} SOL was swept.`
        : 'The key was reconstructed and the pot was swept.';
      const link = $('#winnerLink');
      if (w.tx) { link.href = w.solscan || `https://solscan.io/tx/${w.tx}`; link.hidden = false; } else { link.hidden = true; }
      document.body.classList.add('won');
    } else { b.hidden = true; document.body.classList.remove('won'); }
  }

  function renderTriggers() {
    const el = $('#nextTriggers'); if (!el) return;
    const g = reveals.game || {};
    if (g.status === 'won') { el.innerHTML = '<span class="trig win">Game over — full seed revealed below.</span>'; return; }
    const n = reveals.next || {};
    const parts = [];
    if (n.label) parts.push(`<span class="trig"><b>Next</b> ${n.label}</span>`);
    if (n.deadline) parts.push(`<span class="trig"><b>Time-lock deadline</b> ${new Date(n.deadline).toUTCString().replace(':00 GMT',' UTC')}</span>`);
    const nextG = (reveals.glyphs || []).filter(x => !x.revealed).sort((a,b)=>new Date(a.deadline)-new Date(b.deadline))[0];
    if (nextG && nextG.round) parts.push(`<span class="trig"><b>drand round</b> #${nextG.round}</span>`);
    el.innerHTML = parts.join('') || '<span class="trig">All glyphs due — brute-force phase.</span>';
  }

  async function loadFeed() {
    let feed = null;
    if (C.demo && window.KEYPUZZLE_DEMO_FEED) feed = window.KEYPUZZLE_DEMO_FEED;
    else { try { const r = await fetch(`${C.feedUrl || 'feed.json'}?t=${Date.now()}`, { cache: 'no-store' }); if (r.ok) feed = await r.json(); } catch {} }
    const list = $('#feedList'); if (!list) return;
    const evs = (feed && feed.events) || [];
    if (!evs.length) { list.innerHTML = '<li class="feed-empty">No reveals yet.</li>'; return; }
    const icon = { reveal: '🔓', milestone: '📈', endgame: '⏳', win: '🏁' };
    list.innerHTML = '';
    evs.slice(0, 50).forEach(ev => {
      const li = document.createElement('li');
      li.className = `feed-item feed-${ev.type}`;
      const when = ev.ts ? new Date(ev.ts).toUTCString().replace(':00 GMT',' UTC') : '';
      const title = ev.type === 'win' ? 'Vault cracked'
        : ev.type === 'reveal' && ev.pos != null ? `Glyph revealed (pos ${ev.pos})`
        : (ev.label || ev.title || ev.type);
      const by = ev.revealedBy ? ` · ${ev.revealedBy}` : '';
      const verified = ev.verified ? '<span class="feed-ok" title="commitment verified">✓ verified</span>' : '';
      const link = ev.type === 'win' && (ev.solscan || ev.tx) ? ` · <a target="_blank" rel="noopener" href="${ev.solscan || 'https://solscan.io/tx/'+ev.tx}">Solscan ↗</a>` : '';
      li.innerHTML = `<span class="feed-ic">${icon[ev.type]||'•'}</span><span class="feed-body"><b>${title}</b>${verified}<span class="feed-when">${when}${by}${link}</span></span>`;
      list.appendChild(li);
    });
  }

  // ---- countdown
  // Dial: fraction of time remaining until the next glyph (timed steps), or overall progress (milestone steps).
  function setDial(pct, center) {
    $('#dial').style.setProperty('--p', Math.max(0, Math.min(100, pct)).toFixed(2));
    $('#dialCenter').innerHTML = center;
  }
  function tick() {
    const el = $('#countdown'), units = $('#timeUnits');
    if (!reveals) return;
    const p = reveals.puzzle, total = (reveals.steps || []).length || 1;
    const progress = 100 * p.revealsDone / total;
    const showUnits = on => { units.style.visibility = on ? 'visible' : 'hidden'; el.classList.toggle('milestone', !on); };
    if (reveals.final) { el.textContent = 'CRACKED'; showUnits(false); setDial(100, 'OPEN'); return; }
    if (!reveals.next) { el.textContent = 'ALL OUT'; showUnits(false); setDial(100, `${p.hiddenCount}<br>SEALED`); return; }
    
    const target = new Date(reveals.next.deadline).getTime();
    let ms = target - Date.now();
    // window start: previous timed step, else 24h before target
    const prev = (reveals.steps || []).slice(0, p.revealsDone).reverse().find(s => s.deadline);
    const start = prev ? new Date(prev.deadline).getTime() : target - 864e5;
    setDial(100 * Math.max(0, ms) / Math.max(1, target - start), `${p.hiddenCount}<br>SEALED`);
    if (ms <= 0) { el.textContent = 'REVEALING'; showUnits(false); return; }
    if (reveals.next.milestone) $('#nextLabel').innerHTML = `Next: ${reveals.next.label}<br><small>or sooner — latest ${new Date(reveals.next.deadline).toUTCString().replace(':00 GMT',' UTC')}</small>`;
    showUnits(true);
    const pad = n => String(n).padStart(2, '0');
    const sep = '&nbsp;:&nbsp;';
    if (ms >= 100 * 36e5) { // 100h+: show days
      const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4);
      el.innerHTML = `${pad(d)}${sep}${pad(h)}${sep}${pad(m)}`;
      units.innerHTML = '<span>Days</span><span>Hrs</span><span>Min</span>';
    } else {
      const h = Math.floor(ms / 36e5), m = Math.floor(ms % 36e5 / 6e4), sec = Math.floor(ms % 6e4 / 1e3);
      el.innerHTML = `${pad(h)}${sep}${pad(m)}${sep}${pad(sec)}`;
      units.innerHTML = '<span>Hrs</span><span>Min</span><span>Sec</span>';
    }
  }
  setInterval(tick, 1000);

  // ---- Solana RPC (tries endpoints in order; degrades gracefully)
  async function rpc(method, params) {
    let lastErr;
    for (const url of C.rpcEndpoints || []) {
      try {
        const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 8000);
        const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: ctl.signal });
        clearTimeout(to);
        const j = await r.json();
        if (j.error) throw new Error(j.error.message || 'rpc error');
        return { result: j.result, url };
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('no RPC endpoints configured');
  }
  const RENT_ZERO_DATA = 890880; // rent-exempt minimum of a 0-byte account, stays locked in the vault

  async function refreshPot() {
    if (!reveals) return;
    const st = $('#rpcStatus');
    if (C.demo) { // demo mode: no RPC, static sample numbers
      const d = C.demo.pot;
      $('#pot').textContent = (d.wallet + d.bondingCurve + d.pumpSwap).toFixed(3);
      $('#potBreakdown').innerHTML =
        `<div><span>Wallet balance</span><span>${d.wallet.toFixed(4)} SOL</span></div>` +
        `<div><span>Pending fees · bonding-curve vault</span><span>${d.bondingCurve.toFixed(4)} SOL</span></div>` +
        `<div><span>Pending fees · PumpSwap vault</span><span>${d.pumpSwap.toFixed(4)} SOL</span></div>`;
      st.className = 'prize-sub demo'; st.textContent = 'DEMO DATA · sample numbers, no live connection';
      return;
    }
    try {
      const v = reveals.feeSplit || {}; // fee-shared coin: pending fees wait in vaults keyed by sharing_config
      const [w, bc, amm] = await Promise.all([
        rpc('getBalance', [reveals.wallet]),
        v.bondingCurveVault ? rpc('getBalance', [v.bondingCurveVault]) : null,
        v.ammVaultWsolAta ? rpc('getTokenAccountBalance', [v.ammVaultWsolAta]).catch(() => null) : null,
      ]);
      const walletSol = w.result.value / LAMPORTS;
      const bcSol = bc ? Math.max(0, bc.result.value - RENT_ZERO_DATA) / LAMPORTS : 0;
      const ammSol = amm && amm.result ? Number(amm.result.value.uiAmount || 0) : 0;
      const total = walletSol + bcSol + ammSol;
      const potEl = $('#pot'), txt = total.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
      if (potEl.textContent !== txt && potEl.textContent !== '…') { potEl.classList.remove('pulse'); void potEl.offsetWidth; potEl.classList.add('pulse'); }
      potEl.textContent = txt;
      $('#potBreakdown').innerHTML =
        `<div><span>Wallet balance</span><span>${walletSol.toFixed(4)} SOL</span></div>` +
        `<div><span>Pending fees · bonding-curve vault</span><span>${bcSol.toFixed(4)} SOL</span></div>` +
        `<div><span>Pending fees · PumpSwap vault</span><span>${ammSol.toFixed(4)} SOL</span></div>`;
      if (!reveals.feeSplit) $('#potBreakdown').innerHTML += '<div><span>Fee vaults appear once the token mint is set</span><span>—</span></div>';
      st.className = 'prize-sub';
      st.textContent = `Grows with every trade · live from ${new URL(w.url).host} · ${new Date().toLocaleTimeString()}`;
    } catch (e) {
      st.className = 'prize-sub err';
      st.innerHTML = `Couldn't reach Solana RPC. <a href="https://solscan.io/account/${reveals.wallet}" target="_blank" rel="noopener">Check the wallet on Solscan →</a>`;
      console.warn('RPC error', e);
      if ($('#pot').textContent === '…') $('#pot').textContent = '—';
      $('#potBreakdown').innerHTML = '<div><span>Live balances unavailable right now</span><span>—</span></div>';
    }
  }

  // ---- live check of the pump.fun fee split (sharing_config)
  async function checkSplit() {
    const box = $('#lock'), title = $('#splitTitle'), rows = $('#splitRows');
    const fs = reveals && reveals.feeSplit;
    $('#splitTx').href = C.feeSplitProofTx || '#';
    if (!C.feeSplitProofTx) $('#splitTx').textContent = 'fee-split transaction (link added after launch)';
    if (!fs) {
      box.className = 'card lock'; title.textContent = 'Fee split: set after launch';
      rows.innerHTML = '<div><span>Token mint</span><span>not launched yet</span></div>';
      $('#splitAcct').removeAttribute('href'); return;
    }
    $('#splitAcct').href = `https://solscan.io/account/${fs.sharingConfig}`;
    const row = (label, cls, val) => `<div><span>${label}</span><span class="${cls}">${val}</span></div>`;
    if (C.demo) {
      $('#splitAcct').removeAttribute('href'); $('#splitAcct').textContent = 'sharing_config account (shown after launch)';
      box.className = 'card lock ok'; title.textContent = 'LOCKED · 100% of creator fees → vault wallet (DEMO)';
      const w = reveals.wallet;
      rows.innerHTML = row('Recipients', 'pass', `${w.slice(0, 4)}…${w.slice(-4)} 100%`) +
        row('Admin revoked', 'pass', 'yes, split can never be edited') + row('Status', 'pass', 'Active') +
        row('Data source', 'unk', 'demo sample, not read from chain');
      return;
    }
    try {
      const { result } = await rpc('getAccountInfo', [fs.sharingConfig, { encoding: 'base64' }]);
      if (!result.value) { box.className = 'card lock bad'; title.textContent = 'Fee split NOT set yet'; rows.innerHTML = row('sharing_config', 'fail', 'account not found'); return; }
      const cfg = window.KP_decodeSharingConfig(result.value.data[0]);
      const sh = cfg.shareholders;
      const toVault = sh.length === 1 && sh[0].address === reveals.wallet && sh[0].shareBps === 10000;
      const locked = cfg.adminRevoked && !cfg.editable;
      const ok = toVault && locked && cfg.mint === fs.mint;
      box.className = 'card lock ' + (ok ? 'ok' : 'bad');
      title.textContent = ok ? 'LOCKED · 100% of creator fees → vault wallet' : 'Fee split does not match the vault wallet';
      rows.innerHTML =
        row('Recipients', toVault ? 'pass' : 'fail', sh.map(s => `${s.address.slice(0, 4)}…${s.address.slice(-4)} ${s.shareBps / 100}%`).join(', ') || 'none') +
        row('Admin revoked', locked ? 'pass' : 'fail', locked ? 'yes, split can never be edited' : 'NO, still editable') +
        row('Status', cfg.status === 'Active' ? 'pass' : 'unk', cfg.status);
    } catch (e) {
      box.className = 'card lock'; title.textContent = 'Fee split: could not reach Solana RPC';
      rows.innerHTML = row('Check manually', 'unk', `<a href="https://solscan.io/account/${fs.sharingConfig}" target="_blank" rel="noopener">Solscan →</a>`);
    }
  }

  loadReveals();
  if (!C.demo) setInterval(loadReveals, (C.refreshSeconds || 30) * 1000);
})();
