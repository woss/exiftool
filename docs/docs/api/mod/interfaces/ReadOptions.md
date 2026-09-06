[**@woss/exiftool v0.1.0**](../../README.md)

***

[@woss/exiftool](../../modules.md) / [mod](../README.md) / ReadOptions

# Interface: ReadOptions

Defined in: [src/types.ts:112](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/types.ts#L112)

Options for read operations.

## Properties

### duplicates?

> `optional` **duplicates?**: `boolean`

Defined in: [src/types.ts:114](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/types.ts#L114)

Return duplicate tags (default: false)

***

### binary?

> `optional` **binary?**: `boolean`

Defined in: [src/types.ts:117](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/types.ts#L117)

Return binary data as Uint8Array (default: false)

***

### groupHeadings?

> `optional` **groupHeadings?**: `string` \| `number`

Defined in: [src/types.ts:120](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/types.ts#L120)

Group heading style (default: 0)

***

### dateFormat?

> `optional` **dateFormat?**: `string`

Defined in: [src/types.ts:123](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/types.ts#L123)

Date format string (default: "%Y:%m:%d %H:%M:%S")

***

### coordFormat?

> `optional` **coordFormat?**: `string`

Defined in: [src/types.ts:126](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/types.ts#L126)

Coordinate format string (default: "%%.6f")

***

### charset?

> `optional` **charset?**: `string`

Defined in: [src/types.ts:129](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/types.ts#L129)

Character set (default: "UTF8")

***

### lang?

> `optional` **lang?**: `string`

Defined in: [src/types.ts:132](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/types.ts#L132)

Language code (default: "en")

***

### composite?

> `optional` **composite?**: `boolean`

Defined in: [src/types.ts:135](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/types.ts#L135)

Compute composite tags (default: true)

***

### struct?

> `optional` **struct?**: `boolean`

Defined in: [src/types.ts:138](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/types.ts#L138)

Parse XMP structures (default: true)

***

### escapeHTML?

> `optional` **escapeHTML?**: `boolean`

Defined in: [src/types.ts:141](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/types.ts#L141)

Escape HTML entities (default: false)

***

### escapeXML?

> `optional` **escapeXML?**: `boolean`

Defined in: [src/types.ts:144](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/types.ts#L144)

Escape XML entities (default: false)

***

### missingTagValue?

> `optional` **missingTagValue?**: `string`

Defined in: [src/types.ts:147](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/types.ts#L147)

Value for missing tags (default: undefined)
