import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Unique temporary file path (empty file created), mirroring Deno.makeTempFile. */
export async function tempFile(suffix = ''): Promise<string> {
  const file = join(tmpdir(), `exiftool-ts-${randomBytes(6).toString('hex')}${suffix}`);
  await writeFile(file, '');
  return file;
}

