import { assertEquals } from 'jsr:@std/assert';
import { formatJSON, formatCSV, formatTabular, formatXML, formatDateValue } from './output.ts';
import type { FormatOptions } from './output.ts';
import { TagDb } from '../tag-db.ts';
import type { FileInfo } from '../types.ts';

function makeDb(): TagDb {
  const db = new TagDb();
  db.registerBatch([
    {
      id: 0x010f,
      name: 'Make',
      description: 'Camera make',
      writable: true,
      groups: { family0: 'EXIF', family1: 'EXIF', family2: 'Image', family7: '' },
    },
    {
      id: 0x0110,
      name: 'Model',
      description: 'Camera model',
      writable: true,
      groups: { family0: 'EXIF', family1: 'EXIF', family2: 'Image', family7: '' },
    },
    {
      id: 0xa002,
      name: 'ImageWidth',
      description: 'Image width',
      writable: true,
      groups: { family0: 'EXIF', family1: 'EXIF', family2: 'Image', family7: '' },
    },
    {
      id: 0x0000,
      name: 'FileName',
      description: 'File name',
      writable: false,
      groups: { family0: 'File', family1: 'File', family2: 'File', family7: '' },
    },
    {
      id: 0x0001,
      name: 'FileSize',
      description: 'File size',
      writable: false,
      groups: { family0: 'File', family1: 'File', family2: 'File', family7: '' },
    },
  ]);
  return db;
}

const mockFiles: FileInfo[] = [
  {
    path: 'test.jpg',
    format: 'JPEG',
    tags: {
      FileName: 'test.jpg',
      FileSize: 12345,
      Make: 'Canon',
      Model: 'EOS R5',
      ImageWidth: 8192,
    },
  },
];

Deno.test('formatTabular — no options (backward compat)', () => {
  const result = formatTabular(mockFiles);
  assertEquals(result, 'FileName\ttest.jpg\nFileSize\t12345\nMake\tCanon\nModel\tEOS R5\nImageWidth\t8192');
});

Deno.test('formatTabular — groupHeadings (family 0)', () => {
  const opts: FormatOptions = { groupHeadings: '0', tagDb: makeDb() };
  const result = formatTabular(mockFiles, opts);
  const lines = result.split('\n');
  // Should contain GROUP headers
  assert(lines.some((l) => l.startsWith('------ GROUP:')));
  // File tags should be in the File group
  assert(lines.some((l) => l === '------ GROUP:File ----'));
  // EXIF tags should be in the EXIF group
  assert(lines.some((l) => l === '------ GROUP:EXIF ----'));
  // Tag values should still appear
  assert(lines.some((l) => l.includes('Canon')));
  assert(lines.some((l) => l.includes('test.jpg')));
});

Deno.test('formatTabular — groupPrefix (family 1)', () => {
  const opts: FormatOptions = { groupPrefix: '1', tagDb: makeDb() };
  const result = formatTabular(mockFiles, opts);
  const lines = result.split('\n');
  // Tags should have group prefix
  assert(lines.some((l) => l.startsWith('EXIF:')));
  assert(lines.some((l) => l.startsWith('File:')));
  // Values unchanged
  assert(lines.some((l) => l.includes('Canon')));
});

Deno.test('formatJSON — no options (backward compat)', () => {
  const result = formatJSON(mockFiles);
  const parsed = JSON.parse(result);
  assertEquals(parsed['test.jpg']['Make'], 'Canon');
  assertEquals(parsed['test.jpg']['FileName'], 'test.jpg');
});

Deno.test('formatJSON — groupPrefix (family 1)', () => {
  const opts: FormatOptions = { groupPrefix: '1', tagDb: makeDb() };
  const result = formatJSON(mockFiles, opts);
  const parsed = JSON.parse(result);
  // Keys should be prefixed
  assertEquals(parsed['test.jpg']['EXIF:Make'], 'Canon');
  assertEquals(parsed['test.jpg']['EXIF:Model'], 'EOS R5');
  assertEquals(parsed['test.jpg']['File:FileName'], 'test.jpg');
  // Original keys should NOT exist
  assertEquals(parsed['test.jpg']['Make'], undefined);
});

Deno.test('formatCSV — no options (backward compat)', () => {
  const result = formatCSV(mockFiles);
  assert(result.startsWith('SourceFile'));
  assert(result.includes('Make'));
});

