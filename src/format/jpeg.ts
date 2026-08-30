import type { FormatParser, ParseHints } from './mod.js';
import { jpegWriter } from '../write/writers.js';
import type { FileInfo, TagValue } from '../types.js';
import type { TagDb } from '../tag-db.js';
import { parseTiff } from '../exif/tiff.js';
import { parseICCProfile } from '../exif/icc.js';
import { parseXMP } from '../exif/xmp.js';
import { computeCompositeTags } from '../exif/composite.js';
import { parseAPP13 } from '../exif/app13.js';

export const jpegParser: FormatParser = {
  writeBytes: jpegWriter,
  format: 'JPEG',
  extensions: ['.jpg', '.jpeg', '.jpe', '.jif', '.jfif', '.jfi'],
  canParse(bytes: Uint8Array): boolean {
    return bytes[0] === 0xff && bytes[1] === 0xd8;
  },
  parse(bytes: Uint8Array, filePath: string, tagDb?: TagDb, hints?: ParseHints): Promise<FileInfo> {
    const result: Record<string, TagValue> = {};
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 2;

    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      while (offset < bytes.length && bytes[offset] === 0xff) offset++;
      if (offset >= bytes.length) break;
      const marker = bytes[offset++];
      if (marker === 0x00 || marker === 0xd9) break;

      if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
      if (marker === 0xda) {
        offset = bytes.length;
        break;
      }

      if (offset + 2 > bytes.length) break;
      const segLen = view.getUint16(offset, false);
      if (segLen < 2) break;
      offset += 2;
      const data = bytes.slice(offset, offset + segLen - 2);

      if (marker === 0xe1 && data.length >= 6) {
        const id = new TextDecoder().decode(data.slice(0, 6));
        if (id === 'Exif\0\0') {
          const tiffData = data.slice(6);
          // offset points to data[0] (APP1 payload start, after length field).
          // TIFF data starts at file position: offset (payload) + 6 (skip "Exif\0\0")
          const tiffFileOffset = offset + 6;
          result['ExifByteOrder'] = tiffData[0] === 0x49 ? 'Little-endian (Intel, II)' : 'Big-endian (Motorola, MM)';
          const tiff = parseTiff(tiffData, tagDb, hints?.coordFormat);
          for (const [k, v] of Object.entries(tiff)) {
            result[k] = v;
          }
          const thumbOff = result['ThumbnailOffset'];
          const thumbLen = result['ThumbnailLength'];
          if (typeof thumbOff === 'number' && typeof thumbLen === 'number') {
            const absOff = tiffFileOffset + thumbOff;
            result['ThumbnailOffset'] = absOff;
            result['ThumbnailImage'] = bytes.slice(absOff, absOff + thumbLen);
          }
        } else if (data[0] === 0x68) {
          const xmpIdent = 'http://ns.adobe.com/xap/1.0/\0';
          const xmpStart = data.length > 29 && new TextDecoder().decode(data.slice(0, 29)) === xmpIdent ? 29 : 0;
          const xmpStr = new TextDecoder().decode(data.slice(xmpStart));
          const xmpTags = parseXMP(xmpStr);
          for (const [k, v] of Object.entries(xmpTags)) {
            if (!(k in result)) {
              result[k] = v;
            }
          }
        }
      }

      if (marker === 0xe2 && data.length >= 4) {
        const id = new TextDecoder().decode(data.slice(0, 4));
        if (id === 'MPF\0') {
          result['MPF'] = 'present';
        }
      }

      if (marker === 0xe2 && data.length >= 14) {
        const id = new TextDecoder().decode(data.slice(0, 12));
        if (id === 'ICC_PROFILE\0') {
          const iccTags = parseICCProfile(data.slice(14));
          for (const [k, v] of Object.entries(iccTags)) {
            result[k] = v;
          }
        }
      }

      if (marker === 0xed && data.length >= 14) {
        const psId = new TextDecoder().decode(data.slice(0, 14));
        if (psId === 'Photoshop 3.0\0') {
          const app13 = parseAPP13(data.slice(14));
          for (const [k, v] of Object.entries(app13)) {
            result[k] = v;
          }
        }
      }

      if (marker === 0xee && data.length >= 12) {
        const adobeId = new TextDecoder().decode(data.slice(0, 5));
        if (adobeId === 'Adobe') {
          const dctEncode = (data[5] << 8) | data[6];
          const flags0 = (data[7] << 8) | data[8];
          const flags1 = (data[9] << 8) | data[10];
          const ct = data[11];
          result['DCTEncodeVersion'] = dctEncode;
          const f0bits: string[] = [];
          for (let b = 0; b < 15; b++) {
            if ((flags0 >> b) & 1) f0bits.push(String(b));
          }
          const f0desc: string[] = [];
          if (flags0 & (1 << 14)) f0desc.push('Encoded with Blend=1 downsampling');
          result['APP14Flags0'] = `[${f0bits.join(', ')}], ${f0desc.join(', ')}`;
          result['APP14Flags1'] = flags1 === 0 ? '(none)' : `[${flags1}]`;
          const ctNames: Record<number, string> = { 0: 'Unknown', 1: 'YCbCr', 2: 'YCCK' };
          result['ColorTransform'] = ctNames[ct] ?? 'Unknown';
        }
      }

      if (marker === 0xfe) {
        result['Comment'] = new TextDecoder().decode(data);
      }

      if (marker >= 0xc0 && marker <= 0xc3 && data.length >= 6) {
        const encodingNames: Record<number, string> = {
          0xc0: 'Baseline DCT, Huffman coding',
          0xc1: 'Extended sequential DCT, Huffman coding',
          0xc2: 'Progressive DCT, Huffman coding',
          0xc3: 'Lossless (sequential), Huffman coding',
        };
        // Marker range is gated to 0xc0-0xc3 above, exactly the table's keys.
        result['EncodingProcess'] = encodingNames[marker];
        result['BitsPerSample'] = data[0];
        result['ImageHeight'] = (data[1] << 8) | data[2];
        result['ImageWidth'] = (data[3] << 8) | data[4];
        const numComponents = data[5];
        result['ColorComponents'] = numComponents;
        if (data.length >= 6 + 3 * numComponents && numComponents >= 3) {
          const ySF = data[7];
          const cbSF = data[10];
          const crSF = data[13];
          const yH = (ySF >> 4) & 0x0f;
          const yV = ySF & 0x0f;
          const cbH = (cbSF >> 4) & 0x0f;
          const cbV = cbSF & 0x0f;
          const crH = (crSF >> 4) & 0x0f;
          const crV = crSF & 0x0f;
          if (yH === 1 && yV === 1 && cbH === 1 && cbV === 1 && crH === 1 && crV === 1) {
            result['YCbCrSubSampling'] = 'YCbCr4:4:4 (1 1)';
          } else if (yH === 2 && yV === 1 && cbH === 1 && cbV === 1) {
            result['YCbCrSubSampling'] = 'YCbCr4:2:2 (2 1)';
          } else if (yH === 2 && yV === 2 && cbH === 1 && cbV === 1) {
            result['YCbCrSubSampling'] = 'YCbCr4:2:0 (2 2)';
          } else {
            result['YCbCrSubSampling'] = `YCbCr4:${yH}:${yV} (${cbH} ${cbV})`;
          }
        }
      }

      offset += segLen - 2;
    }

    if (result['Subject'] && result['Keywords']) {
      const existing = (result['Keywords'] as string[]);
      const subject = result['Subject'];
      const subArr = Array.isArray(subject) ? subject : [subject as string];
      for (const s of subArr) {
        if (typeof s === 'string' && !existing.includes(s)) existing.push(s);
      }
    } else if (result['Subject'] && !result['Keywords']) {
      result['Keywords'] = result['Subject'];
    }

    if (!('DerivedFromInstanceID' in result) && result['HistoryInstanceID']) {
      const histIDs = result['HistoryInstanceID'];
      const first = Array.isArray(histIDs) ? histIDs[0] : histIDs;
      if (typeof first === 'string') {
        result['DerivedFromInstanceID'] = first;
        result['DerivedFromDocumentID'] = first.replace('xmp.iid:', 'xmp.did:');
      }
    }
    if (!('DerivedFromOriginalDocumentID' in result) && result['OriginalDocumentID']) {
      result['DerivedFromOriginalDocumentID'] = result['OriginalDocumentID'];
    }

    // ExifTool appends the capture timezone (EXIF OffsetTimeOriginal) to the
    // IIM times and composes the DateTimeCreated pairs.
    const tz = typeof result['OffsetTimeOriginal'] === 'string' ? result['OffsetTimeOriginal'] : '';
    const hasTz = (s: string) => /[+-]\d{2}:\d{2}$/.test(s);
    if (typeof result['TimeCreated'] === 'string' && tz && !hasTz(result['TimeCreated'])) {
      result['TimeCreated'] += tz;
    }
    if (typeof result['DigitalCreationTime'] === 'string' && tz && !hasTz(result['DigitalCreationTime'])) {
      result['DigitalCreationTime'] += tz;
    }
    if (typeof result['DateCreated'] === 'string' && typeof result['TimeCreated'] === 'string') {
      result['DateTimeCreated'] = `${result['DateCreated']} ${result['TimeCreated']}`;
    }
    if (
      typeof result['DigitalCreationDate'] === 'string' &&
      typeof result['DigitalCreationTime'] === 'string'
    ) {
      result['DigitalCreationDateTime'] =
        `${result['DigitalCreationDate']} ${result['DigitalCreationTime']}`;
    }
    computeCompositeTags(result);
    addFileMetadata(result, filePath);
    result['ExifToolVersion'] = 13.55;
    delete result['ImageLength'];
    return Promise.resolve({ path: filePath, format: 'JPEG', tags: result });
  },
};

