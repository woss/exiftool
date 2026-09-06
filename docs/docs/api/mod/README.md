[**@woss/exiftool v0.1.0**](../README.md)

***

[@woss/exiftool](../modules.md) / mod

# mod

exiftool-ts - TypeScript ExifTool wrapper with C2PA support

Main entry point for the exiftool-ts library.
Provides high-level API for reading and writing image metadata.

## Example

```typescript
import { ExifTool } from 'exiftool-ts';

const exiftool = new ExifTool();
const result = await exiftool.read('photo.jpg');
console.log(result.tags.Make); // "Canon"
```

## Classes

- [ExifTool](classes/ExifTool.md)
- [TagDb](classes/TagDb.md)
- [UnsupportedFormatError](classes/UnsupportedFormatError.md)

## Interfaces

- [ParseHints](interfaces/ParseHints.md)
- [TagEntry](interfaces/TagEntry.md)
- [TagGroups](interfaces/TagGroups.md)
- [ReadOptions](interfaces/ReadOptions.md)
- [WriteOptions](interfaces/WriteOptions.md)
- [WriteResult](interfaces/WriteResult.md)
- [FileInfo](interfaces/FileInfo.md)

## Type Aliases

- [TagValue](type-aliases/TagValue.md)
- [OutputFormat](type-aliases/OutputFormat.md)

## Functions

- [writeTags](functions/writeTags.md)
