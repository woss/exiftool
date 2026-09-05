const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * Computes CRC-32 checksum using the IEEE 802.3 polynomial (0xEDB88320).
 * Standard algorithm used in PNG, ZIP, MPEG, and many other formats.
 * Pre-computes a 256-entry lookup table for performance.
 *
 * @param data - Input data
 * @returns CRC-32 checksum as unsigned 32-bit integer
 */
 export function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
