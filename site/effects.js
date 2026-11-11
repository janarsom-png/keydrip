/* The Vault Thief — effects engine. Canvas particles (capped) + CSS state toggles. Lightweight, pauses when
   the tab is hidden, and goes still under prefers-reduced-motion. Also the single source of truth that diffs
   reveals.json and emits `vault:fx` events the crew (thieves.js) reacts to. */
(() => {
  const stage = document.getElementById('vaultStage');
  const canvas = document.getElementById('fxCanvas');
  const vault = document.getElementById('vault');
  if (!stage || !canvas) return;
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MAX = 220;
  let P = [], dpr = 1, running = false, raf = 0;

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = stage.getBoundingClientRect();
    canvas.width = Math.max(1, r.width * dpr); canvas.height = Math.max(1, r.height * dpr);
    canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize); resize();

  // center of the vault, in stage coordinates
  function center() {
    const s = stage.getBoundingClientRect(), v = (vault || stage).getBoundingClientRect();
    return { x: v.left - s.left + v.width / 2, y: v.top - s.top + v.height / 2, r: v.width / 2 };
  }
  const add = p => { if (P.length < MAX) P.push(p); };
  const rnd = (a, b) => a + Math.random() * (b - a);

  function sparks(x, y, n, hue) {
    for (let i = 0; i < n; i++) { const a = rnd(0, Math.PI * 2), sp = rnd(1.5, 5.5);
      add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, life: 1, decay: rnd(.02, .05), g: .18, size: rnd(1, 2.4),
        c: hue || `hsl(${rnd(38, 50)},100%,${rnd(60, 80)}%)`, type: 'spark' }); }
  }
  function coins(x, y, n) {
    for (let i = 0; i < n; i++) { const a = rnd(-Math.PI, 0), sp = rnd(3, 8);
      add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, decay: rnd(.008, .018), g: .22, size: rnd(3, 6),
        c: Math.random() < .5 ? '#F5D76E' : '#D4AF37', type: 'coin', spin: rnd(0, 6), vs: rnd(-.3, .3) }); }
  }
  function dust(x, y, n) {
    for (let i = 0; i < n; i++) { const a = rnd(0, Math.PI * 2), sp = rnd(.4, 2.2);
      add({ x, y: y + rnd(-10, 10), vx: Math.cos(a) * sp, vy: -Math.abs(Math.sin(a)) * sp - .4, life: 1, decay: rnd(.01, .02), g: -.02, size: rnd(6, 16),
        c: 'rgba(150,140,120,', type: 'dust' }); }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of P) {
      p.vy += p.g; p.x += p.vx; p.y += p.vy; p.life -= p.decay;
      if (p.type === 'coin') {
        p.spin += p.vs; ctx.save(); ctx.translate(p.x, p.y); ctx.scale(Math.cos(p.spin), 1); ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.c; ctx.beginPath(); ctx.ellipse(0, 0, p.size, p.size, 0, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha *= .6; ctx.fillStyle = '#8A6E2F'; ctx.beginPath(); ctx.ellipse(0, 0, p.size * .5, p.size * .7, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      } else if (p.type === 'dust') {
        ctx.globalAlpha = Math.max(0, p.life) * .4; ctx.fillStyle = p.c + (p.life * .4).toFixed(2) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.6 - p.life), 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.c; ctx.shadowColor = p.c; ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      }
    }
    ctx.globalAlpha = 1;
    P = P.filter(p => p.life > 0 && p.y < canvas.height / dpr + 40);
  }

  // ambient drilling sparks from a point on the safe rim (where a thief is working)
  let ambientT = 0;
  function loop() {
    if (!running) return;
    if (!document.hidden) {
      ambientT++;
      if (!reduce && ambientT % 10 === 0 && P.length < MAX - 20) {
        const c = center(), a = rnd(0, Math.PI * 2); sparks(c.x + Math.cos(a) * c.r * .7, c.y + Math.sin(a) * c.r * .7, 3);
      }
      draw();
    }
    raf = requestAnimationFrame(loop);
  }
  function start() { if (!running) { running = true; raf = requestAnimationFrame(loop); } }
  function stop() { running = false; cancelAnimationFrame(raf); }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });

  function flash() { stage.classList.add('alarm'); setTimeout(() => stage.classList.remove('alarm'), 700); }
  function shake() { if (vault) { vault.classList.remove('shake'); void vault.offsetWidth; vault.classList.add('shake'); } }

  function fx(kind) {
    const c = center();
    dispatchEvent(new CustomEvent('vault:fx', { detail: { kind } }));
    if (reduce) { flash(); return; }
    if (kind === 'reveal') { coins(c.x, c.y, 16); sparks(c.x, c.y, 10); flash(); }
    else if (kind === 'milestone') { shake(); dust(c.x, c.y + c.r * .6, 14); coins(c.x, c.y, 10); flash(); }
    else if (kind === 'endgame') { coins(c.x, c.y, 12); dust(c.x, c.y + c.r * .6, 8); flash(); }
    else if (kind === 'win') winSequence();
  }

  function winSequence() {
    const c = center();
    flash();
    let burst = 0; const iv = setInterval(() => { coins(c.x, c.y, 24); sparks(c.x, c.y, 8); if (++burst > 10) clearInterval(iv); }, 160);
    let overlay = document.getElementById('crackedOverlay');
    if (!overlay) { overlay = document.createElement('div'); overlay.id = 'crackedOverlay'; overlay.innerHTML = '<div class="co-text">VAULT CRACKED</div><div class="co-sub">the thief got away with it</div>'; stage.appendChild(overlay); }
    overlay.classList.add('show');
  }

  // ---- diff authority: compare reveals.json across refreshes and fire effects for real changes only
  let baseline = null, wonFired = false;
  addEventListener('vault:reveals', e => {
    const r = e.detail; if (!r || !r.glyphs) return;
    const revealedNow = r.glyphs.filter(g => g.revealed);
    if (baseline === null) { baseline = new Set(revealedNow.map(g => g.k));
      if ((r.game || {}).status === 'won') { wonFired = true; fx('win'); } return; }
    for (const g of revealedNow) {
      if (baseline.has(g.k)) continue;
      baseline.add(g.k);
      const kind = g.revealedBy === 'milestone' ? 'milestone' : (/drip|final/.test(g.step || '') ? 'endgame' : 'reveal');
      fx(kind);
    }
    if ((r.game || {}).status === 'won' && !wonFired) { wonFired = true; fx('win'); }
  });

  // demo helper so screenshots/offline previews can trigger a sequence without live data
  window.KP_fx = fx;
  start();
})();
