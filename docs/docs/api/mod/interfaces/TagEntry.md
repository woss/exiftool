[**@woss/exiftool v0.1.0**](../../README.md)

***

[@woss/exiftool](../../modules.md) / [mod](../README.md) / TagEntry

# Interface: TagEntry

Defined in: [src/types.ts:40](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/types.ts#L40)

Complete tag entry with metadata.

## Properties

### id

> **id**: `TagId`

Defined in: [src/types.ts:42](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/types.ts#L42)

Tag ID (string name or numeric IFD tag number)

***

### name

> **name**: `string`

Defined in: [src/types.ts:45](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/types.ts#L45)

Human-readable tag name

***

### description?

> `optional` **description?**: `string`

Defined in: [src/types.ts:48](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/types.ts#L48)

Optional description

***

### format?

> `optional` **format?**: `TagFormat`

Defined in: [src/types.ts:51](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/types.ts#L51)

Tag format type

***

### count?

> `optional` **count?**: `number`

Defined in: [src/types.ts:54](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/types.ts#L54)

Expected count (for arrays)

***

### writable

> **writable**: `boolean`

Defined in: [src/types.ts:57](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/types.ts#L57)

Whether tag is writable

***

### groups

> **groups**: [`TagGroups`](TagGroups.md)

Defined in: [src/types.ts:60](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/types.ts#L60)

Group assignments at different family levels

***

### isList?

> `optional` **isList?**: `boolean`

Defined in: [src/types.ts:63](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/types.ts#L63)

Whether tag is a list/sequence

***

### isMandatory?

> `optional` **isMandatory?**: `boolean`

Defined in: [src/types.ts:66](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/types.ts#L66)

Whether tag is mandatory for the format

***

### isBad?

> `optional` **isBad?**: `boolean`

Defined in: [src/types.ts:69](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/types.ts#L69)

Whether tag indicates a problem (e.g., corrupted data)

***

### values?

> `optional` **values?**: `Record`\<`string` \| `number`, `string`\>

Defined in: [src/types.ts:72](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/types.ts#L72)

Value enumeration (e.g., { 1: "Auto", 2: "Manual" })
