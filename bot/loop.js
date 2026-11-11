#!/usr/bin/env node
/* The Vault Thief bot — run the tick forever (VPS/local). node bot/loop.js [--interval 120] [--config ...] [--mint ...] */
const { execFileSync } = require('child_process');
const path = require('path');
const args = process.argv.slice(2);
const i = args.indexOf('--interval'); const interval = (i >= 0 ? parseFloat(args[i + 1]) : 120) * 1000;
const passthru = args.filter((_, k) => k !== i && k !== i + 1);
const tick = () => { try { execFileSync(process.execPath, [path.join(__dirname, 'run.js'), ...passthru], { stdio: 'inherit' }); } catch (e) { console.error('tick failed, continuing'); } };
tick(); setInterval(tick, interval);
console.log(`looping every ${interval / 1000}s`);
