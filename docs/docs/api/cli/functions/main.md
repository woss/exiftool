[**exiftool-ts v0.1.3**](../../README.md)

***

[exiftool-ts](../../modules.md) / [cli](../README.md) / main

# Function: main()

> **main**(`options`, `files`, `input?`): `Promise`\<`number`\>

Defined in: [src/cli.ts:184](https://github.com/woss/exiftool/blob/67919f8602e1b01765df081c4fd4df4684ab9c20/src/cli.ts#L184)

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
