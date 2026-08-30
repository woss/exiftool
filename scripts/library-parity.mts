import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

// Library parity sweep: compares exiftool-ts (dist CLI) against exiftool for
// every JPEG in the given directory. Aggregates divergences by tag name.
const dir = process.argv[2] ?? process.env.HOME + '/Pictures/woss-photo';

const KNOWN = new Set([
  'FileModificationDate', 'FileAccessDate', 'FileModifyDate', 'FileInodeChangeDate',
  'ApplicationRecordVersion', 'HyperfocalDistance', 'ApproximateFocusDistance',
  'LensID', 'FlashCompensation', 'ScaleFactor35efl', 'SubSecCreateDate', 'DateCreated',
]);

const files = readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f)).map((f) => join(dir, f));
const tagCounts = new Map<string, number>();
const tagSamples = new Map<string, { ref: string; ours: string }>();
let unreadable = 0;
let okFiles = 0;
let totalShared = 0;
let totalAllow = 0;
let totalNew = 0;

for (const file of files) {
  let ref: Record<string, unknown>;
  let oursRaw: string;
  try {
    ref = JSON.parse(execFileSync('exiftool', ['-j', file]).toString())[0];
  } catch {
    unreadable++;
    continue;
  }
  try {
    oursRaw = execFileSync('node', ['dist/cli.js', file, '-j']).toString();
  } catch {
    console.log(`CLI FAILED: ${file}`);
    unreadable++;
    continue;
  }
  okFiles++;
  const ours = JSON.parse(oursRaw)[0] as Record<string, unknown>;
  const refKeys = new Set(Object.keys(ref));
  const ourKeys = new Set(Object.keys(ours));
  totalShared += [...refKeys].filter((k) => ourKeys.has(k)).length;

  for (const k of refKeys) {
    if (!ourKeys.has(k)) continue;
    const refStr = String(ref[k]);
    const ourStr = String(ours[k]);
    if (refStr === ourStr) continue;
    if (KNOWN.has(k)) { totalAllow++; continue; }
    totalNew++;
    tagCounts.set(k, (tagCounts.get(k) ?? 0) + 1);
    if (!tagSamples.has(k)) tagSamples.set(k, { ref: refStr.slice(0, 60), ours: ourStr.slice(0, 60) });
  }
  for (const k of refKeys) {
    if (ourKeys.has(k)) continue;
    tagCounts.set('MISSING:' + k, (tagCounts.get('MISSING:' + k) ?? 0) + 1);
    if (!tagSamples.has('MISSING:' + k)) tagSamples.set('MISSING:' + k, { ref: String(ref[k]).slice(0, 60), ours: '(absent)' });
  }
}

console.log(`files: ${files.length} | ok: ${okFiles} | unreadable/failed: ${unreadable}`);
console.log(`shared tag comparisons: ${totalShared} | allowlisted divergences: ${totalAllow} | NEW: ${totalNew}\n`);
console.log('Divergences by tag (count of files affected):');
const sorted = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);
for (const [tag, count] of sorted) {
  const sample = tagSamples.get(tag)!;
  console.log(`  ${String(count).padStart(3)}  ${tag}\n      ref:  ${JSON.stringify(sample.ref)}\n      ours: ${JSON.stringify(sample.ours)}`);
}
