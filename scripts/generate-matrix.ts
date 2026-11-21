import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export type UpstreamMode = 'r' | 'r/w' | 'r/w/c';
export type CellStatus = 'implemented' | 'partial' | 'read-only' | 'unsafe' | 'not-started';
export type CellOp = 'set' | 'delete' | 'copy' | 'create' | 'preserve';

export interface MatrixEntry {
  name: string;
  upstream: UpstreamMode;
  status: CellStatus;
  reason: string | null;
  fixture: string | null;
  test: string | null;
}

export interface CellOverride {
  status: CellStatus;
  reason: string;
  fixture: string | null;
  test: string | null;
}

export interface ParityMatrix {
  version: 1;
  exiftoolVersion: string;
  generatedFrom: string;
  fileTypes: MatrixEntry[];
  families: MatrixEntry[];
  cells: Record<string, CellOverride>;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const README = join(ROOT, 'vendor/exiftool/README');
const MANIFEST = join(ROOT, 'src/tags/generated/manifest.json');
const OUTPUT = join(ROOT, 'docs/write-parity/matrix.json');

const MODE_RE = /^(.*?)\s+(r\/w\/c|r\/w|r)\s*$/;

function parseTable(lines: string[], start: number, end: RegExp): MatrixEntry[] {
  const entries: MatrixEntry[] = [];
  let inTable = false;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!;
    if (end.test(line)) break;
    if (!inTable) {
      if (line.includes('---')) inTable = true;
      continue;
    }
    if (!line.includes('|')) continue;
    for (const cell of line.split('|')) {
      const trimmed = cell.trim();
      if (!trimmed || trimmed === '(and more)') continue;
      const match = trimmed.match(MODE_RE);
      if (!match) continue;
      entries.push({
        name: match[1]!.trim().replace(/\s+/g, ' '),
        upstream: match[2] as UpstreamMode,
        status: match[2] === 'r' ? 'read-only' : 'not-started',
        reason: match[2] === 'r'
          ? 'Upstream read-only (r); not a write-parity target.'
          : null,
        fixture: null,
        test: null,
      });
    }
  }
  return entries;
}

