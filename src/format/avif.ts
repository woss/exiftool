import type { FormatParser, ParseHints } from './mod.js';
import { avifWriter } from '../write/writers.js';
import type { FileInfo, TagValue } from '../types.js';
import type { TagDb } from '../tag-db.js';
import { parseTiff } from '../exif/tiff.js';
import { computeCompositeTags } from '../exif/composite.js';

function readBoxHeader(
  bytes: Uint8Array,
  offset: number,
): { size: number; type: string; headerSize: number } | null {
  if (offset + 8 > bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
  let size = view.getUint32(0, false);
  const type = new TextDecoder().decode(bytes.slice(offset + 4, offset + 8));
  let headerSize = 8;

  if (size === 0) {
    // ISO BMFF: a 32-bit size of 0 means the box extends to the end of the file.
    size = bytes.length - offset;
  } else if (size === 1) {
    if (offset + 16 > bytes.length) return null;
    const extendedView = new DataView(bytes.buffer, bytes.byteOffset + offset + 8, 8);
    size = Number(extendedView.getBigUint64(0, false));
    headerSize = 16;
  }

  // A box smaller than its own header can never advance the walk; reject it
  // exactly like a truncated header so parseBoxTree breaks instead of stalling.
  if (size < headerSize) return null;

  return { size, type, headerSize };
}

function parseBoxTree(
  bytes: Uint8Array,
  offset: number,
  limit: number,
  result: Record<string, TagValue>,
  depth = 0,
  tagDb?: TagDb,
  hints?: ParseHints,
): void {
  if (depth > 20) return;
  let pos = offset;

  while (pos + 8 <= limit) {
    const box = readBoxHeader(bytes, pos);
    if (!box) break;
    if (pos + box.size > limit) break;

    const boxData = bytes.slice(pos + box.headerSize, pos + box.size);

    if (box.type === 'Exif') {
      if (boxData.length > 4) {
        const tiffOffset = new DataView(boxData.buffer, boxData.byteOffset, 4).getUint32(0, false);
        if (tiffOffset < boxData.length) {
          const tiff = parseTiff(boxData.slice(tiffOffset), tagDb, hints?.coordFormat);
          for (const [k, v] of Object.entries(tiff)) {
            result[k] = v;
          }
        }
      }
    }

    if (box.type === 'xml ') {
      const xmp = new TextDecoder().decode(boxData);
      result['XMP'] = xmp.length > 1024
        ? `[XML document: ${xmp.length} chars]`
        : xmp;
    }

    if (
      box.type === 'moov' || box.type === 'trak' || box.type === 'mdia' ||
      box.type === 'minf' || box.type === 'stbl' || box.type === 'meta' ||
      box.type === 'iprp' || box.type === 'ipco' || box.type === 'infe'
    ) {
      const subLimit = Math.min(pos + box.size, limit);
      parseBoxTree(bytes, pos + box.headerSize, subLimit, result, depth + 1, tagDb, hints);
      pos += box.headerSize;
      continue;
    }


    if (box.type === 'colr' && boxData.length >= 4) {
      const colorType = new TextDecoder().decode(boxData.slice(0, 4));
      if (colorType === 'nclx') {
        const props = new DataView(boxData.buffer, boxData.byteOffset + 4, 4);
        result['ColorPrimaries'] = props.getUint16(0, false);
        result['TransferCharacteristics'] = props.getUint16(2, false);
        result['MatrixCoefficients'] = boxData[4 + 4];
        result['VideoFullRange'] = (boxData[4 + 4 + 1] & 0x80) ? 1 : 0;
      } else if (colorType === 'rICC' || colorType === 'prof') {
        result['ICC_Profile'] = boxData.slice(4);
      }
    }

    if (box.type === 'pixi') {
      if (boxData.length >= 1) {
        result['BitDepth'] = boxData[0];
      }
    }

    if (box.type === 'ispe') {
      if (boxData.length >= 8) {
        const dimView = new DataView(boxData.buffer, boxData.byteOffset, 8);
        result['ImageWidth'] = dimView.getUint32(0, false);
        result['ImageLength'] = dimView.getUint32(4, false);
      }
    }

    pos += box.size;
  }
}

export const avifParser: FormatParser = {
  writeBytes: avifWriter,
  format: 'AVIF',
  extensions: ['.avif', '.heic', '.heif', '.hif'],
  canParse(bytes: Uint8Array): boolean {
    if (bytes.length < 12) return false;
    const boxType = new TextDecoder().decode(bytes.slice(4, 8));
    if (boxType !== 'ftyp') return false;
    const majorBrand = new TextDecoder().decode(bytes.slice(8, 12));
    const validBrands = ['avif', 'avis', 'heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'];
    return validBrands.includes(majorBrand);
  },
  parse(bytes: Uint8Array, filePath: string, tagDb?: TagDb, hints?: ParseHints): Promise<FileInfo> {
    const result: Record<string, TagValue> = {};

    const ftypBox = readBoxHeader(bytes, 0);
    if (ftypBox && ftypBox.type === 'ftyp' && ftypBox.size >= 12) {
      const data = bytes.slice(ftypBox.headerSize, ftypBox.size);
      result['FileTypeBrand'] = new TextDecoder().decode(data.slice(0, 4));
      const compatBrands: string[] = [];
      for (let i = 4; i + 4 <= data.length; i += 4) {
        const brand = new TextDecoder().decode(data.slice(i, i + 4));
        if (brand && brand !== '\0\0\0\0') compatBrands.push(brand);
      }
      if (compatBrands.length > 0) result['CompatibleBrands'] = compatBrands;
    }

    parseBoxTree(bytes, 0, bytes.length, result, 0, tagDb, hints);

    computeCompositeTags(result);
    return Promise.resolve({ path: filePath, format: 'AVIF', tags: result });
  },
};

