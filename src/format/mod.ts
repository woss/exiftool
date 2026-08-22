import type { FileInfo } from '../types.ts';
import type { TagDb } from '../tag-db.ts';

export interface FormatParser {
  format: string;
  extensions: string[];
  canParse(bytes: Uint8Array): boolean;
  parse(bytes: Uint8Array, filePath: string, tagDb?: TagDb): Promise<FileInfo>;
}

const parsers: Map<string, FormatParser> = new Map();

export function registerParser(parser: FormatParser): void {
  parsers.set(parser.format, parser);
}

export function getParser(format: string): FormatParser | undefined {
  return parsers.get(format);
}

export function detectParser(bytes: Uint8Array): FormatParser | undefined {
  for (const parser of parsers.values()) {
    if (parser.canParse(bytes)) return parser;
  }
  return undefined;
}

export function getAllParsers(): FormatParser[] {
  return [...parsers.values()];
}
