#!/usr/bin/env python3
"""Build demo.html: one self-contained file (inline CSS/JS/config/demo data, base64 images). No live RPC."""
import base64, io, json, os, random, re
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, 'site')
rd = lambda p: open(os.path.join(SITE, p), encoding='utf-8').read()

def data_uri(img, fmt, **kw):
    buf = io.BytesIO(); img.save(buf, fmt, **kw)
    return f"data:image/{fmt.lower()};base64," + base64.b64encode(buf.getvalue()).decode(), len(buf.getvalue())

logo = Image.open(os.path.join(SITE, 'assets/logo-vault-keyhole-512.png')).convert('RGBA').resize((256, 256), Image.LANCZOS)
logo_uri, logo_sz = data_uri(logo, 'PNG', optimize=True)
if logo_sz > 60000:  # fall back to webp if the png is still heavy
    logo_uri, logo_sz = data_uri(logo, 'WEBP', quality=85)
banner = Image.open(os.path.join(SITE, 'assets/banner-header.png')).convert('RGB').resize((1200, 400), Image.LANCZOS)
q = 80
while True:
    banner_uri, banner_sz = data_uri(banner, 'JPEG', quality=q, optimize=True, progressive=True)
    if banner_sz <= 150_000 or q <= 40: break
    q -= 5
print(f'logo {logo_sz/1024:.0f} KB, banner {banner_sz/1024:.0f} KB (q={q})')

# Fake demo puzzle: random base58 string, NOT any real key.
A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
rng = random.Random(1337)
fake = ''.join(rng.choice(A) for _ in range(44))
hidden = sorted(rng.sample(range(1, 44), 8) + [0])
masked = ''.join('?' if i in hidden else c for i, c in enumerate(fake))
fake_wallet = 'Th1ef' + ''.join(rng.choice(A) for _ in range(37))
steps_def = [
    ('mc-50k', 'Sustained $50k market cap', 50000, 1), ('mc-100k', 'Sustained $100k market cap', 100000, 2),
    ('mc-250k', 'Sustained $250k market cap', 250000, 3), ('mc-500k', 'Sustained $500k market cap', 500000, 4),
    ('mc-1m', 'Sustained $1M market cap', 1000000, 5), ('drip-1', 'Endgame drip 9 → 8', None, 12),
    ('drip-2', 'Endgame drip 8 → 7', None, 19), ('drip-3', 'Endgame drip 7 → 6', None, 26),
    ('final', 'Season end: all remaining glyphs', None, 40),
]
reveal_counts = [1,1,1,1,1,1,1,1,6]
done = 3  # first 3 steps done
# assign glyph k indices to steps
kk = 0; stepmap = []
for (sid,lab,mc,dd), rc in zip(steps_def, reveal_counts):
    ks = list(range(kk, kk+rc)); kk += rc
    stepmap.append((sid,lab,mc,dd,ks))
hidden_positions = sorted(rng.sample(range(1,44), 13) + [0])
# demo glyph records
import hashlib
glyphs = []
for (sid,lab,mc,dd,ks) in stepmap:
    for k in ks:
        pos = hidden_positions[k] if k < len(hidden_positions) else hidden_positions[-1]
dummy = None
glyph_list = []
for n,(sid,lab,mc,dd,ks) in enumerate(stepmap):
    for k in ks:
        pos = hidden_positions[k]
        ch = fake[pos]; salt = ''.join(rng.choice('0123456789abcdef') for _ in range(32))
        commit = hashlib.sha256(f"{pos}|{ch}|{salt}".encode()).hexdigest()
        revealed = n < done
        g = {'k':k,'pos':pos,'commitment':commit,'step':sid,'deadline':None,'round':0,'revealed':revealed}
        if revealed: g.update({'char':ch,'salt':salt,'revealedBy':'milestone' if mc else 'timelock','revealedAt':None})
        glyph_list.append(g)
revealed_pos = {g['pos'] for g in glyph_list if g['revealed']}
masked = ''.join(c if (i not in hidden_positions or i in revealed_pos) else '?' for i,c in enumerate(fake))
hidden_now = [p for p in hidden_positions if p not in revealed_pos]
first_hidden = 0 in hidden_now
space = (17 if first_hidden else 1)
for p in hidden_now:
    if p != 0: space *= 58
