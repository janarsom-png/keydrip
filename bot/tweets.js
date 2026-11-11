// Ready-to-post X (tweet) text per event. The bot writes these to drafts/ and feed.json — it NEVER posts.
const short = a => a ? a.slice(0, 4) + '…' + a.slice(-4) : '';
function tweetFor(ev, cfg, reveals) {
  const T = cfg.ticker || '$THIEF', site = cfg.siteBaseUrl || '';
  const hidden = reveals && reveals.puzzle ? reveals.puzzle.hiddenCount : '?';
  const bits = reveals && reveals.puzzle ? reveals.puzzle.bitsRemaining : '?';
  switch (ev.type) {
    case 'reveal':
      return `🔓 A glyph just dripped.\n\n${T} vault key is now ${hidden} glyphs from cracked (~${bits} bits left).\n\nVerify it yourself — every reveal is commitment-checked.\n${site}`;
    case 'milestone':
      return `📈 Milestone hit: ${ev.label}.\n\nThe vault leaks another glyph of the ${T} creator-fee wallet. Pot's climbing, lock's weakening.\n${site}`;
    case 'endgame':
      return `⏳ Endgame drip: ${ev.label}.\n\n${T} is down to ${hidden} hidden glyphs (~${bits} bits). The cracking race is open.\n${site}`;
    case 'win':
      return `🏁 THE VAULT IS CRACKED.\n\nSomeone reconstructed the ${T} key and swept ${ev.amountSol != null ? ev.amountSol + ' SOL' : 'the pot'}.\nTx: https://solscan.io/tx/${ev.tx}\n\nFees still flow to that wallet — it's a sweeper race now. Full key revealed on site.\n${site}`;
    default:
      return `${T}: ${ev.title || ev.type}\n${site}`;
  }
}
module.exports = { tweetFor, short };
