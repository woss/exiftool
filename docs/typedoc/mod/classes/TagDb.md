[**exiftool-ts v0.1.0**](../../README.md)

***

[exiftool-ts](../../modules.md) / [mod](../README.md) / TagDb

# Class: TagDb

Defined in: src/tag-db.ts:3

## Constructors

### Constructor

> **new TagDb**(): `TagDb`

#### Returns

`TagDb`

## Methods

### register()

> **register**(`entry`): `void`

Defined in: src/tag-db.ts:8

#### Parameters

##### entry

[`TagEntry`](../interfaces/TagEntry.md)

#### Returns

`void`

***

### registerBatch()

> **registerBatch**(`entries`): `void`

Defined in: src/tag-db.ts:24

#### Parameters

##### entries

[`TagEntry`](../interfaces/TagEntry.md)[]

#### Returns

`void`

***

### getByName()

> **getByName**(`name`): [`TagEntry`](../interfaces/TagEntry.md) \| `undefined`

Defined in: src/tag-db.ts:30

#### Parameters

##### name

`string`

#### Returns

[`TagEntry`](../interfaces/TagEntry.md) \| `undefined`

***

### getById()

> **getById**(`id`, `group?`): [`TagEntry`](../interfaces/TagEntry.md) \| `undefined`

Defined in: src/tag-db.ts:34

#### Parameters

##### id

`TagId`

##### group?

`string`

#### Returns

[`TagEntry`](../interfaces/TagEntry.md) \| `undefined`

***

### getByGroup()

> **getByGroup**(`group`): [`TagEntry`](../interfaces/TagEntry.md)[]

Defined in: src/tag-db.ts:40

#### Parameters

##### group

`string`

#### Returns

[`TagEntry`](../interfaces/TagEntry.md)[]

***

### getAllTags()

> **getAllTags**(): [`TagEntry`](../interfaces/TagEntry.md)[]

Defined in: src/tag-db.ts:44

#### Returns

[`TagEntry`](../interfaces/TagEntry.md)[]

***

### getWritableTags()

> **getWritableTags**(): [`TagEntry`](../interfaces/TagEntry.md)[]

Defined in: src/tag-db.ts:48

#### Returns

[`TagEntry`](../interfaces/TagEntry.md)[]

***

### getGroups()

> **getGroups**(): `string`[]

Defined in: src/tag-db.ts:52

#### Returns

`string`[]

***

### size()

> **size**(): `number`

Defined in: src/tag-db.ts:56

#### Returns

`number`
