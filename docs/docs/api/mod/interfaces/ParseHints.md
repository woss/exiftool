[**exiftool-ts v0.1.3**](../../README.md)

***

[exiftool-ts](../../modules.md) / [mod](../README.md) / ParseHints

# Interface: ParseHints

Defined in: [src/format/mod.ts:5](https://github.com/woss/exiftool/blob/67919f8602e1b01765df081c4fd4df4684ab9c20/src/format/mod.ts#L5)

Optional per-read hints threaded from the CLI down into parsers.

## Properties

### coordFormat?

> `optional` **coordFormat?**: `string`

Defined in: [src/format/mod.ts:6](https://github.com/woss/exiftool/blob/67919f8602e1b01765df081c4fd4df4684ab9c20/src/format/mod.ts#L6)

***

### duplicates?

> `optional` **duplicates?**: `boolean`

Defined in: [src/format/mod.ts:8](https://github.com/woss/exiftool/blob/67919f8602e1b01765df081c4fd4df4684ab9c20/src/format/mod.ts#L8)

Keep tags repeated across IFDs (exiftool -a); default suppresses them.
