[**@woss/exiftool v0.1.0**](../../README.md)

***

[@woss/exiftool](../../modules.md) / [cli](../README.md) / main

# Function: main()

> **main**(`options`, `files`, `input?`): `Promise`\<`number`\>

Defined in: [src/cli.ts:184](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/cli.ts#L184)

Process entry: routes to the `-stay_open` daemon or a one-shot run and
yields the process exit code. `input` is injectable for tests.

## Parameters

### options

[`CliOptions`](../interfaces/CliOptions.md)

### files

`string`[]

### input?

`AsyncIterable`\<`Uint8Array`\<`ArrayBufferLike`\>\> = `process.stdin`

## Returns

`Promise`\<`number`\>
