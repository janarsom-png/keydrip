/* The Vault Thief — animated crew around the safe. Pure SVG/CSS/JS. No external/copyrighted assets.
   Respects prefers-reduced-motion, thins out on mobile, and ships a pluggable live-presence hook that is
   OFF by default (GitHub Pages is static; a true per-visitor count needs a realtime backend — see README). */
(() => {
  const C = window.KEYPUZZLE_CONFIG || {};
  const layer = document.getElementById('thiefLayer');
  const caption = document.getElementById('crewCount');
  if (!layer) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mobile = matchMedia('(max-width: 760px)').matches;

  const TOOLS = ['drill', 'stethoscope', 'crowbar', 'laptop', 'lockpick'];
  const GAGS = { drill: 'bit snapped!', stethoscope: 'wrong click', crowbar: 'it bent!', laptop: 'access denied', lockpick: 'pick slipped' };

  // One compact hooded-thief sprite. `tool` swaps the thing in its hands.
  function sprite(tool) {
    const tools = {
      drill: '<g class="tool drill"><rect x="40" y="40" width="20" height="9" rx="2" fill="#2A2926" stroke="#8A6E2F"/><rect x="58" y="42" width="12" height="5" rx="1" fill="#C9A227"/><rect x="34" y="43" width="7" height="12" rx="2" fill="#17150f"/><g class="bit"><rect x="69" y="43" width="10" height="3" rx="1" fill="#D4AF37"/></g></g>',
      stethoscope: '<g class="tool steth"><circle cx="60" cy="48" r="6" fill="#2A2926" stroke="#D4AF37"/><path d="M40 40 Q52 34 58 44" fill="none" stroke="#C9A227" stroke-width="2"/></g>',
      crowbar: '<g class="tool crow"><rect x="40" y="30" width="5" height="26" rx="2" fill="#C9A227" transform="rotate(32 42 43)"/><path d="M54 24 q8 0 7 8" fill="none" stroke="#C9A227" stroke-width="5"/></g>',
      laptop: '<g class="tool laptop"><rect x="42" y="44" width="22" height="13" rx="1.5" fill="#17150f" stroke="#8A6E2F"/><rect x="44" y="34" width="18" height="12" rx="1.5" fill="#1b2a22" stroke="#3D9A5F"/><rect class="scan" x="45" y="36" width="16" height="2" fill="#3D9A5F" opacity=".8"/></g>',
      lockpick: '<g class="tool pick"><rect x="42" y="44" width="16" height="3" rx="1" fill="#C9A227" transform="rotate(-18 50 45)"/><rect x="44" y="48" width="12" height="2.5" rx="1" fill="#8A6E2F"/></g>',
    };
    return `<svg viewBox="0 0 88 96" width="100%" height="100%">
      <ellipse cx="38" cy="90" rx="22" ry="5" fill="rgba(0,0,0,.45)"/>
      <g class="legs"><rect x="28" y="66" width="8" height="22" rx="3" fill="#14120E"/><rect x="40" y="66" width="8" height="22" rx="3" fill="#1A1712"/></g>
      <rect class="torso" x="22" y="36" width="34" height="38" rx="12" fill="#1A1712" stroke="#2A2926"/>
      <circle cx="39" cy="24" r="15" fill="#14120E"/>
      <path d="M24 24 a15 15 0 0 1 30 0 l-4 0 a11 11 0 0 0 -22 0 z" fill="#0b0a08"/>
      <ellipse cx="40" cy="28" rx="10" ry="9" fill="#C4B496"/>
      <rect x="30" y="24" width="20" height="6" rx="3" fill="#0b0a08"/>
      <circle cx="37" cy="27" r="1.6" fill="#F5D76E"/><circle cx="45" cy="27" r="1.6" fill="#F5D76E"/>
      <g class="arm">${tools[tool] || tools.lockpick}</g>
    </svg>`;
  }

  // positions around the vault (percent of the thief-layer box). Hand-tuned to ring the safe.
  const SPOTS = [
    { l: 2,  t: 38, flip: 1 }, { l: 78, t: 36, flip: -1 }, { l: 12, t: 66, flip: 1 },
    { l: 70, t: 68, flip: -1 }, { l: 40, t: 74, flip: 1 }, { l: 30, t: 20, flip: 1 }, { l: 60, t: 18, flip: -1 },
  ];

  function makeThief(spot, tool, label, isYou) {
    const el = document.createElement('div');
    el.className = 'thief' + (isYou ? ' you' : '');
    el.dataset.tool = tool;
    el.style.left = spot.l + '%';
    el.style.top = spot.t + '%';
    el.style.setProperty('--flip', spot.flip);
    el.style.setProperty('--delay', (Math.random() * 2).toFixed(2) + 's');
    el.innerHTML = `<div class="thief-body">${sprite(tool)}</div><div class="thief-tag">${label}</div>`;
    if (!reduce) {
      el.classList.add('walk-in');
      el.addEventListener('animationend', e => { if (e.animationName === 'thiefWalkIn') el.classList.remove('walk-in'); }, { once: true });
    }
    return el;
  }

  let thieves = [];
  function build(count) {
    layer.innerHTML = ''; thieves = [];
    const n = Math.max(1, Math.min(count, SPOTS.length));
    // the visitor's own thief first (labelled "you"), then ambient crew with varied tools
    const order = [{ you: true, tool: 'drill', label: 'you' }];
    for (let i = 1; i < n; i++) order.push({ you: false, tool: TOOLS[i % TOOLS.length], label: 'thief' });
    order.forEach((o, i) => { const el = makeThief(SPOTS[i], o.tool, o.label, o.you); layer.appendChild(el); thieves.push(el); });
    if (caption) caption.textContent = n <= 1 ? 'you are working the safe' : `a crew of ${n} thieves is working the safe`;
  }

  // occasional failure gag: a thief recoils and a tiny "fail" bubble pops
  function startGags() {
    if (reduce) return;
    setInterval(() => {
      if (!thieves.length || document.hidden) return;
      const el = thieves[Math.floor(Math.random() * thieves.length)];
      if (el.classList.contains('fail')) return;
      el.classList.add('fail');
      const b = document.createElement('div'); b.className = 'thief-fail'; b.textContent = GAGS[el.dataset.tool] || 'nope';
      el.appendChild(b);
      setTimeout(() => { el.classList.remove('fail'); b.remove(); }, 1500);
    }, 4200 + Math.random() * 2600);
  }

  // react to vault events (fired by effects.js): brief cheer; big celebrate on a win
  addEventListener('vault:fx', e => {
    const k = e.detail && e.detail.kind;
    if (reduce) return;
    if (k === 'win') { thieves.forEach(t => t.classList.add('celebrate')); if (caption) caption.textContent = 'the vault is cracked'; return; }
    if (k === 'reveal' || k === 'milestone' || k === 'endgame') {
      const el = thieves[Math.floor(Math.random() * thieves.length)]; if (el) { el.classList.add('cheer'); setTimeout(() => el.classList.remove('cheer'), 900); }
    }
  });

  // ---- pluggable live presence (OFF by default). When enabled with an endpoint, set the crew size from
  // live peers. Disabled => ambient fallback count. We never sign up for or call anything by default.
  function startPresence() {
    const p = C.presence || {};
    const ambient = mobile ? 2 : 4;
    if (!p.enabled || !p.endpoint) { build(ambient); return; }
    build(ambient); // show ambient immediately, then upgrade if the socket connects
    try {
      const ws = new WebSocket(p.endpoint);
      ws.addEventListener('message', ev => {
        let n = parseInt(ev.data, 10); if (!isNaN(ev.data)) n = +ev.data;
        try { const j = JSON.parse(ev.data); if (j && typeof j.count === 'number') n = j.count; } catch {}
        if (Number.isFinite(n)) build(Math.max(1, Math.min(n, mobile ? 3 : SPOTS.length)));
      });
    } catch {}
  }

  startPresence();
  startGags();
})();
