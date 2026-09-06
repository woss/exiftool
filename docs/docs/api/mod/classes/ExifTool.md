[**@woss/exiftool v0.1.0**](../../README.md)

***

[@woss/exiftool](../../modules.md) / [mod](../README.md) / ExifTool

# Class: ExifTool

Defined in: [src/exiftool.ts:28](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/exiftool.ts#L28)

Node.js entry point for exiftool-ts.
Extends ExifToolCore with filesystem-based read/write operations.

This is the main class for Node.js environments. For browser/edge,
use ExifToolCore directly with `Uint8Array` buffers.

## Example

```typescript
import { ExifTool } from 'exiftool-ts';

const exiftool = new ExifTool();
const result = await exiftool.read('photo.jpg');
console.log(result.tags.Make, result.tags.Model);

await exiftool.write('input.jpg', 'output.jpg', {
  Title: 'My Photo',
  Artist: 'John Doe',
});
```

## Extends

- `ExifToolCore`

## Constructors

### Constructor

> **new ExifTool**(`opts?`): `ExifTool`

Defined in: [src/exiftool-core.ts:43](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/exiftool-core.ts#L43)

Creates a new ExifToolCore instance.

#### Parameters

##### opts?

`Partial`\<`ExifToolOptions`\>

Optional configuration options

#### Returns

`ExifTool`

#### Inherited from

`ExifToolCore.constructor`

## Properties

### tagDb

> `readonly` **tagDb**: [`TagDb`](TagDb.md)

Defined in: [src/exiftool-core.ts:28](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/exiftool-core.ts#L28)

Tag database for custom tag definitions.

#### Inherited from

`ExifToolCore.tagDb`

***

### options

> `readonly` **options**: `ExifToolOptions`

Defined in: [src/exiftool-core.ts:31](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/exiftool-core.ts#L31)

Resolved options (merged with defaults).

#### Inherited from

`ExifToolCore.options`

## Methods

### getParser()

> **getParser**(`format`): `FormatParser` \| `undefined`

Defined in: [src/exiftool-core.ts:65](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/exiftool-core.ts#L65)

Gets a parser by format name (e.g., 'JPEG', 'PNG', 'AVIF').

#### Parameters

##### format

`string`

Format identifier

#### Returns

`FormatParser` \| `undefined`

FormatParser if available, undefined otherwise

#### Inherited from

`ExifToolCore.getParser`

***

### readBytes()

> **readBytes**(`bytes`): `Promise`\<[`FileInfo`](../interfaces/FileInfo.md)\>

Defined in: [src/exiftool-core.ts:78](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/exiftool-core.ts#L78)

Parses metadata from an in-memory buffer.

File-system-derived tags (FileName, FileSize, FileModifyDate, etc.)
are absent — only embedded metadata is returned.

#### Parameters

##### bytes

`Uint8Array`

Image file data as Uint8Array

#### Returns

`Promise`\<[`FileInfo`](../interfaces/FileInfo.md)\>

Parsed file information with tags

#### Inherited from

`ExifToolCore.readBytes`

***

### writeBytes()

> **writeBytes**(`bytes`, `tags`): `Promise`\<`WriteOutcome`\>

Defined in: [src/exiftool-core.ts:97](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/exiftool-core.ts#L97)

Writes metadata tags to an in-memory buffer.

Returns the new bytes with updated metadata container
(JPEG APP1, PNG eXIf, WebP EXIF, AVIF/HEIF meta box).

#### Parameters

##### bytes

`Uint8Array`

Original image data

##### tags

`Record`\<`string`, [`TagValue`](../type-aliases/TagValue.md)\>

Tags to write (normalized format)

#### Returns

`Promise`\<`WriteOutcome`\>

Write outcome with new bytes and any warnings

#### Throws

[UnsupportedFormatError](UnsupportedFormatError.md) if format doesn't support writing

#### Inherited from

`ExifToolCore.writeBytes`

***

### read()

> **read**(`filePath`, `hints?`): `Promise`\<[`FileInfo`](../interfaces/FileInfo.md)\>

Defined in: [src/exiftool.ts:36](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/exiftool.ts#L36)

Reads metadata from a file path.

#### Parameters

##### filePath

`string`

Path to the image file

##### hints?

[`ParseHints`](../interfaces/ParseHints.md)

Optional parsing hints for format-specific behavior

#### Returns

`Promise`\<[`FileInfo`](../interfaces/FileInfo.md)\>

Parsed file information with tags grouped by metadata standard

***

### write()

> **write**(`filePath`, `tags`, `opts?`): `Promise`\<[`WriteResult`](../interfaces/WriteResult.md)\>

Defined in: [src/exiftool.ts:58](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/exiftool.ts#L58)

Writes metadata tags to a file.

Creates a backup file (`<file>_original`) unless `overwriteOriginal` is set.
Supports JPEG (APP1), PNG (eXIf), WebP (EXIF), AVIF/HEIF (meta box).

#### Parameters

##### filePath

`string`

Path to the input file

##### tags

`Record`\<`string`, [`TagValue`](../type-aliases/TagValue.md)\>

Tags to write (normalized format, see [TagValue](../type-aliases/TagValue.md))

##### opts?

Write options

###### overwriteOriginal?

`boolean`

Overwrite file without backup (default: false)

#### Returns

`Promise`\<[`WriteResult`](../interfaces/WriteResult.md)\>

Write result with success status and any warnings

***

### run()

> **run**(`args`): `Promise`\<`number`\>

Defined in: [src/exiftool.ts:72](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/exiftool.ts#L72)

Runs CLI-style arguments programmatically.

#### Parameters

##### args

`string`[]

Command-line arguments (e.g., `['-j', 'photo.jpg']`)

#### Returns

`Promise`\<`number`\>

Exit code (0 = success)

***

### printHelp()

> **printHelp**(): `void`

Defined in: [src/exiftool.ts:89](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/exiftool.ts#L89)

Prints CLI help text.

#### Returns

`void`
