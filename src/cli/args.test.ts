import { test } from 'vitest';
import { assertEquals } from '../test/asserts.js';
import { normalizeArgs, parseCliArgs } from './args.js';

test('parseCliArgs — boolean long and short flags', () => {
  assertEquals(parseCliArgs(['--json', '-b', 'a.jpg']), {
    options: { json: true, binary: true },
    files: ['a.jpg'],
  });
});

test('parseCliArgs — ExifTool -z enables write compression', () => {
  assertEquals(parseCliArgs(normalizeArgs(['-z'])), {
    options: { compress: true },
    files: [],
  });
});

test('parseCliArgs — -wm accepts a mode value', () => {
  assertEquals(parseCliArgs(normalizeArgs(['-wm', 'cg'])).options.writeMode, 'cg');
});

test('parseCliArgs — -wm rejects unsupported mode letters', () => {
  let message = '';
  try {
    parseCliArgs(normalizeArgs(['-wm', 'wx']));
  } catch (error) {
    message = (error as Error).message;
  }
  assertEquals(message.includes('Invalid argument for --write-mode'), true);
});

test('parseCliArgs — preserve-time accepts ExifTool -P and long form', () => {
  assertEquals(parseCliArgs(['-P']).options.preserveTime, true);
  assertEquals(parseCliArgs(['--preserve-time']).options.preserveTime, true);
});

test('parseCliArgs — overwrite-original-in-place is accepted', () => {
  assertEquals(parseCliArgs(['--overwrite-original-in-place']).options.overwriteOriginalInPlace, true);
  assertEquals(parseCliArgs(['-overwrite_original_in_place']).options.overwriteOriginalInPlace, true);
});

test('parseCliArgs — values via space and inline equals', () => {
  assertEquals(parseCliArgs(['-d', '%Y', '--coord-format=%+.6f', 'x.jpg']), {
    options: { dateFormat: '%Y', coordFormat: '%+.6f' },
    files: ['x.jpg'],
  });
});

test('parseCliArgs — tagsFromFile uses ExifTool spelling', () => {
  assertEquals(normalizeArgs(['-tagsFromFile', 'source.jpg']), ['--tags-from-file', 'source.jpg']);
  assertEquals(parseCliArgs(['--tags-from-file', 'source.jpg']), {
    options: {
      tagsFromFile: 'source.jpg',
      tagsFromFileRequests: [{ source: 'source.jpg', selectors: [], mappings: [] }],
    },
    files: [],
  });
});

test('parseCliArgs — repeated tagsFromFile options retain source order', () => {
  assertEquals(
    parseCliArgs(normalizeArgs(['-tagsFromFile', 'first.jpg', '-tagsFromFile', 'second.jpg'])),
    {
      options: {
        tagsFromFile: ['first.jpg', 'second.jpg'],
        tagsFromFileRequests: [
          { source: 'first.jpg', selectors: [], mappings: [] },
          { source: 'second.jpg', selectors: [], mappings: [] },
        ],
      },
      files: [],
    },
  );
});

test('parseCliArgs — srcfile candidates retain source order', () => {
  assertEquals(
    parseCliArgs(normalizeArgs([
      '-srcfile', '%d%f.jpg', '-srcfile', '%d%f.xmp', 'target.nef',
    ])),
    {
      options: { srcFile: ['%d%f.jpg', '%d%f.xmp'] },
      files: ['target.nef'],
    },
  );
});

test('parseCliArgs — source tag selectors stay attached to their source occurrence', () => {
  assertEquals(
    parseCliArgs(normalizeArgs([
      '-tagsFromFile', 'first.jpg', '-Make',
      '-tagsFromFile', 'second.jpg', '-Model', 'target.jpg',
    ])),
    {
      options: {
        tagsFromFile: ['first.jpg', 'second.jpg'],
        tagsFromFileRequests: [
          { source: 'first.jpg', selectors: ['-Make'], mappings: [] },
          { source: 'second.jpg', selectors: ['-Model'], mappings: [] },
        ],
      },
      files: ['target.jpg'],
    },
  );
});

