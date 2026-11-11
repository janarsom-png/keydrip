// Ready-to-post X (tweet) text per event. The bot writes these to drafts/ and feed.json — it NEVER posts.
const short = a => a ? a.slice(0, 4) + '…' + a.slice(-4) : '';
function tweetFor(ev, cfg, reveals) {
  const T = cfg.ticker || '$THIEF', site = cfg.siteBaseUrl || '';
  const hidden = reveals && reveals.puzzle ? reveals.puzzle.hiddenCount : '?';
  const bits = reveals && reveals.puzzle ? reveals.puzzle.bitsRemaining : '?';
  switch (ev.type) {
    case 'launch':
      return `\u{1F510} The 24-hour heist is live.\n\n${T}: 100% of creator fees are locked in a safe. Its combination drips out one tumbler at a time over 24h \u2014 faster when the market cap jumps. Last tumblers open as the clock runs out. First thief to crack it sweeps the vault.\n${site}`;
    case 'reveal':
      return `🔓 A glyph just dripped.\n\n${T} vault key is now ${hidden} glyphs from cracked (~${bits} bits left).\n\nVerify it yourself — every reveal is commitment-checked.\n${site}`;
    case 'milestone':
      return `📈 Milestone hit: ${ev.label}.\n\nThe vault leaks another glyph of the ${T} creator-fee wallet. Pot's climbing, lock's weakening.\n${site}`;
    case 'endgame':
      return `⏳ Final hours: ${ev.label}.\n\n${T} is down to ${hidden} hidden glyphs (~${bits} bits) — getting crackable on an ordinary PC. At the 24h mark the last tumblers open. The race is on.\n${site}`;
    case 'win':
      return `🏁 THE VAULT IS CRACKED.\n\nSomeone reconstructed the ${T} key and swept ${ev.amountSol != null ? ev.amountSol + ' SOL' : 'the pot'}.\nTx: https://solscan.io/tx/${ev.tx}\n\nFees still flow to that wallet — it's a sweeper race now. Full key revealed on site.\n${site}`;
    default:
      return `${T}: ${ev.title || ev.type}\n${site}`;
  }
}
module.exports = { tweetFor, short };
