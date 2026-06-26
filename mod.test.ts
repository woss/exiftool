import { assertEquals } from './deps.ts';
import { TagDb } from './src/tag-db.ts';
import type { TagEntry } from './src/types.ts';

Deno.test('TagDb basic operations', () => {
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

Deno.test('TagDb getByGroup', () => {
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

Deno.test('TagDb getWritableTags', () => {
  const db = new TagDb();

  db.register({ id: 1, name: 'Writable', writable: true, groups: {} });
  db.register({ id: 2, name: 'ReadOnly', writable: false, groups: {} });

  assertEquals(db.getWritableTags().length, 1);
  assertEquals(db.getWritableTags()[0].name, 'Writable');
});

Deno.test('TagDb getGroups', () => {
  const db = new TagDb();
  db.register({ id: 1, name: 'T1', writable: true, groups: { family1: 'EXIF' } });
  db.register({ id: 2, name: 'T2', writable: true, groups: { family1: 'XMP' } });

  const groups = db.getGroups();
  assertEquals(groups, ['EXIF', 'XMP']);
});
