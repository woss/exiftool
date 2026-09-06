[**@woss/exiftool v0.1.0**](../../README.md)

***

[@woss/exiftool](../../modules.md) / [cli](../README.md) / runAction

# Function: runAction()

> **runAction**(`options`, ...`files`): `Promise`\<`number`\>

Defined in: [src/cli.ts:33](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/cli.ts#L33)

Runs a single CLI action (read or write) with the given options and files.
This is the core logic used by both `main()` and the `-stay_open` daemon.

## Parameters

### options

[`CliOptions`](../interfaces/CliOptions.md)

Parsed CLI options

### files

...`string`[]

File paths or tag assignments (TAG=VALUE)

## Returns

`Promise`\<`number`\>

Exit code (0 = success, 1 = failure)
