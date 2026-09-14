[**exiftool-ts v0.1.3**](../../README.md)

***

[exiftool-ts](../../modules.md) / [mod](../README.md) / WriteResult

# Interface: WriteResult

Defined in: [src/types.ts:164](https://github.com/woss/exiftool/blob/67919f8602e1b01765df081c4fd4df4684ab9c20/src/types.ts#L164)

Result of a write operation.

## Properties

### file

> **file**: `string`

Defined in: [src/types.ts:166](https://github.com/woss/exiftool/blob/67919f8602e1b01765df081c4fd4df4684ab9c20/src/types.ts#L166)

Path to written file

***

### written

> **written**: `string`[]

Defined in: [src/types.ts:169](https://github.com/woss/exiftool/blob/67919f8602e1b01765df081c4fd4df4684ab9c20/src/types.ts#L169)

Successfully written tag names

***

### skipped

> **skipped**: `string`[]

Defined in: [src/types.ts:172](https://github.com/woss/exiftool/blob/67919f8602e1b01765df081c4fd4df4684ab9c20/src/types.ts#L172)

Skipped tag names (unsupported/read-only)

***

### backup?

> `optional` **backup?**: `string`

Defined in: [src/types.ts:175](https://github.com/woss/exiftool/blob/67919f8602e1b01765df081c4fd4df4684ab9c20/src/types.ts#L175)

Backup file path if created
