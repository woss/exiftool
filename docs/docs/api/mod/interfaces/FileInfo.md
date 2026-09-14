[**exiftool-ts v0.1.3**](../../README.md)

***

[exiftool-ts](../../modules.md) / [mod](../README.md) / FileInfo

# Interface: FileInfo

Defined in: [src/types.ts:198](https://github.com/woss/exiftool/blob/67919f8602e1b01765df081c4fd4df4684ab9c20/src/types.ts#L198)

File information returned by parse operations.

Memory note: binary tag values (e.g. `ThumbnailImage`) are zero-copy views
into the source file's buffer, so a `FileInfo` keeps that buffer alive as
long as the object (or any of its tag views) is referenced. Let it go out of
scope after extracting what you need, or copy values out (`Uint8Array.prototype.slice()`)
if you must retain them independently of the file bytes.

## Properties

### path

> **path**: `string`

Defined in: [src/types.ts:200](https://github.com/woss/exiftool/blob/67919f8602e1b01765df081c4fd4df4684ab9c20/src/types.ts#L200)

Source path or identifier

***

### format

> **format**: `string`

Defined in: [src/types.ts:203](https://github.com/woss/exiftool/blob/67919f8602e1b01765df081c4fd4df4684ab9c20/src/types.ts#L203)

Detected format (e.g., "JPEG", "PNG", "AVIF")

***

### tags

> **tags**: `Record`\<`string`, [`TagValue`](../type-aliases/TagValue.md)\>

Defined in: [src/types.ts:206](https://github.com/woss/exiftool/blob/67919f8602e1b01765df081c4fd4df4684ab9c20/src/types.ts#L206)

Extracted tags, keyed by tag name

***

### errors?

> `optional` **errors?**: `string`[]

Defined in: [src/types.ts:209](https://github.com/woss/exiftool/blob/67919f8602e1b01765df081c4fd4df4684ab9c20/src/types.ts#L209)

Parse errors

***

### warnings?

> `optional` **warnings?**: `string`[]

Defined in: [src/types.ts:212](https://github.com/woss/exiftool/blob/67919f8602e1b01765df081c4fd4df4684ab9c20/src/types.ts#L212)

Parse warnings
