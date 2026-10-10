import { chmod, copyFile, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
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
  const sourceStat = await stat(filePath);
  const original = await readFile(filePath);
  const parser = detectParser(original, plugins ?? await builtinPlugins(), filePath);
  if (!parser?.writeBytes) {
    throw new UnsupportedFormatError(
      `writing not supported for ${parser?.format ?? 'unknown'} files`,
    );
  }
  const writeMode = opts.writeMode?.toLowerCase();
  if (writeMode !== undefined && !/^[wcg]*$/.test(writeMode)) {
    throw new UnsupportedFormatError(`invalid write mode: ${opts.writeMode}`);
  }
  let writeTags = tags;
  let modeSkipped: string[] = [];
  if (writeMode !== undefined && writeMode !== 'wcg') {
    const current = await parser.parse(original, filePath);
    const currentNames = new Set(Object.keys(current.tags).map(normalizeWriteTagName));
    writeTags = {};
    for (const [key, value] of Object.entries(tags)) {
      const exists = currentNames.has(normalizeWriteTagName(key));
      const allowExisting = writeMode.includes('w');
      const allowCreate = writeMode.includes('c');
      if ((exists && allowExisting) || (!exists && allowCreate)) {
        writeTags[key] = value;
      } else {
        modeSkipped.push(key);
      }
    }
    if (Object.keys(writeTags).length === 0) {
      return { file: filePath, written: [], skipped: [], modeSkipped };
    }
  }
  const outcome = parser.writeBytes(original, writeTags, opts);
  if (Object.keys(writeTags).length > 0 && outcome.written.length === 0 && outcome.skipped.length > 0) {
    throw new UnsupportedFormatError(`no requested tags are writable: ${outcome.skipped.join(', ')}`);
  }
  let backup: string | undefined;
  try {
    await writeFile(tmp, outcome.bytes);
    await chmod(tmp, sourceStat.mode & 0o7777);
    if (opts.preserveTime) await utimes(tmp, sourceStat.atime, sourceStat.mtime);
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

  return {
    file: filePath,
    written: outcome.written,
    skipped: outcome.skipped,
    ...(modeSkipped.length > 0 ? { modeSkipped } : {}),
    backup,
  };
}

function normalizeWriteTagName(name: string): string {
  const ungrouped = name.toLowerCase().replace(/^-/, '').split(':').at(-1)!;
  return ungrouped === 'keywords' ? 'subject' : ungrouped;
}

export { UnsupportedFormatError };
