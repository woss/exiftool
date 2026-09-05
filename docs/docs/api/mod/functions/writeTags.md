[**exiftool-ts v0.1.0**](../../README.md)

***

[exiftool-ts](../../modules.md) / [mod](../README.md) / writeTags

# Function: writeTags()

> **writeTags**(`filePath`, `tags`, `opts?`, `plugins?`): `Promise`\<[`WriteResult`](../interfaces/WriteResult.md)\>

Defined in: src/write/pipeline.ts:21

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
