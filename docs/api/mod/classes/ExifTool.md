[**exiftool-ts v0.1.0**](../../README.md)

***

[exiftool-ts](../../modules.md) / [mod](../README.md) / ExifTool

# Class: ExifTool

Defined in: src/exiftool.ts:11

Node entry: extends the platform-free core with path-based read/write
backed by the filesystem.

## Extends

- `ExifToolCore`

## Constructors

### Constructor

> **new ExifTool**(`opts?`): `ExifTool`

Defined in: src/exiftool-core.ts:20

#### Parameters

##### opts?

`Partial`\<`ExifToolOptions`\>

#### Returns

`ExifTool`

#### Inherited from

`ExifToolCore.constructor`

## Properties

### tagDb

> `readonly` **tagDb**: [`TagDb`](TagDb.md)

Defined in: src/exiftool-core.ts:15

#### Inherited from

`ExifToolCore.tagDb`

***

### options

> `readonly` **options**: `ExifToolOptions`

Defined in: src/exiftool-core.ts:16

#### Inherited from

`ExifToolCore.options`

## Methods

### getParser()

> **getParser**(`format`): `FormatParser` \| `undefined`

Defined in: src/exiftool-core.ts:32

The resolved plugin for `format`, if this instance uses it.

#### Parameters

##### format

`string`

#### Returns

`FormatParser` \| `undefined`

#### Inherited from

`ExifToolCore.getParser`

***

### readBytes()

> **readBytes**(`bytes`): `Promise`\<[`FileInfo`](../interfaces/FileInfo.md)\>

Defined in: src/exiftool-core.ts:40

Parses metadata from an in-memory buffer.
File-system-derived tags (FileName, FileSize, …) are absent here.

#### Parameters

##### bytes

`Uint8Array`

#### Returns

`Promise`\<[`FileInfo`](../interfaces/FileInfo.md)\>

#### Inherited from

`ExifToolCore.readBytes`

***

### writeBytes()

> **writeBytes**(`bytes`, `tags`): `Promise`\<`WriteOutcome`\>

Defined in: src/exiftool-core.ts:52

Writes the writable tag subset into an in-memory container's metadata
(JPEG APP1, PNG eXIf, WebP EXIF, AVIF meta) and returns the new bytes.

#### Parameters

##### bytes

`Uint8Array`

##### tags

`Record`\<`string`, [`TagValue`](../type-aliases/TagValue.md)\>

#### Returns

`Promise`\<`WriteOutcome`\>

#### Inherited from

`ExifToolCore.writeBytes`

***

### read()

> **read**(`filePath`, `hints?`): `Promise`\<[`FileInfo`](../interfaces/FileInfo.md)\>

Defined in: src/exiftool.ts:12

#### Parameters

##### filePath

`string`

##### hints?

[`ParseHints`](../interfaces/ParseHints.md)

#### Returns

`Promise`\<[`FileInfo`](../interfaces/FileInfo.md)\>

***

### write()

> **write**(`filePath`, `tags`, `opts?`): `Promise`\<[`WriteResult`](../interfaces/WriteResult.md)\>

Defined in: src/exiftool.ts:27

Writes the writable tag subset into the file's native metadata
container (JPEG APP1, PNG eXIf, WebP EXIF, AVIF meta). Creates a
`<file>_original` backup unless overwriteOriginal is set.

#### Parameters

##### filePath

`string`

##### tags

`Record`\<`string`, [`TagValue`](../type-aliases/TagValue.md)\>

##### opts?

###### overwriteOriginal?

`boolean`

#### Returns

`Promise`\<[`WriteResult`](../interfaces/WriteResult.md)\>

***

### run()

> **run**(`args`): `Promise`\<`number`\>

Defined in: src/exiftool.ts:35

#### Parameters

##### args

`string`[]

#### Returns

`Promise`\<`number`\>

***

### printHelp()

> **printHelp**(): `void`

Defined in: src/exiftool.ts:51

#### Returns

`void`