export function parseUpstreamTables(readme: string): { fileTypes: MatrixEntry[]; families: MatrixEntry[] } {
  const lines = readme.split('\n');
  const fileStart = lines.findIndex((l) => l.includes('File Types'));
  const fileTypes = parseTable(lines, fileStart, /Meta Information/);
  const metaStart = lines.findIndex((l) => l.includes('Meta Information'));
  const families = parseTable(lines, metaStart, /See html\//);
  return { fileTypes, families };
}

// Partial cells for adapters that already exist (WRITE_PLAN §Current Container
// Matrix). Key = fileType|family|op. Promote to implemented only with a test.
const PARTIALS: Record<string, CellOverride> = {
  'JPEG|Ducky APP12|set': { status: 'partial', reason: 'Quality/Comment/Copyright only; unknown blocks preserved byte-for-byte.', fixture: null, test: 'src/write/writers.test.ts' },
  'JPEG|EXIF|delete': { status: 'partial', reason: 'Null deletes one targeted tag; update/add/replace modes open (WRITE_PLAN §B).', fixture: null, test: 'src/write/jpeg-merge.test.ts' },
  'JPEG|EXIF|set': { status: 'partial', reason: 'Hand-mapped tags; full writable table and group routing open (WRITE_PLAN §B).', fixture: null, test: 'src/write/jpeg-merge.test.ts' },
  'JPEG|GPS|set': { status: 'partial', reason: 'Partial tag map; negative-coordinate synthesis and group routing open.', fixture: null, test: 'src/write/jpeg-merge.test.ts' },
  'JPEG|ICC Profile|set': { status: 'partial', reason: 'Whole-profile set/delete only; ICC tag editing open (WRITE_PLAN §F).', fixture: null, test: 'src/write/writers.test.ts' },
  'JPEG|IPTC|set': { status: 'partial', reason: 'Generated datasets in APP13 only; multi-container integration open (WRITE_PLAN §C).', fixture: null, test: 'src/write/iptc.test.ts' },
  'JPEG|JFIF|set': { status: 'partial', reason: 'Density set/create only; thumbnails and remaining fields open.', fixture: null, test: 'src/write/writers.test.ts' },
  'JPEG|Photoshop IRB|set': { status: 'partial', reason: 'Scalar resources only; nested/binary resources open (WRITE_PLAN §C).', fixture: null, test: 'src/write/iptc.test.ts' },
  'JPEG|XMP|set': { status: 'partial', reason: 'Registered namespaces only; full schema/struct coverage open (WRITE_PLAN §D).', fixture: null, test: 'src/write/xmp-writer.test.ts' },
  'PNG|EXIF|set': { status: 'partial', reason: 'eXIf merge only; full tag/group coverage open.', fixture: null, test: 'src/write/writers.test.ts' },
  'PNG|ICC Profile|set': { status: 'partial', reason: 'iCCP whole-profile set/delete only.', fixture: null, test: 'src/write/writers.test.ts' },
  'PNG|PNG|set': { status: 'partial', reason: 'tEXt/iTXt/zTXt subset; remaining writable PNG fields open.', fixture: null, test: 'src/write/writers.test.ts' },
  'PNG|XMP|set': { status: 'partial', reason: 'Registered namespaces only (WRITE_PLAN §D).', fixture: null, test: 'src/write/writers.test.ts' },
  'WEBP|EXIF|set': { status: 'partial', reason: 'EXIF merge subset; full semantics open.', fixture: null, test: 'src/write/writers.test.ts' },
  'WEBP|ICC Profile|set': { status: 'partial', reason: 'ICCP whole-profile set/delete only.', fixture: null, test: 'src/write/writers.test.ts' },
  'WEBP|XMP|set': { status: 'partial', reason: 'Partial property set; deletion covered, structured shapes open.', fixture: null, test: 'src/write/writers.test.ts' },
  'AVIF|EXIF|set': { status: 'partial', reason: 'Partial EXIF write; iloc/64-bit handling open (WRITE_PLAN §G).', fixture: null, test: 'src/format/avif.test.ts' },
  'HEIC|EXIF|set': { status: 'partial', reason: 'Partial EXIF write; item/iloc handling open.', fixture: null, test: 'src/format/avif.test.ts' },
  'HEIF|EXIF|set': { status: 'partial', reason: 'Partial EXIF write; item/iloc handling open.', fixture: null, test: 'src/format/avif.test.ts' },
  'GIF|XMP|set': { status: 'partial', reason: 'XMP application extension subset; C2PA delete open.', fixture: null, test: 'src/write/gif.test.ts' },
  'GIF|ICC Profile|set': { status: 'partial', reason: 'ICC application extension subset.', fixture: null, test: 'src/write/gif.test.ts' },
  'TIFF|EXIF|set': { status: 'partial', reason: 'Plain TIFF subset only; camera RAW write is refused (tiff-raw.ts).', fixture: null, test: 'src/write/tiff-merge.test.ts' },
  'TIFF|GPS|set': { status: 'partial', reason: 'Plain TIFF subset only.', fixture: null, test: 'src/write/tiff-merge.test.ts' },
  'EXIF|EXIF|set': { status: 'partial', reason: 'Standalone update subset; create semantics open.', fixture: null, test: 'src/format/exif.test.ts' },
  'EXV|EXIF|set': { status: 'partial', reason: 'Standalone update subset; create semantics open.', fixture: null, test: 'src/format/exv.test.ts' },
  'XMP|XMP|set': { status: 'partial', reason: 'Parser/writer + sidecar subset; namespace/schema parity open.', fixture: null, test: 'src/format/xmp.test.ts' },
  'ICC|ICC Profile|set': { status: 'partial', reason: 'Whole-profile replacement only; tag editing open.', fixture: null, test: 'src/format/icc.test.ts' },
};

export function buildMatrix(readme: string, manifestText: string): ParityMatrix {
  const manifest = JSON.parse(manifestText) as { exiftoolVersion: string };
  if (!manifest.exiftoolVersion) throw new Error('manifest.json missing exiftoolVersion');
  const { fileTypes, families } = parseUpstreamTables(readme);
  if (fileTypes.length === 0 || families.length === 0) throw new Error('README tables produced no entries');
  const cells: Record<string, CellOverride> = {};
  for (const key of Object.keys(PARTIALS).sort()) cells[key] = PARTIALS[key]!;
  return {
    version: 1,
    exiftoolVersion: manifest.exiftoolVersion,
    generatedFrom: 'vendor/exiftool/README + src/tags/generated/manifest.json',
    fileTypes,
    families,
    cells,
  };
}

// Fail loud on anything that would let the matrix lie (§I): implemented
// without a test, partials without a reason, unknown cell dimensions.
export function checkMatrix(matrix: ParityMatrix): string[] {
  const errors: string[] = [];
  const fileTypes = new Set(matrix.fileTypes.map((f) => f.name));
  const families = new Set(matrix.families.map((f) => f.name));
  const ops: CellOp[] = ['set', 'delete', 'copy', 'create', 'preserve'];
  const checkEntry = (entry: MatrixEntry, what: string) => {
    if (entry.status === 'implemented' && !entry.test) errors.push(`${what} ${entry.name}: implemented without test`);
    if ((entry.status === 'partial' || entry.status === 'unsafe') && !entry.reason)
      errors.push(`${what} ${entry.name}: ${entry.status} without reason`);
  };
  matrix.fileTypes.forEach((f) => checkEntry(f, 'fileType'));
  matrix.families.forEach((f) => checkEntry(f, 'family'));
  for (const [key, cell] of Object.entries(matrix.cells)) {
    const [fileType, family, op] = key.split('|');
    if (!fileTypes.has(fileType!)) errors.push(`cell ${key}: unknown fileType`);
    if (!families.has(family!)) errors.push(`cell ${key}: unknown family`);
    if (!ops.includes(op as CellOp)) errors.push(`cell ${key}: unknown op`);
    if (cell.status === 'implemented' && !cell.test) errors.push(`cell ${key}: implemented without test`);
    if (!cell.reason) errors.push(`cell ${key}: missing reason`);
  }
  return errors;
}

export function serializeMatrix(matrix: ParityMatrix): string {
  return `${JSON.stringify(matrix, null, 2)}\n`;
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  const matrix = buildMatrix(readFileSync(README, 'utf8'), readFileSync(MANIFEST, 'utf8'));
  const errors = checkMatrix(matrix);
  if (errors.length) {
    for (const error of errors) console.error(`matrix: ${error}`);
    process.exit(1);
  }
  if (process.argv.includes('--check')) {
    const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : '';
    if (current !== serializeMatrix(matrix)) {
      console.error('matrix.json is stale; run: pnpm generate-matrix');
      process.exit(1);
    }
    console.log(`matrix ok: ${matrix.fileTypes.length} file types, ${matrix.families.length} families, ${Object.keys(matrix.cells).length} cell overrides (ExifTool ${matrix.exiftoolVersion})`);
  } else {
    writeFileSync(OUTPUT, serializeMatrix(matrix));
    console.log(`wrote ${OUTPUT} (ExifTool ${matrix.exiftoolVersion})`);
  }
}
