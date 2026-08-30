import { copyFile, readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { TagValue, WriteOptions, WriteResult } from '../types.js';
import { builtinPlugins, detectParser } from '../format/mod.js';
import type { FormatParser } from '../format/mod.js';
import { UnsupportedFormatError } from './writers.js';

export type { WriteOptions, WriteResult };


export async function supportedWriteFormats(): Promise<string[]> {
  const plugins = await builtinPlugins();
  return plugins.filter((p) => p.writeBytes).map((p) => p.format);
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
  plugins?: FormatParser[],
): Promise<WriteResult> {
  return writeTagsWithTmp(filePath, tags, opts, `${filePath}.tmp-${crypto.randomUUID()}`, plugins);
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
  plugins?: FormatParser[],
): Promise<WriteResult> {
  const original = await readFile(filePath);
  const parser = detectParser(original, plugins ?? await builtinPlugins());
  if (!parser?.writeBytes) {
    throw new UnsupportedFormatError(
      `writing not supported for ${parser?.format ?? 'unknown'} files`,
    );
  }
  const outcome = parser.writeBytes(original, tags);
  let backup: string | undefined;
  try {
    await writeFile(tmp, outcome.bytes);
    if (!opts.overwriteOriginal) {
      backup = `${filePath}_original`;
      await copyFile(filePath, backup);
    }
    await rename(tmp, filePath);
  } catch (e) {
    // Best-effort cleanup; a blocked temp path is left for inspection.
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
    throw e;
  }

  return { file: filePath, written: outcome.written, skipped: outcome.skipped, backup };
}

export { UnsupportedFormatError };