function addFileMetadata(result: Record<string, TagValue>, filePath: string): void {
  const parts = filePath.split('/');
  const fileName = parts[parts.length - 1];
  result['FileName'] = fileName;
  result['Directory'] = parts.slice(0, -1).join('/') || '/';
  result['SourceFile'] = filePath;
  result['FileType'] = 'JPEG';
  result['FileTypeExtension'] = 'jpg';
  result['MIMEType'] = 'image/jpeg';
}
const MP_ENTRY_SIZE = 16;

/**
 * Locates the MPF (Multi-Picture Format) APP2 segment's TIFF header start
 * (right after the 'MPF\0' signature), or -1 when absent/unreachable.
 */
function findMpfTiffStart(bytes: Uint8Array): number {
  if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return -1;
  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xFF) return -1;
    const marker = bytes[pos + 1];
    if (marker === 0xDA || marker === 0xD9) return -1; // SOS/EOI: headers done
    // RSTn and TEM markers carry no length field
    if ((marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) { pos += 2; continue; }
    const segLen = (bytes[pos + 2] << 8) | bytes[pos + 3];
    if (segLen < 2) return -1;
    const dataStart = pos + 4;
    const dataEnd = dataStart + segLen - 2;
    if (dataEnd > bytes.length) return -1;
    if (
      marker === 0xE2 && segLen >= 8 &&
      bytes[dataStart] === 0x4D && bytes[dataStart + 1] === 0x50 &&
      bytes[dataStart + 2] === 0x46 && bytes[dataStart + 3] === 0x00
    ) {
      return dataStart + 4;
    }
    pos += 2 + segLen;
  }
  return -1;
}