import math
demo = {
    'version': 2, 'generatedAt': None, 'wallet': fake_wallet,
    'feeSplit': {'mint': 'DEMO', 'sharingConfig': 'DEMO'},
    'puzzle': {'encoding': 'base58 of the 32-byte ed25519 seed (exactly 44 chars)', 'masked': masked, 'length': 44,
               'hiddenCount': len(hidden_now), 'revealedCount': 44-len(hidden_now), 'revealsDone': done,
               'firstCharHidden': first_hidden, 'bitsRemaining': round(math.log2(space),1),
               'searchSpace': (f"17 × 58^{len(hidden_now)-1}" if first_hidden else f"58^{len(hidden_now)}") + f" ≈ {space:.2e}",
               'expectedTries': space/2},
    'glyphs': glyph_list,
    'steps': [{'id':sid,'label':lab,'milestone':({'mcapUsd':mc} if mc else None),'deadline':None,'glyphs':len(ks),
               'done': n<done, 'doneBy': ('milestone' if n<done and mc else ('timelock' if n<done else None))} for n,(sid,lab,mc,dd,ks) in enumerate(stepmap)],
    'next': {'id':stepmap[done][0],'label':stepmap[done][1],'deadline':None,'milestone':({'mcapUsd':stepmap[done][2]} if stepmap[done][2] else None)},
    'milestoneRule': {'windowMinutes':60,'minSources':2,'maxGapMinutes':10,'sources':['dexscreener','birdeye','geckoterminal','pumpfun']},
    'timelock': {'network':'quicknet (League of Entropy)','chainHash':'DEMO','format':'drand tlock'},
    'commitmentScheme': 'sha256("<pos>|<char>|<salt>")', 'final': False,
}
config = """window.KEYPUZZLE_CONFIG = {
  tokenName: 'The Vault Thief', ticker: '$THIEF', contractAddress: '',
  feeSplitProofTx: '',
  links: { pumpfun: 'https://pump.fun/', x: 'https://x.com/', telegram: 'https://t.me/' },
  rpcEndpoints: [], revealsUrl: '', refreshSeconds: 30,
  verify: true, demo: { pot: { wallet: 9.6120, bondingCurve: 2.4115, pumpSwap: 0.8165 } }
};"""
demo_js = "window.KEYPUZZLE_DEMO_REVEALS = " + json.dumps(demo, ensure_ascii=False) + """;
(function () {
  const r = window.KEYPUZZLE_DEMO_REVEALS, now = Date.now();
  r.generatedAt = new Date(now).toISOString();
  const ds = [-20, 4, 28, 52, 76, 100, 268, 436, 700]; // hours from now per step (first 3 already past)
  r.steps.forEach((s, i) => { s.deadline = new Date(now + ds[i] * 3600e3).toISOString(); });
  r.glyphs.forEach(g => { const st = r.steps.find(s => s.id === g.step); if (st) g.deadline = st.deadline; });
  const nx = r.steps[r.puzzle.revealsDone]; if (nx) { r.next.deadline = nx.deadline; }
})();"""
# Demo feed: one event per already-revealed glyph (winner-less live state).
_rev = [g for g in glyph_list if g['revealed']]
_labels = {sid: lab for (sid, lab, mc, dd, ks) in stepmap}
demo_feed_events = []
for i, g in enumerate(_rev):
    demo_feed_events.append({
        'id': f"milestone-glyph-{g['k']}", 'type': 'milestone', 'ref': f"glyph-{g['k']}",
        'pos': g['pos'], 'char': g['char'], 'label': _labels.get(g['step']), 'revealedBy': g.get('revealedBy'),
        'verified': True, 'title': _labels.get(g['step']),
    })
demo_feed = {'tokenName': 'The Vault Thief', 'ticker': '$THIEF', 'events': demo_feed_events, 'game': {'status': 'live', 'winner': None}}
feed_js = ("window.KEYPUZZLE_DEMO_FEED = " + json.dumps(demo_feed, ensure_ascii=False) + ";\n"
  "(function(){var f=window.KEYPUZZLE_DEMO_FEED,now=Date.now();"
  "f.events.forEach(function(e,i){e.ts=new Date(now-(i+1)*7*3600e3).toISOString();});"
  "f.updatedAt=new Date(now).toISOString();})();")

html = rd('index.html')
css = rd('style.css').replace('url("assets/banner-header.png")', f'url("{banner_uri}")')
app = rd('app.js')
sharingjs = rd('sharing.js')
verifyjs = rd('verify.js')
thievesjs = rd('thieves.js')
effectsjs = rd('effects.js')
html = html.replace('<link rel="stylesheet" href="style.css">', f'<style>\n{css}\n</style>')
html = html.replace('assets/logo-vault-keyhole-512.png', logo_uri)
html = html.replace('<meta property="og:image" content="assets/banner-header.png">', '')
html = re.sub(r'<script src="config.js"></script>\s*<script src="sharing.js"></script>\s*<script src="verify.js"></script>\s*<script src="app.js"></script>\s*<script src="thieves.js"></script>\s*<script src="effects.js"></script>',
              lambda m: f'<script>\n{config}\n</script>\n<script>\n{sharingjs}\n</script>\n<script>\n{verifyjs}\n</script>\n<script>\n{demo_js}\n</script>\n<script>\n{feed_js}\n</script>\n<script>\n{app}\n</script>\n<script>\n{thievesjs}\n</script>\n<script>\n{effectsjs}\n</script>', html)
html = html.replace('<title>The Vault Thief — $THIEF · crack the safe, sweep the vault</title>', '<title>The Vault Thief (DEMO) — crack the safe, sweep the vault</title>')
html = html.replace('<h1>Crack the safe.<br>Sweep the vault.</h1>', '<h1>Crack the safe.<br>Sweep the vault.</h1>\n    <p class="tagline">A demo heist — sample data.</p>')
html = html.replace('<p class="eyebrow">The safe is being cracked</p>', '<p class="eyebrow">The safe is being cracked <span class="demo-tag">DEMO</span></p>')
html = html.replace('<div class="card-label">Prize pool · live</div>', '<div class="card-label">Prize pool · DEMO</div>')
html = html.replace('<body>', '<body>\n<div class="demo-ribbon">DEMO · SAMPLE DATA</div>', 1)
html = html.replace('</style>', '.tagline{font-family:var(--font-display);font-weight:700;font-size:clamp(20px,3.4vw,30px);color:var(--gold-bright);letter-spacing:.06em;margin:-6px 0 14px;text-shadow:0 0 18px rgba(212,175,55,.35)}\n</style>', 1)
assert 'src="config.js"' not in html and 'assets/' not in html, 'unreplaced asset reference'
out = os.path.join(ROOT, 'demo.html')
open(out, 'w', encoding='utf-8').write(html)
print(f'wrote {out} ({os.path.getsize(out)/1024:.0f} KB)')