test('parseCliArgs preserves XMP-qualified tag selectors beginning with -X', () => {
  assertEquals(
    parseCliArgs(normalizeArgs([
      '-tagsFromFile', 'source.jpg', '-XMP-dc:Subject', 'target.jpg',
    ])),
    {
      options: {
        tagsFromFile: 'source.jpg',
        tagsFromFileRequests: [{
          source: 'source.jpg',
          selectors: ['-XMP-dc:Subject'],
          mappings: [],
        }],
      },
      files: ['target.jpg'],
    },
  );
});

test('parseCliArgs — tag redirects attach to the active tagsFromFile source', () => {
  assertEquals(
    parseCliArgs(normalizeArgs([
      '-tagsFromFile', 'source.jpg', '-Model<Make', 'target.jpg',
    ])),
    {
      options: {
        tagsFromFile: 'source.jpg',
        tagsFromFileRequests: [{
          source: 'source.jpg',
          selectors: [],
          mappings: [{ destination: 'Model', source: 'Make' }],
        }],
      },
      files: ['target.jpg'],
    },
  );
});

test('parseCliArgs — collect options repeat into arrays', () => {
  const { options } = parseCliArgs(['-v', '-v', '--if', '$A eq 1', '--if', '$B eq 2']);
  assertEquals(options.verbose, [true, true]);
  assertEquals(options.if, ['$A eq 1', '$B eq 2']);
});

test('parseCliArgs — kebab-case long names map to camelCase keys', () => {
  assertEquals(parseCliArgs(['--group-headings', '3', '--overwrite-original']), {
    options: { groupHeadings: '3', overwriteOriginal: true },
    files: [],
  });
});

test('parseCliArgs — stay-open bare, valued, and inline False', () => {
  assertEquals(parseCliArgs(['--stay-open']).options.stayOpen, true);
  assertEquals(parseCliArgs(['--stay-open', 'True', 'f.jpg']).options.stayOpen, 'True');
  assertEquals(parseCliArgs(['--stay-open=False']).options.stayOpen, 'False');
});

test('parseCliArgs — bare stay-open does not consume a following flag', () => {
  const { options, files } = parseCliArgs(['--stay-open', '-j', 'f.jpg']);
  assertEquals(options.stayOpen, true);
  assertEquals(options.json, true);
  assertEquals(files, ['f.jpg']);
});

test('parseCliArgs — -- terminator treats the rest as operands', () => {
  assertEquals(parseCliArgs(['-j', '--', '-weird.jpg', '--json']), {
    options: { json: true },
    files: ['-weird.jpg', '--json'],
  });
});

test('parseCliArgs — unknown dash-tokens become operands (write assignments)', () => {
  assertEquals(parseCliArgs(['-Artist=me', 'p.jpg']), {
    options: {},
    files: ['-Artist=me', 'p.jpg'],
  });
});

test('normalizeArgs — bare and grouped list assignments remain operands', () => {
  assertEquals(normalizeArgs(['-Keywords+=bird', '-XMP-dc:Subject+=lake', '-XMP-dc:Subject-=lake']), [
    '-Keywords+=bird',
    '-XMP-dc:Subject+=lake',
    '-XMP-dc:Subject-=lake',
  ]);
});

test('parseCliArgs — value option missing its operand throws', () => {
  let threw = false;
  try {
    parseCliArgs(['--output']);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

test('parseCliArgs — flag with an inline value throws', () => {
  let threw = false;
  try {
    parseCliArgs(['--json=true']);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

test('parseCliArgs — absolute paths are operands even when the second char names a short flag', () => {
  assertEquals(parseCliArgs(['-Artist=smoke', '/var/folders/x/in.jpg']), {
    options: {},
    files: ['-Artist=smoke', '/var/folders/x/in.jpg'],
  });
});

test('parseCliArgs — -h and --help set the help flag', () => {
  assertEquals(parseCliArgs(['-h']).options.help, true);
  assertEquals(parseCliArgs(['--help']).options.help, true);
  assertEquals(parseCliArgs(['-h', 'photo.jpg']), {
    options: { help: true },
    files: ['photo.jpg'],
  });
});
