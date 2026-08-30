import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

// Run from repo root after `pnpm build`: node dist-independent, uses dist/cli.js.
const KNOWN = new Set([
  'FileModificationDate',
  'FileAccessDate',
  'FileModifyDate',
  'FileInodeChangeDate',
  'ApplicationRecordVersion',
  'HyperfocalDistance',
  'ApproximateFocusDistance',
  'LensID',
  'FlashCompensation',
  'ScaleFactor35efl',
  'SubSecCreateDate',
  'DateCreated',
]);

const files = readdirSync('assets').map((f) => `assets/${f}`);
let totalNew = 0;
let totalAllow = 0;
let totalShared = 0;
let filesWithNew = 0;

for (const file of files) {
  let ref: Record<string, unknown>;
  try {
    ref = JSON.parse(execFileSync('exiftool', ['-j', file]).toString())[0];
  } catch {
    console.log(`${file}: exiftool could not read — skipped`);
    continue;
  }
  let oursRaw: string;
  try {
    oursRaw = execFileSync('node', ['dist/cli.js', file, '-j']).toString();
  } catch (e) {
    console.log(`${file}: exiftool-ts CLI FAILED: ${(e as Error).message.slice(0, 120)}`);
    continue;
  }
  const ours = JSON.parse(oursRaw)[0] as Record<string, unknown>;

  const refKeys = new Set(Object.keys(ref));
  const ourKeys = new Set(Object.keys(ours));
  const shared = [...refKeys].filter((k) => ourKeys.has(k));
  const allow: string[] = [];
  const now: string[] = [];
  for (const k of shared) {
    if (String(ref[k]) === String(ours[k])) continue;
    if (KNOWN.has(k)) allow.push(k);
    else now.push(`${k}: ref=${JSON.stringify(String(ref[k]).slice(0, 40))} ours=${JSON.stringify(String(ours[k]).slice(0, 40))}`);
  }
  const refOnly = [...refKeys].filter((k) => !ourKeys.has(k));
  const ourOnly = [...ourKeys].filter((k) => !refKeys.has(k));

  totalShared += shared.length;
  totalAllow += allow.length;
  totalNew += now.length;
  if (now.length > 0) filesWithNew++;

  console.log(`\n=== ${file} (${shared.length} shared) ===`);
  if (allow.length) console.log(`  allowlisted divergences (${allow.length}): ${allow.join(', ')}`);
  if (now.length) {
    console.log(`  NEW divergences (${now.length}):`);
    for (const d of now) console.log(`    - ${d}`);
  }
  if (refOnly.length) console.log(`  ref-only tags (${refOnly.length}): ${refOnly.join(', ')}`);
  if (ourOnly.length) console.log(`  ours-only tags (${ourOnly.length}): ${ourOnly.join(', ')}`);
}

console.log(`\n=== TOTALS: ${files.length} files | shared ${totalShared} | allowlisted ${totalAllow} | NEW ${totalNew} | files with new divergences: ${filesWithNew} ===`);
