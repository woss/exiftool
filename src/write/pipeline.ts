import { chmod, copyFile, open, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import type { TagValue, WriteOptions, WriteResult } from '../types.js';
import { builtinPlugins, detectParser } from '../format/mod.js';
import type { FormatParser } from '../format/mod.js';
import { UnsupportedFormatError } from './writers.js';
import { toXmpPropertyName } from './xmp-writer.js';

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
  const fileDateRequest = Object.entries(tags).find(([name]) =>
    name.toLowerCase().split(':').at(-1) === 'filemodifydate');
  const fileDate = fileDateRequest
    ? parseFileModifyDate(fileDateRequest[1])
    : undefined;
  const metadataTags = fileDateRequest
    ? Object.fromEntries(Object.entries(tags).filter(([name]) => name !== fileDateRequest[0]))
    : tags;
  const sourceStat = await stat(filePath);
  if (Object.keys(metadataTags).length === 0) {
    if (fileDate === undefined) return { file: filePath, written: [], skipped: [] };
    await utimes(filePath, sourceStat.atime, fileDate);
    return { file: filePath, written: [fileDateRequest![0]], skipped: [] };
  }
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
  let writeTags = metadataTags;
  let modeSkipped: string[] = [];
  if (writeMode !== undefined && writeMode !== 'wcg') {
    const current = await parser.parse(original, filePath);
    const currentNames = new Set(Object.keys(current.tags).map(normalizeWriteTagName));
    const hasXmpGroup = Object.keys(current.tags).some((name) =>
      name.toLowerCase() === 'xmptoolkit' || name.toLowerCase().startsWith('xmp-'));
    writeTags = {};
    for (const [key, value] of Object.entries(metadataTags)) {
      const exists = currentNames.has(normalizeWriteTagName(key));
      const createsXmpGroup = !exists && toXmpPropertyName(key) !== undefined &&
        !hasXmpGroup && !writeMode.includes('g');
      const allowExisting = writeMode.includes('w');
      const allowCreate = writeMode.includes('c') ||
        (hasXmpGroup && allowExisting && toXmpPropertyName(key) !== undefined);
      if ((exists && allowExisting) || (!exists && allowCreate && !createsXmpGroup)) {
        writeTags[key] = value;
      } else {
        modeSkipped.push(key);
      }
    }
    if (Object.keys(writeTags).length === 0) {
      if (fileDate !== undefined) {
        await utimes(filePath, sourceStat.atime, fileDate);
        return {
          file: filePath,
          written: [fileDateRequest![0]],
          skipped: [],
          modeSkipped,
        };
      }
      return { file: filePath, written: [], skipped: [], modeSkipped };
    }
  }
  const outcome = parser.writeBytes(original, writeTags, opts);
  if (Object.keys(writeTags).length > 0 && outcome.written.length === 0 && outcome.skipped.length > 0) {
    throw new UnsupportedFormatError(`no requested tags are writable: ${outcome.skipped.join(', ')}`);
  }
  let backup: string | undefined;
  const overwriteInPlace = opts.overwriteOriginalInPlace === true;
  try {
    await writeFile(tmp, outcome.bytes);
    await chmod(tmp, sourceStat.mode & 0o7777);
    if (opts.preserveTime) await utimes(tmp, sourceStat.atime, sourceStat.mtime);
    if (!opts.overwriteOriginal && !overwriteInPlace) {
      backup = `${filePath}_original`;
      await copyFile(filePath, backup);
    }
    if (overwriteInPlace) {
      const fd = await open(filePath, 'r+');
      try {
        await fd.truncate(0);
        await fd.writeFile(outcome.bytes);
        await fd.sync();
      } finally {
        await fd.close();
      }
      if (opts.preserveTime) await utimes(filePath, sourceStat.atime, sourceStat.mtime);
      await rm(tmp, { recursive: true, force: true }).catch(() => {});
    } else {
      await rename(tmp, filePath);
    }
    if (fileDate !== undefined) await utimes(filePath, sourceStat.atime, fileDate);
  } catch (e) {
    // Best-effort cleanup; a blocked temp path is left for inspection.
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
    throw e;
  }

  return {
    file: filePath,
    written: fileDateRequest
      ? [...outcome.written, fileDateRequest[0]]
      : outcome.written,
    skipped: outcome.skipped,
    ...(modeSkipped.length > 0 ? { modeSkipped } : {}),
    backup,
  };
}

function parseFileModifyDate(value: TagValue): Date {
  if (typeof value !== 'string') {
    throw new UnsupportedFormatError('FileModifyDate requires a date string');
  }
  const match = value.match(
    /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/,
  );
  if (!match) throw new UnsupportedFormatError(`invalid FileModifyDate value: ${value}`);
  const [, year, month, day, hour, minute, second, fraction = '', zone = ''] = match;
  const [yearNumber, monthNumber, dayNumber, hourNumber, minuteNumber, secondNumber] =
    [year, month, day, hour, minute, second].map(Number);
  const check = new Date(0);
  check.setUTCFullYear(yearNumber!, monthNumber! - 1, dayNumber!);
  check.setUTCHours(hourNumber!, minuteNumber!, secondNumber!, 0);
  if (
    check.getUTCFullYear() !== yearNumber || check.getUTCMonth() !== monthNumber! - 1 ||
    check.getUTCDate() !== dayNumber || check.getUTCHours() !== hourNumber ||
    check.getUTCMinutes() !== minuteNumber || check.getUTCSeconds() !== secondNumber
  ) {
    throw new UnsupportedFormatError(`invalid FileModifyDate value: ${value}`);
  }
  const normalizedZone = zone.length === 5 && zone !== 'Z'
    ? `${zone.slice(0, 3)}:${zone.slice(3)}`
    : zone;
  const isoDate = `${year}-${month}-${day}T${hour}:${minute}:${second}${fraction ? `.${fraction}` : ''}${normalizedZone}`;
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    throw new UnsupportedFormatError(`invalid FileModifyDate value: ${value}`);
  }
  return date;
}

function normalizeWriteTagName(name: string): string {
  const ungrouped = name.toLowerCase().replace(/^-/, '').split(':').at(-1)!;
  return ungrouped === 'keywords' ? 'subject' : ungrouped;
}

export { UnsupportedFormatError };
