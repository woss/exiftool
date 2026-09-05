[**exiftool-ts v0.1.0**](../../README.md)

***

[exiftool-ts](../../modules.md) / [cli](../README.md) / main

# Function: main()

> **main**(`options`, `files`, `input?`): `Promise`\<`number`\>

Defined in: src/cli.ts:175

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