/**
 * Extracts the Individual Images advertised by a JPEG MPF APP2 segment
 * (CIPA DC-007). Returns standalone copies in MP-entry order, skipping
 * zero-size entries and entries that do not begin with a JPEG SOI marker.
 * Returns [] when no usable MPF segment exists. Never throws.
 */
export function extractEmbeddedJpegs(bytes: Uint8Array): Uint8Array[] {
  const tiffStart = findMpfTiffStart(bytes);
  if (tiffStart < 0 || tiffStart + 8 > bytes.length) return [];
  const little = bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49;
  const big = !little && bytes[tiffStart] === 0x4D &&
    bytes[tiffStart + 1] === 0x4D;
  if (!little && !big) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ifdOffset = view.getUint32(tiffStart + 4, little);
  if (ifdOffset < 2 || tiffStart + ifdOffset + 2 > bytes.length) return [];
  const numEntries = view.getUint16(tiffStart + ifdOffset, little);
  let entriesPos = -1;
  let count = 0;
  let p = tiffStart + ifdOffset + 2;
  for (let i = 0; i < numEntries; i++) {
    if (p + 12 > bytes.length) return [];
    if (view.getUint16(p, little) === 0xB002) { // MPEntry
      count = view.getUint32(p + 4, little);
      entriesPos = tiffStart + view.getUint32(p + 8, little);
    }
    p += 12;
  }
  if (entriesPos < 0 || count === 0) return [];
  // Writers disagree on B002's count field: some store 16 x N (the byte
  // size of the entry table), others store N directly. Normalize to entries.
  if (count % MP_ENTRY_SIZE === 0) count = count / MP_ENTRY_SIZE;
  if (entriesPos + count * MP_ENTRY_SIZE > bytes.length) return [];
  const docs: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const base = entriesPos + i * MP_ENTRY_SIZE;
    const size = view.getUint32(base + 4, little);
    const off = view.getUint32(base + 8, little);
    const abs = tiffStart + off;
    const isJpeg = size > 0 && off !== 0 && abs + size <= bytes.length &&
      bytes[abs] === 0xFF && bytes[abs + 1] === 0xD8 && bytes[abs + 2] === 0xFF;
    if (isJpeg) docs.push(bytes.slice(abs, abs + size));
  }
  return docs;
}
