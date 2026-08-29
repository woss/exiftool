import type { FormatParser, ParseHints } from './mod.js';
import type { FileInfo, TagValue } from '../types.js';
import type { TagDb } from '../tag-db.js';
import { registerParser } from './mod.js';
import { parseTiff } from '../exif/tiff.js';
import { computeCompositeTags } from '../exif/composite.js';

const RIFF_HEADER = new TextEncoder().encode('RIFF');
const WEBP_HEADER = new TextEncoder().encode('WEBP');

export const webpParser: FormatParser = {
  format: 'WebP',
  extensions: ['.webp'],
  canParse(bytes: Uint8Array): boolean {
    if (bytes.length < 12) return false;
    return bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  },
  parse(bytes: Uint8Array, filePath: string, tagDb?: TagDb, hints?: ParseHints): Promise<FileInfo> {
    const result: Record<string, TagValue> = {};
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 12;

    const fileSize = view.getUint32(4, true) + 8;

    while (offset + 8 <= Math.min(bytes.length, fileSize)) {
      const chunkId = new TextDecoder().decode(bytes.slice(offset, offset + 4));
      const chunkSize = view.getUint32(offset + 4, true);
      const paddedSize = chunkSize + (chunkSize & 1);
      offset += 8;

      if (offset + chunkSize > bytes.length) break;

      const chunkData = bytes.slice(offset, offset + chunkSize);

      if (chunkId === 'EXIF') {
        // A sub-6-byte payload can never carry the 8-byte TIFF header, so
        // parseTiff yields no entries either way; slice only when prefixed.
        const tiff = parseTiff(
          chunkData.length >= 6 ? chunkData.slice(6) : chunkData,
          tagDb,
          hints?.coordFormat,
        );
        for (const [k, v] of Object.entries(tiff)) {
          result[k] = v;
        }
      }

      if (chunkId === 'ICCP') {
        result['ICC_Profile'] = chunkData.length > 64
          ? `[ICC profile: ${chunkData.length} bytes]`
          : chunkData;
      }

      if (chunkId === 'XMP ') {
        const xmp = new TextDecoder().decode(chunkData);
        result['XMP'] = xmp.length > 1024
          ? `[XML document: ${xmp.length} chars]`
          : xmp;
      }

      if (chunkId === 'VP8X') {
        const flags = chunkData[0];
        result['WebP_Extended'] = true;
        result['WebP_Anim'] = !!(flags & 0x02);
        result['WebP_XMP'] = !!(flags & 0x04);
        result['WebP_EXIF'] = !!(flags & 0x08);
        result['WebP_Alpha'] = !!(flags & 0x10);
        result['WebP_ICC'] = !!(flags & 0x20);
        if (chunkData.length >= 10) {
          const w = (chunkData[1] | (chunkData[2] << 8) | (chunkData[3] << 16)) + 1;
          const h = (chunkData[4] | (chunkData[5] << 8) | (chunkData[6] << 16)) + 1;
          result['ImageWidth'] = w;
          result['ImageLength'] = h;
        }
      }

      if (chunkId === 'VP8 ' || chunkId === 'VP8L') {
        result[chunkId.trim() === 'VP8' ? 'WebP_Lossy' : 'WebP_Lossless'] = true;
      }

      if (chunkId === 'ANIM') {
        result['WebP_Anim'] = true;
        if (chunkData.length >= 8) {
          const bgView = new DataView(chunkData.buffer, chunkData.byteOffset, 4);
          result['WebP_BackgroundColor'] = bgView.getUint32(0, true);
          result['WebP_LoopCount'] = new DataView(chunkData.buffer, chunkData.byteOffset + 4, 2)
            .getUint16(0, true);
        }
      }

      offset += paddedSize;
    }

    computeCompositeTags(result);
    return Promise.resolve({ path: filePath, format: 'WebP', tags: result });
  },
};

registerParser(webpParser);
