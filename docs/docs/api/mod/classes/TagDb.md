[**@woss/exiftool v0.1.0**](../../README.md)

***

[@woss/exiftool](../../modules.md) / [mod](../README.md) / TagDb

# Class: TagDb

Defined in: [src/tag-db.ts:23](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/tag-db.ts#L23)

Tag database for managing tag definitions.
Provides fast lookup by name, ID, or group.
Used by ExifTool for tag normalization and validation.

## Example

```typescript
import { TagDb } from 'exiftool-ts';

const db = new TagDb();
db.register({
  id: 'CustomTag',
  name: 'CustomTag',
  description: 'My custom tag',
  format: 'string',
  writable: true,
  groups: { family0: 'Custom', family1: 'Custom', family2: 'User' },
});
```

## Constructors

### Constructor

> **new TagDb**(): `TagDb`

#### Returns

`TagDb`

## Methods

### register()

> **register**(`entry`): `void`

Defined in: [src/tag-db.ts:34](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/tag-db.ts#L34)

Registers a single tag entry.
Indexes by name (case-insensitive), ID+group, and all group families.

#### Parameters

##### entry

[`TagEntry`](../interfaces/TagEntry.md)

Tag entry to register

#### Returns

`void`

***

### registerBatch()

> **registerBatch**(`entries`): `void`

Defined in: [src/tag-db.ts:55](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/tag-db.ts#L55)

Registers multiple tag entries in batch.

#### Parameters

##### entries

[`TagEntry`](../interfaces/TagEntry.md)[]

Array of tag entries

#### Returns

`void`

***

### getByName()

> **getByName**(`name`): [`TagEntry`](../interfaces/TagEntry.md) \| `undefined`

Defined in: [src/tag-db.ts:67](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/tag-db.ts#L67)

Looks up a tag by normalized name (case-insensitive).

#### Parameters

##### name

`string`

Tag name (e.g., "exposuretime", "Artist")

#### Returns

[`TagEntry`](../interfaces/TagEntry.md) \| `undefined`

Tag entry or undefined

***

### getById()

> **getById**(`id`, `group?`): [`TagEntry`](../interfaces/TagEntry.md) \| `undefined`

Defined in: [src/tag-db.ts:78](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/tag-db.ts#L78)

Looks up a tag by ID within a group.

#### Parameters

##### id

`TagId`

Tag ID (e.g., "ExposureTime", "0x829A")

##### group?

`string`

Optional group name (e.g., "IFD0", "XMP-dc")

#### Returns

[`TagEntry`](../interfaces/TagEntry.md) \| `undefined`

First matching tag entry or undefined

***

### getByGroup()

> **getByGroup**(`group`): [`TagEntry`](../interfaces/TagEntry.md)[]

Defined in: [src/tag-db.ts:90](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/tag-db.ts#L90)

Gets all tags belonging to a group family.

#### Parameters

##### group

`string`

Group name (family 0, 1, or 2)

#### Returns

[`TagEntry`](../interfaces/TagEntry.md)[]

Array of tag entries

***

### getAllTags()

> **getAllTags**(): [`TagEntry`](../interfaces/TagEntry.md)[]

Defined in: [src/tag-db.ts:95](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/tag-db.ts#L95)

Returns all registered tags.

#### Returns

[`TagEntry`](../interfaces/TagEntry.md)[]

***

### getWritableTags()

> **getWritableTags**(): [`TagEntry`](../interfaces/TagEntry.md)[]

Defined in: [src/tag-db.ts:100](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/tag-db.ts#L100)

Returns all writable tags.

#### Returns

[`TagEntry`](../interfaces/TagEntry.md)[]

***

### getGroups()

> **getGroups**(): `string`[]

Defined in: [src/tag-db.ts:105](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/tag-db.ts#L105)

Returns all known group names.

#### Returns

`string`[]

***

### size()

> **size**(): `number`

Defined in: [src/tag-db.ts:110](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/tag-db.ts#L110)

Returns the number of registered tags.

#### Returns

`number`
