// Edit these before deploying. No build step needed.
window.KEYPUZZLE_CONFIG = {
  tokenName: 'The Vault Thief',
  ticker: '$THIEF',
  siteBaseUrl: 'https://thethief.fun',
  contractAddress: '',          // token mint (CA) once launched on pump.fun
  // On-chain proof that 100% of creator fees are locked to the vault wallet (pump.fun fee sharing).
  // Paste the Solscan link of the fee-split transaction (create_fee_sharing_config + update_fee_shares_v2).
  // The sharing_config account link is filled in automatically from reveals.json (feeSplit.sharingConfig).
  feeSplitProofTx: '',          // e.g. 'https://solscan.io/tx/<SIGNATURE>'
  links: {
    pumpfun: 'https://pump.fun/', // e.g. https://pump.fun/coin/<MINT>
    x: 'https://x.com/thevaultthief',
    telegram: 'https://t.me/thethieffun',
  },
  // Public Solana RPC endpoints, tried in order. Browser needs CORS; these send Access-Control-Allow-Origin: *.
  // For real traffic use your own key (Helius, QuickNode, Alchemy...) — public endpoints rate-limit hard.
  rpcEndpoints: [
    'https://solana-rpc.publicnode.com',
    'https://api.mainnet-beta.solana.com',
  ],
  revealsUrl: 'reveals.json',
  refreshSeconds: 30,
  // Live-presence module for the thieves around the vault. OFF by default: GitHub Pages is static, so a true
  // "one thief per live visitor" count needs a realtime backend. When off, an ambient crew is shown instead.
  // See README "Live thief presence" to enable (e.g. a free realtime service). Shape: { enabled, endpoint }.
  presence: { enabled: false, endpoint: '' },
};
