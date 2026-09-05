/**
 * Minimal RFC 1321 MD5 (pure TypeScript, no platform APIs) — used for
 * Photoshop CurrentIPTCDigest, which exiftool computes from the IPTC block.
 */

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const K = new Uint32Array(64);
for (let i = 0; i < 64; i++) {
  K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0;
}

function toBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function rotl(x: number, c: number): number {
  return ((x << c) | (x >>> (32 - c))) >>> 0;
}

/**
 * Computes hex-encoded MD5 digest of input bytes.
 * Pure TypeScript implementation (RFC 1321) with no platform dependencies.
 * Used for Photoshop CurrentIPTCDigest (MD5 of IPTC block).
 *
 * @param input - Data to hash (Uint8Array or string)
 * @returns 32-character lowercase hex MD5 hash
 */
 export function md5Hex(input: Uint8Array | string): string {
  const msg = typeof input === 'string' ? toBytes(input) : input;
  const origLen = msg.length;

  // Padding: 0x80 then zeros, then 64-bit little-endian bit length.
  const padded = new Uint8Array(((origLen + 8) >> 6 << 6) + 64);
  padded.set(msg);
  padded[origLen] = 0x80;
  const bitLen = origLen * 8;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, bitLen >>> 0, true);
  dv.setUint32(padded.length - 4, Math.floor(bitLen / 2 ** 32), true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    const m = new Uint32Array(16);
    for (let i = 0; i < 16; i++) {
      m[i] = dv.getUint32(chunk + i * 4, true);
    }
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const tmp = d;
      d = c;
      c = b;
      b = (b + rotl((a + f + K[i] + m[g]) >>> 0, S[i])) >>> 0;
      a = tmp;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, a0, true);
  odv.setUint32(4, b0, true);
  odv.setUint32(8, c0, true);
  odv.setUint32(12, d0, true);
  return [...out].map((b) => b.toString(16).padStart(2, '0')).join('');
}
