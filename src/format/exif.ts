import type { FormatParser } from './mod.js';
import type { FileInfo, TagValue, WriteOutcome } from '../types.js';
import { parseTiff } from '../exif/tiff.js';
import { computeCompositeTags } from '../exif/composite.js';
import { mergeExifTiff, parseRawTiff, resolveMergeRequests, type ExifRequest } from '../write/jpeg-merge.js';
import { writeXmpPacket } from '../write/xmp-writer.js';
import { UnsupportedFormatError } from '../write/writers.js';

const XMP_TAG_SPEC = { id: 0x02bc, type: 7 as const, name: 'XMP' };

function isExifTiff(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  const isLittleEndian = bytes[0] === 0x49 && bytes[1] === 0x49;
  const isBigEndian = bytes[0] === 0x4d && bytes[1] === 0x4d;
  if (!isLittleEndian && !isBigEndian) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint16(2, isLittleEndian) === 42;
}

export const exifParser: FormatParser = {
  format: 'EXIF',
  extensions: ['.exif'],
  canParse: isExifTiff,
  parse(bytes: Uint8Array, filePath: string): Promise<FileInfo> {
    if (!isExifTiff(bytes)) throw new UnsupportedFormatError('not a standalone EXIF TIFF stream');
    const tags: Record<string, TagValue> = parseTiff(bytes);
    computeCompositeTags(tags);
    tags.FileType = 'EXIF';
    tags.MIMEType = 'application/octet-stream';
    tags.FileName = filePath.split(/[\\/]/).pop() ?? filePath;
    return Promise.resolve({ path: filePath, format: 'EXIF', tags });
  },
  writeBytes(original: Uint8Array, tags: Record<string, TagValue>): WriteOutcome {
    if (!isExifTiff(original)) throw new UnsupportedFormatError('not a standalone EXIF TIFF stream');
    const requests = resolveMergeRequests(tags);
    const raw = parseRawTiff(original);
    if (!raw) throw new UnsupportedFormatError('malformed EXIF structure');
    const existingXmp = raw.ifd0.entries.find((entry) => entry.tag === XMP_TAG_SPEC.id)?.data;
    const exifRequests: ExifRequest[] = [...requests.exif];
    const written = [...requests.xmpKeys];
    const skipped = [...requests.skipped, ...requests.iptcKeys];
    if (requests.xmp.length > 0) {
      const packet = writeXmpPacket(existingXmp ? new TextDecoder().decode(existingXmp) : null, requests.xmp);
      exifRequests.push({ key: 'XMP', spec: XMP_TAG_SPEC, value: packet, home: 0 });
    }
    if (exifRequests.length === 0) return { bytes: original, written, skipped };
    const merged = mergeExifTiff(original, exifRequests);
    return {
      bytes: merged.bytes,
      written: [...written, ...merged.written.filter((key) => key !== 'XMP')],
      skipped: [...skipped, ...merged.skipped.filter((key) => key !== 'XMP')],
    };
  },
};