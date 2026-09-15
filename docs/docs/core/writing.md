---
sidebar_position: 2
slug: /core/writing
---

# Writing Metadata

exiftool-ts writes metadata **merge-style**: only the tags you pass change,
every other metadata byte is preserved. This mirrors `exiftool -overwrite_original`
semantics for license stamping and targeted edits.

## Basic Write

```typescript
import { ExifTool } from '@woss/exiftool';

const exiftool = new ExifTool();
const result = await exiftool.write('photo.jpg', {
  Copyright: '© 2026 Woss. All rights reserved.',
  Orientation: 1,
  Rights: 'All rights reserved. Unauthorized use prohibited.',
  WebStatement: 'https://woss.photo/license',
});

console.log(result.written); // ['EXIF:Copyright', 'EXIF:Orientation', 'XMP-dc:Rights', 'XMP-xmpRights:WebStatement']
console.log(result.skipped); // tags that could not be encoded
```

`write` overwrites the file in place and creates a `<file>_original` backup
unless `{ overwriteOriginal: true }` is passed.

## Merge Semantics (JPEG)

Writing to a JPEG changes **only the requested tags**:

- EXIF tags are merged into the existing APP1 EXIF block: existing entries are
  patched in place or their values re-pointed; untouched entries are copied
  verbatim — including the ExifIFD (SerialNumber, DateTimeOriginal, LensSerialNumber,
  …), GPS IFD, MakerNotes (byte-for-byte), and the IFD1 thumbnail image.
- XMP properties are spliced into the first top-level `rdf:Description` of the
  existing packet without re-serializing the rest. When the file has no XMP
  packet, a minimal conformant one is created.
- All other segments (IPTC APP13, ICC APP2, C2PA APP11, …) are copied verbatim.
- If the file has no EXIF APP1 at all, one is created from scratch.

## Key Convention

The writable keys are exported as `MERGE_TAG_KEYS` (`MergeTagKey` type):

| Key | Value | Target |
|-----|-------|--------|
| `EXIF:Copyright` | string | IFD0 Copyright (0x8298) |
| `EXIF:Orientation` | number 1-8 | IFD0 Orientation (0x0112) |
| `XMP-dc:Rights` | string | XMP `dc:rights` (`rdf:Alt/li`, `xml:lang="x-default"`) |
| `XMP-xmpRights:WebStatement` | string | XMP `xmpRights:WebStatement` |

The group prefix is optional and matching is case-insensitive:
`'Copyright'` ≡ `'exif:Copyright'`, `'WebStatement'` ≡ `'XMP-xmpRights:WebStatement'`.

Any other tag from the IFD0/ExifIFD/GPS writable maps can be written with an
`EXIF:` prefix (e.g. `'EXIF:Make'`, `'EXIF:DateTimeOriginal'`). The entry is
patched in place when it exists, appended when its home IFD exists, and
reported in `skipped` when the file has no ExifIFD/GPS IFD.

## In-Memory Writes

```typescript
const outcome = await exiftool.writeBytes(imageBuffer, {
  Copyright: '© 2026',
  Rights: 'All rights reserved',
});
// outcome.bytes — new image bytes
// outcome.written / outcome.skipped
```

## Scope Notes

- Merge writes are JPEG-only today; PNG/WebP/AVIF writers rebuild their EXIF
  block and do not yet support XMP splicing.
- There are no delete or clear-all semantics: an empty string overwrites the
  value, omitted keys are untouched.
- XMP writing beyond the two rights properties is on the roadmap
  (see the project scope in the README).
