import type { FormatParser } from './mod.js';
import type { FileInfo, TagValue, WriteOutcome } from '../types.js';
import { jpegParser } from './jpeg.js';
import { jpegMergeWriter } from '../write/jpeg-merge.js';
import { UnsupportedFormatError } from '../write/writers.js';

const EXV_HEADER = new Uint8Array([0xff, 0x01, 0x45, 0x78, 0x69, 0x76, 0x32]);
const JPEG_SOI = new Uint8Array([0xff, 0xd8]);

function hasExvHeader(bytes: Uint8Array): boolean {
  return bytes.length >= EXV_HEADER.length && EXV_HEADER.every((value, index) => bytes[index] === value);
}

function asJpeg(bytes: Uint8Array): Uint8Array {
  const jpeg = new Uint8Array(2 + bytes.length - EXV_HEADER.length);
  jpeg.set(JPEG_SOI);
  jpeg.set(bytes.subarray(EXV_HEADER.length), 2);
  return jpeg;
}

export const exvParser: FormatParser = {
  format: 'EXV',
  extensions: ['.exv'],
  canParse: hasExvHeader,
  async parse(bytes: Uint8Array, filePath: string): Promise<FileInfo> {
    if (!hasExvHeader(bytes)) throw new UnsupportedFormatError('not an Exiv2 EXV stream');
    const info = await jpegParser.parse(asJpeg(bytes), filePath);
    info.format = 'EXV';
    info.tags.FileType = 'EXV';
    info.tags.MIMEType = 'image/x-exv';
    info.tags.FileName = filePath.split(/[\\/]/).pop() ?? filePath;
    return info;
  },
  writeBytes(original: Uint8Array, tags: Record<string, TagValue>): WriteOutcome {
    if (!hasExvHeader(original)) throw new UnsupportedFormatError('not an Exiv2 EXV stream');
    const jpegResult = jpegMergeWriter(asJpeg(original), tags);
    const bytes = new Uint8Array(EXV_HEADER.length + jpegResult.bytes.length - JPEG_SOI.length);
    bytes.set(EXV_HEADER);
    bytes.set(jpegResult.bytes.subarray(JPEG_SOI.length), EXV_HEADER.length);
    return { bytes, written: jpegResult.written, skipped: jpegResult.skipped };
  },
};