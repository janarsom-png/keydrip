// Minimal browser decoder for pump.fun's pump-fees SharingConfig account (no dependencies).
// Layout (Anchor): 8-byte discriminator, bump u8, version u8, status u8 enum (0 Paused, 1 Active),
// mint pubkey, admin pubkey, admin_revoked bool, shareholders Vec<{address pubkey, share_bps u16}>.
(function (root) {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const DISC = [216, 74, 9, 0, 56, 140, 93, 75];
  function b58(bytes) {
    let n = 0n; for (const b of bytes) n = (n << 8n) + BigInt(b);
    let s = ''; while (n > 0n) { s = ALPHABET[Number(n % 58n)] + s; n /= 58n; }
    for (const b of bytes) { if (b === 0) s = '1' + s; else break; }
    return s;
  }
  function fromBase64(b64) {
    if (typeof atob === 'function') return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  function decodeSharingConfig(b64) {
    const d = fromBase64(b64);
    for (let i = 0; i < 8; i++) if (d[i] !== DISC[i]) throw new Error('not a SharingConfig account');
    let o = 8;
    const bump = d[o++], version = d[o++], status = d[o++] === 1 ? 'Active' : 'Paused';
    const mint = b58(d.slice(o, o + 32)); o += 32;
    const admin = b58(d.slice(o, o + 32)); o += 32;
    const adminRevoked = d[o++] === 1;
    const len = d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24); o += 4;
    const shareholders = [];
    for (let i = 0; i < len; i++) {
      const address = b58(d.slice(o, o + 32)); o += 32;
      const shareBps = d[o] | (d[o + 1] << 8); o += 2;
      shareholders.push({ address, shareBps });
    }
    // Same rule as the official SDK's isSharingConfigEditable: v1 is never editable, v2 only until admin is revoked.
    const editable = !(version === 1 || (version === 2 && adminRevoked));
    return { bump, version, status, mint, admin, adminRevoked, shareholders, editable };
  }
  root.KP_decodeSharingConfig = decodeSharingConfig;
  if (typeof module !== 'undefined') module.exports = { decodeSharingConfig };
})(typeof window !== 'undefined' ? window : globalThis);
