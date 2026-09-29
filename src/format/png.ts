import type { FormatParser, ParseHints } from './mod.js';
import { pngWriter } from '../write/writers.js';
import type { FileInfo, TagValue } from '../types.js';
import type { TagDb } from '../tag-db.js';
import { parseTiff } from '../exif/tiff.js';
import { parseXMP } from '../exif/xmp.js';
import { computeCompositeTags } from '../exif/composite.js';
import { parseJUMBFFromSegment } from './jumbf.js';
const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** zTXt payloads are zlib streams (RFC 1950); DecompressionStream('deflate')
 * is the platform-free decoder (Node ≥18 global, all browsers). */
async function inflateZtxt(data: Uint8Array): Promise<Uint8Array | null> {
  try {
    const stream = new Blob([data as unknown as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    // Malformed compressed stream: skip, like exiftool ignoring it.
    return null;
  }
}

function readChunk(
  bytes: Uint8Array,
  offset: number,
): { length: number; type: string; data: Uint8Array; crc: number } | null {
  if (offset + 8 > bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
  const length = view.getUint32(0, false);
  const type = new TextDecoder().decode(bytes.slice(offset + 4, offset + 8));
  if (offset + 12 + length > bytes.length) return null;
  const data = bytes.slice(offset + 8, offset + 8 + length);
  const crcView = new DataView(bytes.buffer, bytes.byteOffset + offset + 8 + length, 4);
  const crc = crcView.getUint32(0, false);
  return { length, type, data, crc };
}

/**
 * PNG format parser.
 * Handles eXIf (EXIF in PNG), iCCP (ICC profile), tEXt/iTXt (textual metadata),
 * gAMA, pHYs, caBX (C2PA), and JUMBF chunks.
 */
 export const pngParser: FormatParser = {
  writeBytes: pngWriter,
  format: 'PNG',
  extensions: ['.png'],
  canParse(bytes: Uint8Array): boolean {
    if (bytes.length < 8) return false;
    return bytes[0] === PNG_HEADER[0] && bytes[1] === PNG_HEADER[1] &&
      bytes[2] === PNG_HEADER[2] && bytes[3] === PNG_HEADER[3];
  },
  async parse(bytes: Uint8Array, filePath: string, tagDb?: TagDb, hints?: ParseHints): Promise<FileInfo> {
    const result: Record<string, TagValue> = {};
    // PNG text-chunk tags (tEXt/iTXt/zTXt) have the lowest precedence:
    // EXIF/eXIf-derived and XMP-derived keys always win, text chunks yield.
    const textTags: Record<string, TagValue> = {};
    const ztxtEntries: Array<[string, Uint8Array]> = [];
    let offset = 8;

    while (offset < bytes.length) {
      const chunk = readChunk(bytes, offset);
      if (!chunk) break;
      offset += 12 + chunk.length;

      if (chunk.type === 'IHDR') {
        const view = new DataView(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength);
        result['ImageWidth'] = view.getUint32(0, false);
        result['ImageLength'] = view.getUint32(4, false);
        result['BitDepth'] = view.getUint8(8);
        const colorTypes: Record<number, string> = {
          0: 'Grayscale',
          2: 'RGB',
          3: 'Palette',
          4: 'Grayscale with Alpha',
          6: 'RGB with Alpha',
        };
        const ct = view.getUint8(9);
        result['ColorType'] = colorTypes[ct] ?? String(ct);
        result['Compression'] = view.getUint8(10) === 0 ? 'Deflate/Inflate' : 'Unknown';
        result['Filter'] = view.getUint8(11) === 0 ? 'Adaptive' : 'Unknown';
        result['Interlace'] = view.getUint8(12) === 0
          ? 'Noninterlaced'
          : view.getUint8(12) === 1
          ? 'Adam7'
          : 'Unknown';
      }

      if (chunk.type === 'eXIf') {
        const tiff = parseTiff(chunk.data, tagDb, hints);
        for (const [k, v] of Object.entries(tiff)) {
          result[k] = v;
        }
      }

      if (chunk.type === 'iCCP') {
        const nullIdx = chunk.data.indexOf(0);
        if (nullIdx > 0) {
          result['ICC_Profile_Name'] = new TextDecoder().decode(chunk.data.slice(0, nullIdx));
        }
      }

      if (chunk.type === 'tEXt') {
        const nullIdx = chunk.data.indexOf(0);
        if (nullIdx > 0) {
          const key = new TextDecoder().decode(chunk.data.slice(0, nullIdx));
          const val = new TextDecoder().decode(chunk.data.slice(nullIdx + 1));
          textTags[key] = val;
        }
      }

      if (chunk.type === 'zTXt') {
        // zTXt: keyword NUL compressionMethod deflateData. Compression
        // method byte must be 0 = zlib/deflate; inflate after the chunk
        // walk (DecompressionStream is async).
        const nullIdx = chunk.data.indexOf(0);
        if (nullIdx > 0 && chunk.data[nullIdx + 1] === 0) {
          const key = new TextDecoder().decode(chunk.data.slice(0, nullIdx));
          ztxtEntries.push([key, chunk.data.slice(nullIdx + 2)]);
        }
      }

      if (chunk.type === 'iTXt') {
        const data = chunk.data;
        let pos = 0;
        const null1 = data.indexOf(0, pos);
        if (null1 < 0) continue;
        const keyword = new TextDecoder().decode(data.slice(pos, null1));
        pos = null1 + 1;
        if (pos + 1 >= data.length) continue;
        const compression = data[pos];
        pos++;
        if (pos + 1 >= data.length) continue;
        const method = data[pos];
        pos++;
        const null2 = data.indexOf(0, pos);
        if (null2 < 0) continue;
        const language = new TextDecoder().decode(data.slice(pos, null2));
        pos = null2 + 1;
        const null3 = data.indexOf(0, pos);
        if (null3 < 0) continue;
        const translated = new TextDecoder().decode(data.slice(pos, null3));
        pos = null3 + 1;
        const text = compression === 0
          ? new TextDecoder().decode(data.slice(pos))
          : `[compressed:${compression}]`;
        if (keyword === 'XML:com.adobe.xmp') {
          // Adobe writes the XMP document here; surface its parsed tags
          // instead of storing the raw blob (exiftool behavior).
          const xmpTags = parseXMP(text);
          for (const [k, v] of Object.entries(xmpTags)) {
            if (!(k in result)) result[k] = v;
          }
          continue;
        }
        textTags[keyword] = text;
      }
      if (chunk.type === 'sRGB') {
        const intents: Record<number, string> = {
          0: 'Perceptual',
          1: 'Relative Colorimetric',
          2: 'Saturation',
          3: 'Absolute Colorimetric',
        };
        result['SRGBRendering'] = intents[chunk.data[0]] ?? String(chunk.data[0]);
      }
      if (chunk.type === 'gAMA') {
        const view = new DataView(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength);
        result['Gamma'] = view.getUint32(0, false) / 100000;
      }

      if (chunk.type === 'pHYs') {
        const view = new DataView(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength);
        result['XPixelsPerUnit'] = view.getUint32(0, false);
        result['YPixelsPerUnit'] = view.getUint32(4, false);
        result['UnitSpecifier'] = view.getUint8(8);
      }
      if (chunk.type === 'caBX') {
        const jumbfTags = parseJUMBFFromSegment(chunk.data);
        for (const [k, v] of Object.entries(jumbfTags)) {
          result[k] = v;
        }
      }

      if (chunk.type === 'IEND') break;
    }

    for (const [key, compressed] of ztxtEntries) {
      const inflated = await inflateZtxt(compressed);
      if (inflated) textTags[key] = new TextDecoder().decode(inflated);
    }

    // PNG text-chunk keywords surface capitalized (exiftool behavior:
    // tEXt keyword "parameters" reads as Parameters). EXIF/eXIf- and
    // XMP-derived keys always win, text chunks yield.
    for (const [k, v] of Object.entries(textTags)) {
      const name = k.charAt(0).toUpperCase() + k.slice(1);
      if (!(name in result)) result[name] = v;
    }

    computeCompositeTags(result);
    return { path: filePath, format: 'PNG', tags: result };
  },
};

