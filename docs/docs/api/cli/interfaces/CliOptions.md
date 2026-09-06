[**@woss/exiftool v0.1.0**](../../README.md)

***

[@woss/exiftool](../../modules.md) / [cli](../README.md) / CliOptions

# Interface: CliOptions

Defined in: [src/cli/args.ts:10](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/cli/args.ts#L10)

ExifTool-style command-line parsing.

`parseCliArgs` consumes tokens already normalized by `normalizeArgs`
(ExifTool single-dash long forms mapped onto `--long`). Unknown dash-tokens
fall through as operands so `-TAG=VALUE` write assignments reach runAction
untouched, mirroring the real ExifTool CLI.

## Properties

### json?

> `optional` **json?**: `boolean`

Defined in: [src/cli/args.ts:11](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/cli/args.ts#L11)

***

### csv?

> `optional` **csv?**: `boolean`

Defined in: [src/cli/args.ts:12](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/cli/args.ts#L12)

***

### xml?

> `optional` **xml?**: `boolean`

Defined in: [src/cli/args.ts:13](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/cli/args.ts#L13)

***

### binary?

> `optional` **binary?**: `boolean`

Defined in: [src/cli/args.ts:14](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/cli/args.ts#L14)

***

### dateFormat?

> `optional` **dateFormat?**: `string`

Defined in: [src/cli/args.ts:15](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/cli/args.ts#L15)

***

### groupHeadings?

> `optional` **groupHeadings?**: `string` \| `boolean`

Defined in: [src/cli/args.ts:16](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/cli/args.ts#L16)

***

### groupPrefix?

> `optional` **groupPrefix?**: `string` \| `boolean`

Defined in: [src/cli/args.ts:17](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/cli/args.ts#L17)

***

### coordFormat?

> `optional` **coordFormat?**: `string`

Defined in: [src/cli/args.ts:18](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/cli/args.ts#L18)

***

### if?

> `optional` **if?**: `string`[]

Defined in: [src/cli/args.ts:19](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/cli/args.ts#L19)

***

### verbose?

> `optional` **verbose?**: `unknown`[]

Defined in: [src/cli/args.ts:20](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/cli/args.ts#L20)

***

### quiet?

> `optional` **quiet?**: `unknown`[]

Defined in: [src/cli/args.ts:21](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/cli/args.ts#L21)

***

### recurse?

> `optional` **recurse?**: `boolean`

Defined in: [src/cli/args.ts:22](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/cli/args.ts#L22)

***

### extension?

> `optional` **extension?**: `string`[]

Defined in: [src/cli/args.ts:23](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/cli/args.ts#L23)

***

### ignore?

> `optional` **ignore?**: `string`[]

Defined in: [src/cli/args.ts:24](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/cli/args.ts#L24)

***

### output?

> `optional` **output?**: `string`

Defined in: [src/cli/args.ts:25](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/cli/args.ts#L25)

***

### extractEmbedded?

> `optional` **extractEmbedded?**: `boolean`

Defined in: [src/cli/args.ts:26](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/cli/args.ts#L26)

***

### overwriteOriginal?

> `optional` **overwriteOriginal?**: `boolean`

Defined in: [src/cli/args.ts:27](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/cli/args.ts#L27)

***

### stayOpen?

> `optional` **stayOpen?**: `string` \| `boolean`

Defined in: [src/cli/args.ts:28](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/cli/args.ts#L28)

***

### help?

> `optional` **help?**: `boolean`

Defined in: [src/cli/args.ts:29](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/cli/args.ts#L29)

***

### version?

> `optional` **version?**: `boolean`

Defined in: [src/cli/args.ts:30](https://github.com/woss/exiftool/blob/8010b391b1624473b092fd34b6fdf88658ffb8e7/src/cli/args.ts#L30)
