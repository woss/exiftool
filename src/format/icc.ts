import type { FormatParser } from './mod.js';
import type { FileInfo, TagValue, WriteOutcome } from '../types.js';
import { parseICCProfile } from '../exif/icc.js';
import { UnsupportedFormatError } from '../write/writers.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function isIccProfile(bytes: Uint8Array): boolean {
  if (bytes.length < 128) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredLength = view.getUint32(0, false);
  const profileClass = decoder.decode(bytes.subarray(12, 16));
  const colorSpace = decoder.decode(bytes.subarray(16, 20));
  const connectionSpace = decoder.decode(bytes.subarray(20, 24));
  const classes = new Set(['scnr', 'mntr', 'prtr', 'link', 'spac', 'abst', 'nmcl', 'nkpf', 'cenc', 'mid ', 'mlnk', 'mvis']);
  const colorSpaces = /^(XYZ |Lab |Luv |YCbr|Yxy |RGB |GRAY|HSV |HLS |CMYK|CMY |[2-9A-F]CLR|nc..|\0{4})$/;
  return declaredLength >= 128 && declaredLength <= bytes.length &&
    classes.has(profileClass) && colorSpaces.test(colorSpace) && colorSpaces.test(connectionSpace);
}

export const iccParser: FormatParser = {
  format: 'ICC',
  extensions: ['.icc', '.icm'],
  canParse: isIccProfile,
  parse(bytes: Uint8Array, filePath: string): Promise<FileInfo> {
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false);
    const profile = bytes.subarray(0, size);
    const tags: Record<string, TagValue> = parseICCProfile(profile);
    tags.FileType = 'ICC';
    tags.MIMEType = 'application/vnd.iccprofile';
    tags.FileName = filePath.split('/').pop() ?? filePath;
    return Promise.resolve({ path: filePath, format: 'ICC', tags });
  },
  writeBytes(original: Uint8Array, tags: Record<string, TagValue>): WriteOutcome {
    if (!isIccProfile(original)) throw new UnsupportedFormatError('not a valid ICC profile');
    const written: string[] = [];
    const skipped: string[] = [];
    let replacement: Uint8Array | undefined;
    for (const [key, value] of Object.entries(tags)) {
      if (key.toLowerCase() !== 'icc_profile') {
        skipped.push(key);
      } else if (value instanceof Uint8Array) {
        replacement = value;
        written.push(key);
      } else {
        skipped.push(key);
      }
    }
    if (replacement && !isIccProfile(replacement)) {
      throw new UnsupportedFormatError('replacement is not a valid ICC profile');
    }
    return { bytes: replacement ?? original, written, skipped };
  },
};