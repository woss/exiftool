[**exiftool-ts v0.1.0**](../../README.md)

***

[exiftool-ts](../../modules.md) / [cli](../README.md) / CliOptions

# Interface: CliOptions

Defined in: src/cli/args.ts:10

ExifTool-style command-line parsing.

`parseCliArgs` consumes tokens already normalized by `normalizeArgs`
(ExifTool single-dash long forms mapped onto `--long`). Unknown dash-tokens
fall through as operands so `-TAG=VALUE` write assignments reach runAction
untouched, mirroring the real ExifTool CLI.

## Properties

### json?

> `optional` **json?**: `boolean`

Defined in: src/cli/args.ts:11

***

### csv?

> `optional` **csv?**: `boolean`

Defined in: src/cli/args.ts:12

***

### xml?

> `optional` **xml?**: `boolean`

Defined in: src/cli/args.ts:13

***

### binary?

> `optional` **binary?**: `boolean`

Defined in: src/cli/args.ts:14

***

### dateFormat?

> `optional` **dateFormat?**: `string`

Defined in: src/cli/args.ts:15

***

### groupHeadings?

> `optional` **groupHeadings?**: `string` \| `boolean`

Defined in: src/cli/args.ts:16

***

### groupPrefix?

> `optional` **groupPrefix?**: `string` \| `boolean`

Defined in: src/cli/args.ts:17

***

### coordFormat?

> `optional` **coordFormat?**: `string`

Defined in: src/cli/args.ts:18

***

### if?

> `optional` **if?**: `string`[]

Defined in: src/cli/args.ts:19

***

### verbose?

> `optional` **verbose?**: `unknown`[]

Defined in: src/cli/args.ts:20

***

### quiet?

> `optional` **quiet?**: `unknown`[]

Defined in: src/cli/args.ts:21

***

### recurse?

> `optional` **recurse?**: `boolean`

Defined in: src/cli/args.ts:22

***

### extension?

> `optional` **extension?**: `string`[]

Defined in: src/cli/args.ts:23

***

### ignore?

> `optional` **ignore?**: `string`[]

Defined in: src/cli/args.ts:24

***

### output?

> `optional` **output?**: `string`

Defined in: src/cli/args.ts:25

***

### extractEmbedded?

> `optional` **extractEmbedded?**: `boolean`

Defined in: src/cli/args.ts:26

***

### overwriteOriginal?

> `optional` **overwriteOriginal?**: `boolean`

Defined in: src/cli/args.ts:27

***

### stayOpen?

> `optional` **stayOpen?**: `string` \| `boolean`

Defined in: src/cli/args.ts:28

***

### help?

> `optional` **help?**: `boolean`

Defined in: src/cli/args.ts:29

***

### version?

> `optional` **version?**: `boolean`

Defined in: src/cli/args.ts:30
