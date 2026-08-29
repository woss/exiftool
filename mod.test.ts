import { test } from 'vitest';
import { assertEquals } from './src/test/asserts.js';
import { TagDb } from './src/tag-db.js';
import type { TagEntry } from './src/types.js';

test('TagDb basic operations', () => {
  const db = new TagDb();

  const entry: TagEntry = {
    id: 0x010f,
    name: 'Make',
    description: 'Camera make',
    format: 'string',
    writable: true,
    groups: { family0: 'Image', family1: 'EXIF', family2: 'IFD0' },
  };

  db.register(entry);

  assertEquals(db.size(), 1);
  assertEquals(db.getByName('Make'), entry);
  assertEquals(db.getByName('make'), entry);
  assertEquals(db.getById(0x010f, 'EXIF'), entry);
});

test('TagDb getByGroup', () => {
  const db = new TagDb();

  db.register({
    id: 1,
    name: 'Tag1',
    writable: true,
    groups: { family0: 'Image', family1: 'EXIF' },
  });

  db.register({
    id: 2,
    name: 'Tag2',
    writable: false,
    groups: { family0: 'Image', family1: 'XMP' },
  });

  assertEquals(db.getByGroup('EXIF').length, 1);
  assertEquals(db.getByGroup('XMP').length, 1);
  assertEquals(db.getByGroup('Image').length, 2);
});

test('TagDb getWritableTags', () => {
  const db = new TagDb();

  db.register({ id: 1, name: 'Writable', writable: true, groups: {} });
  db.register({ id: 2, name: 'ReadOnly', writable: false, groups: {} });

  assertEquals(db.getWritableTags().length, 1);
  assertEquals(db.getWritableTags()[0].name, 'Writable');
});

test('TagDb getGroups', () => {
  const db = new TagDb();
  db.register({ id: 1, name: 'T1', writable: true, groups: { family1: 'EXIF' } });
  db.register({ id: 2, name: 'T2', writable: true, groups: { family1: 'XMP' } });

  const groups = db.getGroups();
  assertEquals(groups, ['EXIF', 'XMP']);
});

test('TagDb getById without a group and on a miss', () => {
  const db = new TagDb();
  const entry: TagEntry = {
    id: 0x8827,
    name: 'ISO',
    writable: true,
    groups: {},
  };
  db.register(entry);
  assertEquals(db.getById(0x8827), entry);
  assertEquals(db.getById(0x9999), undefined);
  assertEquals(db.getById(0x8827, 'IFD0'), undefined);
});

test('TagDb getByGroup returns an empty array for unknown groups', () => {
  const db = new TagDb();
  db.register({ id: 1, name: 'T', writable: false, groups: { family1: 'EXIF' } });
  assertEquals(db.getByGroup('NoSuchGroup'), []);
});

test('TagDb getAllTags returns every registered entry', () => {
  const db = new TagDb();
  db.register({ id: 1, name: 'A', writable: true, groups: {} });
  db.register({ id: 2, name: 'B', writable: false, groups: {} });

  const all = db.getAllTags().map((t) => t.name).sort();
  assertEquals(all, ['A', 'B']);
});

test('TagDb registerBatch registers many entries at once', () => {
  const db = new TagDb();
  db.registerBatch([
    { id: 1, name: 'One', writable: true, groups: { family1: 'EXIF' } },
    { id: 2, name: 'Two', writable: false, groups: { family1: 'XMP' } },
  ]);

  assertEquals(db.size(), 2);
  assertEquals(db.getByName('one')?.name, 'One');
  assertEquals(db.getByName('two')?.name, 'Two');
});

test('TagDb last registration wins for duplicate names but keeps both ids', () => {
  const db = new TagDb();
  const first: TagEntry = { id: 1, name: 'Dup', writable: true, groups: { family1: 'EXIF' } };
  const second: TagEntry = { id: 2, name: 'Dup', writable: false, groups: { family1: 'EXIF' } };
  db.register(first);
  db.register(second);

  assertEquals(db.size(), 1); // byName is keyed on the lowercase name
  assertEquals(db.getByName('dup'), second);
  assertEquals(db.getById(1, 'EXIF'), first); // both id entries retained, first wins
  assertEquals(db.getById(2, 'EXIF'), second);
});
