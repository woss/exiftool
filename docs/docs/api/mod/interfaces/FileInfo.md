[**@woss/exiftool v0.1.0**](../../README.md)

***

[@woss/exiftool](../../modules.md) / [mod](../README.md) / FileInfo

# Interface: FileInfo

Defined in: [src/types.ts:192](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/types.ts#L192)

File information returned by parse operations.

## Properties

### path

> **path**: `string`

Defined in: [src/types.ts:194](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/types.ts#L194)

Source path or identifier

***

### format

> **format**: `string`

Defined in: [src/types.ts:197](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/types.ts#L197)

Detected format (e.g., "JPEG", "PNG", "AVIF")

***

### tags

> **tags**: `Record`\<`string`, [`TagValue`](../type-aliases/TagValue.md)\>

Defined in: [src/types.ts:200](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/types.ts#L200)

Extracted tags, keyed by tag name

***

### errors?

> `optional` **errors?**: `string`[]

Defined in: [src/types.ts:203](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/types.ts#L203)

Parse errors

***

### warnings?

> `optional` **warnings?**: `string`[]

Defined in: [src/types.ts:206](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/types.ts#L206)

Parse warnings
