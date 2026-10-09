import type { FormatParser, ParseHints } from './mod.js';
import type { FileInfo } from '../types.js';
import type { TagDb } from '../tag-db.js';
import { gifWriter, parseGifMetadata } from '../write/gif.js';

const GIF_SIGNATURES = new Set(['GIF87a', 'GIF89a']);
const decoder = new TextDecoder();

export const gifParser: FormatParser = {
  format: 'GIF',
  extensions: ['.gif'],
  writeBytes: gifWriter,
  canParse(bytes: Uint8Array): boolean {
    return bytes.length >= 6 && GIF_SIGNATURES.has(decoder.decode(bytes.subarray(0, 6)));
  },
  parse(
    bytes: Uint8Array,
    filePath: string,
    _tagDb?: TagDb,
    _hints?: ParseHints,
  ): Promise<FileInfo> {
    const tags = parseGifMetadata(bytes);
    tags.FileType = 'GIF';
    tags.MIMEType = 'image/gif';
    const fileName = filePath.split('/').pop() ?? filePath;
    tags.FileName = fileName;
    return Promise.resolve({ path: filePath, format: 'GIF', tags });
  },
};