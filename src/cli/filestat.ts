import { stat } from 'node:fs/promises';
import type { TagValue } from '../types.js';

/** Formats a byte count the way exiftool renders FileSize. */
export function formatFileSize(size: number): string {
  if (size >= 1048576) return `${Number((size / 1000000).toPrecision(2))} MB`;
  if (size >= 1024) return `${Math.round(size / 1000)} kB`;
  return `${size} B`;
}

/** Formats a timestamp as exiftool's `YYYY:MM:DD HH:MM:SS`. */
export function formatFileDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Formats POSIX mode bits as `-rw-r--r--`-style permission string. */
export function formatFilePermissions(mode: number): string {
  const perms = (mode & 0o777).toString(8).padStart(3, '0');
  const bit = (mask: number, ch: string) => (mode & mask ? ch : '-');
  const [ur, uw, ux] = [0o400, 0o200, 0o100];
  const [gr, gw, gx] = [0o040, 0o020, 0o010];
  const [or, ow, ox] = [0o004, 0o002, 0o001];
  return [
    bit(0o40000, 'd') || '-',
    bit(ur, 'r'), bit(uw, 'w'), bit(ux, 'x'),
    bit(gr, 'r'), bit(gw, 'w'), bit(gx, 'x'),
    bit(or, 'r'), bit(ow, 'w'), bit(ox, 'x'),
  ].join('');
}

/**
 * Overlays file-system-derived tags (FileSize, FileModifyDate,
 * FilePermissions, …) onto parsed output. Belongs to the caller that owns
 * the file path — parsers stay pure byte processors. Stat failures are
 * silently ignored, matching the previous parser-side behaviour.
 */
export async function applyFileStat(
  tags: Record<string, TagValue>,
  filePath: string,
): Promise<void> {
  let statInfo;
  try {
    statInfo = await stat(filePath);
  } catch {
    return;
  }
  const tz = localTz(new Date(statInfo.mtime));
  tags['FileSize'] = formatFileSize(statInfo.size);
  tags['FileModifyDate'] = formatFileDate(new Date(statInfo.mtime)) + tz;
  tags['FileAccessDate'] = formatFileDate(new Date(statInfo.atime)) + tz;
  tags['FileInodeChangeDate'] = formatFileDate(new Date(statInfo.ctime || statInfo.birthtime)) + tz;
  tags['FilePermissions'] = formatFilePermissions(statInfo.mode);
}

/** Local UTC offset as +HH:MM / -HH:MM (exiftool appends it to file dates). */
function localTz(d: Date): string {
  const total = -d.getTimezoneOffset();
  const sign = total >= 0 ? '+' : '-';
  const abs = Math.abs(total);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
