[**@woss/exiftool v0.1.0**](../../README.md)

***

[@woss/exiftool](../../modules.md) / [mod](../README.md) / WriteResult

# Interface: WriteResult

Defined in: [src/types.ts:164](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/types.ts#L164)

Result of a write operation.

## Properties

### file

> **file**: `string`

Defined in: [src/types.ts:166](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/types.ts#L166)

Path to written file

***

### written

> **written**: `string`[]

Defined in: [src/types.ts:169](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/types.ts#L169)

Successfully written tag names

***

### skipped

> **skipped**: `string`[]

Defined in: [src/types.ts:172](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/types.ts#L172)

Skipped tag names (unsupported/read-only)

***

### backup?

> `optional` **backup?**: `string`

Defined in: [src/types.ts:175](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/types.ts#L175)

Backup file path if created
