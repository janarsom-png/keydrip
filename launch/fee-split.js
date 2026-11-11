#!/usr/bin/env node
/*
 * KeyPuzzle — route a pump.fun coin's creator fees to the puzzle wallet (plus optional extra recipients), and verify it.
 *
 * DRY-RUN BY DEFAULT. Nothing is ever sent unless you pass --send AND type the confirmation phrase.
 *
 *   node launch/fee-split.js status     --mint <MINT> [--puzzle <ADDR>]
 *       Read-only. Checks on-chain that the split is 100% -> puzzle wallet and LOCKED (admin revoked).
 *
 *   node launch/fee-split.js plan       --mint <MINT> --creator <YOUR_CREATOR_WALLET> [--puzzle <ADDR>]
 *       Builds + simulates the ONE transaction (sweep -> create_fee_sharing_config -> update_fee_shares_v2)
 *       and writes it unsigned to launch/out/. Signs nothing, sends nothing.
 *
 *   node launch/fee-split.js plan ... --send --keypair <creator-keypair.json>
 *       Same, then asks you to type a confirmation phrase, signs with YOUR creator wallet and sends.
 *       IRREVERSIBLE: the split can be written only once (update_fee_shares_v2 sets admin_revoked = true).
 *
 *   node launch/fee-split.js distribute --mint <MINT> --payer <ANY_WALLET> [--send --keypair <payer.json>]
 *       Permissionless: pushes accrued creator fees from the vaults into the shareholder (puzzle) wallet.
 *       Anyone can run it; the payer only pays the network fee.
 *
 * Options: --rpc <url> (default https://solana-rpc.publicnode.com), --puzzle defaults to public-commitment.json.
 * Uses @pump-fun/pump-sdk (official). SOL-paired coins only.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Connection, PublicKey, Keypair, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } = require('@solana/web3.js');
const { NATIVE_MINT, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const pump = require('@pump-fun/pump-sdk');
const { PUMP_SDK, OnlinePumpSdk, feeSharingConfigPda, creatorVaultPda, ammCreatorVaultPda, canonicalPumpPoolPda, isSharingConfigEditable } = pump;

const root = path.resolve(__dirname, '..');
const [cmd = 'status', ...rest] = process.argv.slice(2);
const opt = (n, d) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : d; };
const flag = n => rest.includes(n);
const RPC = opt('--rpc', process.env.SOLANA_RPC || 'https://solana-rpc.publicnode.com');
const conn = new Connection(RPC, 'confirmed');
const online = new OnlinePumpSdk(conn);

function puzzleAddress() {
  const p = opt('--puzzle');
  if (p) return new PublicKey(p);
  const f = path.join(root, 'public-commitment.json');
  if (!fs.existsSync(f)) throw new Error('pass --puzzle <ADDR> (public-commitment.json not found)');
  return new PublicKey(JSON.parse(fs.readFileSync(f, 'utf8')).address);
}
const need = n => { const v = opt(n); if (!v) { console.error(`missing ${n}`); process.exit(1); } return new PublicKey(v); };
const sol = lamports => (Number(lamports) / 1e9).toFixed(6) + ' SOL';
const ask = q => new Promise(r => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, a => { rl.close(); r(a); }); });

async function readSharingConfig(mint) {
  const addr = feeSharingConfigPda(mint);
  const info = await conn.getAccountInfo(addr);
  return { addr, cfg: info ? PUMP_SDK.decodeSharingConfig(info) : null };
}

async function status() {
  const mint = need('--mint');
  const puzzle = puzzleAddress();
  const { addr, cfg } = await readSharingConfig(mint);
  console.log(`mint            ${mint.toBase58()}`);
  console.log(`sharing_config  ${addr.toBase58()}   https://solscan.io/account/${addr.toBase58()}`);
  if (!cfg) { console.log('\nFAIL: no sharing_config yet — fees still go to the original creator wallet.'); process.exit(2); }
  const bc = await online.fetchBondingCurve(mint).catch(() => null);
  const puzzleSh = cfg.shareholders.find(sh => sh.address.equals(puzzle));
  const checks = [
    ['bonding curve creator == sharing_config', bc ? bc.creator.equals(addr) : null],
    ['puzzle wallet is a shareholder', !!puzzleSh],
    ['puzzle share', puzzleSh ? `${puzzleSh.shareBps / 100}%` : 'absent'],
    ['admin_revoked == true (split locked)', cfg.adminRevoked === true],
    ['SDK isSharingConfigEditable == false', isSharingConfigEditable({ sharingConfig: cfg }) === false],
  ];
  console.log(`version ${cfg.version} · admin ${cfg.admin.toBase58()} · adminRevoked ${cfg.adminRevoked}`);
  cfg.shareholders.forEach(s => console.log(`  shareholder ${s.address.toBase58()}  ${s.shareBps / 100}%`));
  let ok = true;
  for (const [label, pass] of checks) {
    if (typeof pass === 'string') { console.log(`  ·   ${label}: ${pass}`); continue; }
    console.log(`${pass === null ? '  ?  ' : pass ? ' PASS' : ' FAIL'}  ${label}`); if (pass === false) ok = false;
  }
  const bcVault = creatorVaultPda(addr), ammAuth = ammCreatorVaultPda(addr);
  const bal = await conn.getBalance(bcVault).catch(() => 0);
  console.log(`\npending fees vault (bonding curve) ${bcVault.toBase58()}  ${sol(bal)} (incl. rent)`);
  console.log(`pending fees vault authority (PumpSwap) ${ammAuth.toBase58()}`);
  console.log(`puzzle wallet ${puzzle.toBase58()}  ${sol(await conn.getBalance(puzzle))}`);
  console.log(ok ? `\nRESULT: LOCKED. Puzzle wallet gets ${puzzleSh.shareBps / 100}% of all creator fees, forever.` : '\nRESULT: NOT correctly locked to the puzzle wallet.');
  process.exit(ok ? 0 : 2);
}

async function buildAndMaybeSend(label, ixs, feePayer, signerName, watch) {
  const { blockhash } = await conn.getLatestBlockhash();
  const msg = new TransactionMessage({ payerKey: feePayer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  const size = tx.serialize().length;
  console.log(`\n[${label}] ${ixs.length} instructions, ${size} bytes (limit 1232)`);
  ixs.forEach((ix, i) => console.log(`  ${i + 1}. program ${ix.programId.toBase58()}  accounts ${ix.keys.length}`));
  const simOpts = { sigVerify: false, replaceRecentBlockhash: true };
  if (watch) simOpts.accounts = { encoding: 'base64', addresses: [watch.toBase58()] };
  const sim = await conn.simulateTransaction(tx, simOpts);
  console.log(`  simulation: ${sim.value.err ? 'ERROR ' + JSON.stringify(sim.value.err) : 'OK'}  (${sim.value.unitsConsumed} CU)`);
  if (watch && !sim.value.err && sim.value.accounts && sim.value.accounts[0]) {
    const post = PUMP_SDK.decodeSharingConfig({ data: Buffer.from(sim.value.accounts[0].data[0], 'base64') });
    console.log(`  simulated post-state of sharing_config: adminRevoked=${post.adminRevoked}, editable=${isSharingConfigEditable({ sharingConfig: post })}`);
    post.shareholders.forEach(sh => console.log(`    shareholder ${sh.address.toBase58()} ${sh.shareBps / 100}%`));
  }
  if (sim.value.err && sim.value.logs) console.log('  logs:\n    ' + sim.value.logs.slice(-12).join('\n    '));
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  const outFile = path.join(__dirname, 'out', `${label}-${Date.now()}.unsigned.b64`);
  fs.writeFileSync(outFile, Buffer.from(tx.serialize()).toString('base64'));
  console.log(`  unsigned tx written: ${outFile}`);
  if (!flag('--send')) { console.log('\nDRY RUN — nothing signed or sent. Add --send --keypair <file> to send.'); return; }
  if (sim.value.err) { console.error('Refusing to send: simulation failed.'); process.exit(1); }
  const kpFile = opt('--keypair'); if (!kpFile) { console.error('--send needs --keypair'); process.exit(1); }
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(kpFile, 'utf8'))));
  if (!kp.publicKey.equals(feePayer)) { console.error(`keypair ${kp.publicKey.toBase58()} is not the ${signerName} ${feePayer.toBase58()}`); process.exit(1); }
  return { tx, kp };
}

function loadShareholders(puzzle) {
  const f = opt('--shareholders');
  if (!f) return [{ address: puzzle, shareBps: 10000 }];
  const raw = JSON.parse(fs.readFileSync(path.resolve(f), 'utf8')).shareholders;
  const list = raw.map(r => ({ address: new PublicKey(r.address === 'PUZZLE' ? puzzle.toBase58() : r.address), shareBps: r.share_bps }));
  const sum = list.reduce((a, s) => a + s.shareBps, 0);
  if (sum !== 10000) throw new Error(`share_bps must sum to 10000, got ${sum}`);
  if (list.length < 1 || list.length > 10) throw new Error('need 1..10 shareholders');
  if (!list.some(s => s.address.equals(puzzle))) console.warn('WARNING: the puzzle wallet is not among the shareholders.');
  return list;
}

async function plan() {
  const mint = need('--mint'), creator = need('--creator'), puzzle = puzzleAddress();
  const shareholders = loadShareholders(puzzle);
  const { addr: sc, cfg } = await readSharingConfig(mint);
  if (cfg) { console.error(`sharing_config already exists (adminRevoked=${cfg.adminRevoked}). Run "status" instead.`); process.exit(1); }
  const bc = await online.fetchBondingCurve(mint);
  if (!bc.creator.equals(creator)) { console.error(`bonding curve creator is ${bc.creator.toBase58()}, not ${creator.toBase58()}`); process.exit(1); }
  if (bc.quoteMint && !bc.quoteMint.equals(PublicKey.default) && !bc.quoteMint.equals(NATIVE_MINT)) { console.error('Only SOL-paired coins are supported by this script.'); process.exit(1); }
  const pool = bc.complete ? canonicalPumpPoolPda(mint) : null;
  console.log(`mint ${mint.toBase58()} · creator ${creator.toBase58()} · graduated ${bc.complete}`);
  console.log('NEW SPLIT (permanent once sent):');
  shareholders.forEach(sh => console.log(`  ${sh.shareBps / 100}%  ${sh.address.toBase58()}${sh.address.equals(puzzle) ? '  (puzzle wallet)' : ''}`));
  const q = { quoteMint: NATIVE_MINT, quoteTokenProgram: TOKEN_PROGRAM_ID };
  const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 })];
  ixs.push(await PUMP_SDK.sweepCreatorFeeInstruction({ payer: creator, mint, creator, ...q }));
  if (pool) ixs.push(await PUMP_SDK.sweepPoolCreatorFeeInstruction({ payer: creator, mint, coinCreator: creator, ...q }));
  ixs.push(await PUMP_SDK.createFeeSharingConfig({ creator, mint, pool }));
  ixs.push(await PUMP_SDK.updateFeeSharesV2({ authority: creator, mint, currentShareholders: [creator],
    newShareholders: shareholders, ...q, bondingCurveComplete: bc.complete }));
  const r = await buildAndMaybeSend('fee-split', ixs, creator, 'creator wallet', sc);
  if (!r) return;
  const phrase = `LOCK ${puzzle.toBase58().slice(0, 6)}`;
  const a = await ask(`\nThis PERMANENTLY routes all creator fees of ${mint.toBase58()} to ${puzzle.toBase58()}.\nType "${phrase}" to sign and send: `);
  if (a.trim() !== phrase) { console.log('Not confirmed. Nothing sent.'); return; }
  r.tx.sign([r.kp]);
  const sig = await conn.sendTransaction(r.tx);
  console.log(`sent: https://solscan.io/tx/${sig}`);
  await conn.confirmTransaction(sig, 'confirmed');
  console.log('confirmed. Now run: node launch/fee-split.js status --mint ' + mint.toBase58());
}

async function distribute() {
  const mint = need('--mint'), payer = need('--payer');
  const res = await online.buildDistributeCreatorFeesInstructions(mint, { payer });
  const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }), ...res.instructions];
  const min = await online.getMinimumDistributableFee(mint, payer).catch(() => null);
  if (min) console.log(`distributable: ${sol(min.distributableFees)} · minimum ${sol(min.minimumRequired)} · canDistribute ${min.canDistribute}`);
  const r = await buildAndMaybeSend('distribute', ixs, payer, 'payer');
  if (!r) return;
  const a = await ask('Type "DISTRIBUTE" to sign and send: ');
  if (a.trim() !== 'DISTRIBUTE') { console.log('Not confirmed. Nothing sent.'); return; }
  r.tx.sign([r.kp]);
  const sig = await conn.sendTransaction(r.tx);
  console.log(`sent: https://solscan.io/tx/${sig}`);
}

({ status, plan, distribute }[cmd] || (() => { console.error('commands: status | plan | distribute'); process.exit(1); }))()
  .catch(e => { console.error('error:', e.message || e); process.exit(1); });
