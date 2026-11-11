// Edit these before deploying. No build step needed.
window.KEYPUZZLE_CONFIG = {
  tokenName: 'TOKEN_NAME',
  ticker: '$TICKER',
  contractAddress: '',          // token mint (CA) once launched on pump.fun
  // On-chain proof that 100% of creator fees are locked to the puzzle wallet (pump.fun fee sharing).
  // Paste the Solscan link of the fee-split transaction (create_fee_sharing_config + update_fee_shares_v2).
  // The sharing_config account link is filled in automatically from reveals.json (feeSplit.sharingConfig).
  feeSplitProofTx: '',          // e.g. 'https://solscan.io/tx/<SIGNATURE>'
  links: {
    pumpfun: 'https://pump.fun/', // e.g. https://pump.fun/coin/<MINT>
    x: 'https://x.com/',
    telegram: 'https://t.me/',
  },
  // Public Solana RPC endpoints, tried in order. Browser needs CORS; these send Access-Control-Allow-Origin: *.
  // For real traffic use your own key (Helius, QuickNode, Alchemy...) — public endpoints rate-limit hard.
  rpcEndpoints: [
    'https://solana-rpc.publicnode.com',
    'https://api.mainnet-beta.solana.com',
  ],
  revealsUrl: 'reveals.json',
  refreshSeconds: 30,
};
