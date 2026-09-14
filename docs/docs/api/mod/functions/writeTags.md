[**exiftool-ts v0.1.3**](../../README.md)

***

[exiftool-ts](../../modules.md) / [mod](../README.md) / writeTags

# Function: writeTags()

> **writeTags**(`filePath`, `tags`, `opts?`, `plugins?`): `Promise`\<[`WriteResult`](../interfaces/WriteResult.md)\>

Defined in: [src/write/pipeline.ts:21](https://github.com/woss/exiftool/blob/67919f8602e1b01765df081c4fd4df4684ab9c20/src/write/pipeline.ts#L21)

Safe-overwrite pipeline: parse-checks the target, produces new bytes via
the format writer, preserves a `<file>_original` backup unless
suppressed, and swaps atomically through a temp file in the same
directory. On any producer failure the original file is untouched.

## Parameters

### filePath

`string`

### tags

`Record`\<`string`, [`TagValue`](../type-aliases/TagValue.md)\>

### opts?

[`WriteOptions`](../interfaces/WriteOptions.md) = `{}`

### plugins?

`FormatParser`[]

## Returns

`Promise`\<[`WriteResult`](../interfaces/WriteResult.md)\>
