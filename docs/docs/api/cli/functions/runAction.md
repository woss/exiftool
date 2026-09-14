[**exiftool-ts v0.1.3**](../../README.md)

***

[exiftool-ts](../../modules.md) / [cli](../README.md) / runAction

# Function: runAction()

> **runAction**(`options`, ...`files`): `Promise`\<`number`\>

Defined in: [src/cli.ts:33](https://github.com/woss/exiftool/blob/67919f8602e1b01765df081c4fd4df4684ab9c20/src/cli.ts#L33)

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