Deno.test('formatCSV — groupPrefix (family 1)', () => {
  const opts: FormatOptions = { groupPrefix: '1', tagDb: makeDb() };
  const result = formatCSV(mockFiles, opts);
  // Header should have prefixed names
  const header = result.split('\n')[0];
  assert(header.includes('EXIF:Make'), `Expected EXIF:Make in header, got: ${header}`);
  assert(header.includes('File:FileName'), `Expected File:FileName in header, got: ${header}`);
  // Values row should have correct data
  const dataRow = result.split('\n')[1];
  assert(dataRow.includes('Canon'));
});

Deno.test('formatXML — no options (backward compat)', () => {
  const result = formatXML(mockFiles);
  assert(result.includes('<tag name="Make">Canon</tag>'));
  assert(result.includes('<tag name="FileName">test.jpg</tag>'));
});

Deno.test('formatXML — groupPrefix (family 1)', () => {
  const opts: FormatOptions = { groupPrefix: '1', tagDb: makeDb() };
  const result = formatXML(mockFiles, opts);
  assert(result.includes('<tag name="EXIF:Make">Canon</tag>'));
  assert(result.includes('<tag name="File:FileName">test.jpg</tag>'));
});

Deno.test('formatTabular — empty tagDb (graceful degradation)', () => {
  const opts: FormatOptions = { groupHeadings: '0', tagDb: undefined };
  const result = formatTabular(mockFiles, opts);
  // Without tagDb, group headings gracefully degrade to flat output
  // (getGroupName returns empty, no headings rendered)
  assert(!result.includes('------ GROUP:'));
  assert(result.includes('Canon'));
  assert(result.includes('Make\tCanon'));
});

Deno.test('formatTabular — both groupHeadings and groupPrefix', () => {
  const opts: FormatOptions = {
    groupHeadings: '0',
    groupPrefix: '1',
    tagDb: makeDb(),
  };
  const result = formatTabular(mockFiles, opts);
  const lines = result.split('\n');
  assert(lines.some((l) => l.startsWith('------ GROUP:File ----')));
  assert(lines.some((l) => l.startsWith('------ GROUP:EXIF ----')));
  // Tag lines should have family 1 prefix (EXIF: for EXIF-group tags)
  const exifLines = lines.filter((l) => l.startsWith('EXIF:'));
  assert(exifLines.length > 0);
});

Deno.test('formatDateValue — matches EXIF date', () => {
  const v = formatDateValue('2025:06:26 10:30:45', '%Y-%m-%d');
  assertEquals(v, '2025-06-26');
});

Deno.test('formatDateValue — non-date string unchanged', () => {
  const v = formatDateValue('Canon', '%Y-%m-%d');
  assertEquals(v, 'Canon');
});

Deno.test('formatDateValue — subseconds preserved', () => {
  const v = formatDateValue('2025:06:26 10:30:45.123', '%Y-%m-%d %H:%M:%S.%f');
  assertEquals(v, '2025-06-26 10:30:45.123');
});

Deno.test('formatTabular — with dateFormat formats dates', () => {
  const opts: FormatOptions = { dateFormat: '%Y-%m-%d' };
  const files: FileInfo[] = [{
    path: 'test.jpg',
    format: 'JPEG',
    tags: {
      DateTimeOriginal: '2025:06:26 10:30:45',
      Make: 'Canon',
    },
  }];
  const result = formatTabular(files, opts);
  assert(result.includes('DateTimeOriginal\t2025-06-26'));
  assert(result.includes('Make\tCanon'));
});

Deno.test('formatJSON — with dateFormat formats dates', () => {
  const opts: FormatOptions = { dateFormat: '%Y-%m-%d' };
  const files: FileInfo[] = [{
    path: 'test.jpg',
    format: 'JPEG',
    tags: {
      DateTimeOriginal: '2025:06:26 10:30:45',
      Make: 'Canon',
    },
  }];
  const result = formatJSON(files, opts);
  const parsed = JSON.parse(result);
  assertEquals(parsed['test.jpg']['DateTimeOriginal'], '2025-06-26');
  assertEquals(parsed['test.jpg']['Make'], 'Canon');
});

function assert(condition: boolean, msg?: string): void {
  if (!condition) throw new Error(msg || 'Assertion failed');
}
