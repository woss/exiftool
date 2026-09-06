[**@woss/exiftool v0.1.0**](../../README.md)

***

[@woss/exiftool](../../modules.md) / [mod](../README.md) / ParseHints

# Interface: ParseHints

Defined in: [src/format/mod.ts:5](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/format/mod.ts#L5)

Optional per-read hints threaded from the CLI down into parsers.

## Properties

### coordFormat?

> `optional` **coordFormat?**: `string`

Defined in: [src/format/mod.ts:6](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/format/mod.ts#L6)

***

### duplicates?

> `optional` **duplicates?**: `boolean`

Defined in: [src/format/mod.ts:8](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/format/mod.ts#L8)

Keep tags repeated across IFDs (exiftool -a); default suppresses them.
