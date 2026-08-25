import type { TagValue } from '../types.ts';
import { detectParser } from '../format/mod.ts';
import {
  avifWriter,
  jpegWriter,
  pngWriter,
  webpWriter,
  UnsupportedFormatError,
  type ContainerWriter,
} from './writers.ts';

export interface WriteOptions {
  /** Skip creating a `<file>_original` backup copy. */
  overwriteOriginal?: boolean;
}

export interface WriteResult {
  file: string;
  written: string[];
  skipped: string[];
  backup?: string;
}

const WRITERS: Record<string, ContainerWriter> = {
  JPEG: jpegWriter,
  PNG: pngWriter,
  WebP: webpWriter,
  AVIF: avifWriter,
};

export function supportedWriteFormats(): string[] {
  return Object.keys(WRITERS);
}

/**
 * Safe-overwrite pipeline: parse-checks the target, produces new bytes via
 * the format writer, preserves a `<file>_original` backup unless
 * suppressed, and swaps atomically through a temp file in the same
 * directory. On any producer failure the original file is untouched.
 */
export async function writeTags(
  filePath: string,
  tags: Record<string, TagValue>,
  opts: WriteOptions = {},
): Promise<WriteResult> {
  return writeTagsWithTmp(filePath, tags, opts, `${filePath}.tmp-${crypto.randomUUID()}`);
}

/**
 * Core pipeline with an injectable temp path so failure paths are
 * deterministically testable.
 */
export async function writeTagsWithTmp(
  filePath: string,
  tags: Record<string, TagValue>,
  opts: WriteOptions,
  tmp: string,
): Promise<WriteResult> {
  const original = await Deno.readFile(filePath);
  const parser = detectParser(original);
  if (!parser || !WRITERS[parser.format]) {
    throw new UnsupportedFormatError(
      `writing not supported for ${parser?.format ?? 'unknown'} files`,
    );
  }
  const outcome = WRITERS[parser.format](original, tags);

  let backup: string | undefined;
  try {
    await Deno.writeFile(tmp, outcome.bytes);
    if (!opts.overwriteOriginal) {
      backup = `${filePath}_original`;
      await Deno.copyFile(filePath, backup);
    }
    await Deno.rename(tmp, filePath);
  } catch (e) {
    try {
      await Deno.remove(tmp);
    } catch {
      // temp already gone (or blocked path could not be cleaned)
    }
    throw e;
  }

  return { file: filePath, written: outcome.written, skipped: outcome.skipped, backup };
}

export { UnsupportedFormatError };
