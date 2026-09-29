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
- IPTC keywords are written into the APP13 Photoshop IRB (`8BIM` 0x0404,
  IPTC IIM records): an existing APP13 segment is merged — only its 0x0404
  block is replaced; every other resource block is copied verbatim. When the
  file has no APP13, one is created. `CodedCharacterSet` (record 1, dataset
  90) is set to UTF-8 so non-ASCII keywords survive.
- All other segments (ICC APP2, C2PA APP11, …) are copied verbatim.
- If the file has no EXIF APP1 at all, one is created from scratch.

XMP and IPTC writes are idempotent: writing the same values twice produces
byte-identical output (no mtime churn for dedupe logic).

## Key Convention

The writable keys are exported as `MERGE_TAG_KEYS` (`MergeTagKey` type):

| Key | Value | Target |
|-----|-------|--------|
| `EXIF:Copyright` | string | IFD0 Copyright (0x8298) |
| `EXIF:Orientation` | number 1-8 | IFD0 Orientation (0x0112) |
| `XMP-dc:Rights` | string | XMP `dc:rights` (`rdf:Alt/li`, `xml:lang="x-default"`) |
| `XMP-xmpRights:WebStatement` | string | XMP `xmpRights:WebStatement` |
| `XMP-dc:Subject` | string or string[] | XMP `dc:subject` (`rdf:Bag`, one `rdf:li` per keyword, replace-not-append) |
| `XMP-dc:Title` | string | XMP `dc:title` (`rdf:Alt`, `x-default`) |
| `XMP-dc:Description` | string | XMP `dc:description` (`rdf:Alt`, `x-default`) |
| `XMP-xmp:MetadataDate` | string | XMP `xmp:MetadataDate` (ISO 8601, written as given) |
| `IPTC:Keywords` | string or string[] | IPTC IIM record 2 dataset 25 (JPEG APP13), with `CodedCharacterSet` = UTF-8 |

The group prefix is optional and matching is case-insensitive:
`'Copyright'` ≡ `'exif:Copyright'`, `'WebStatement'` ≡ `'XMP-xmpRights:WebStatement'`,
`'Keywords'` ≡ `'XMP-dc:Subject'`, `'IPTC:Keywords'` for the IPTC home.

Any other tag from the IFD0/ExifIFD/GPS writable maps can be written with an
`EXIF:` prefix (e.g. `'EXIF:Make'`, `'EXIF:DateTimeOriginal'`). The entry is
patched in place when it exists, appended when its home IFD exists, and
reported in `skipped` when the file has no ExifIFD/GPS IFD.

Generic XMP properties (`'XMP-group:Property'`, e.g. `'XMP-photoshop:Credit'`)
are written as scalars; known lang-alts (`dc:title`, `dc:description`,
`dc:rights`) serialize as `rdf:Alt`, `dc:subject` as `rdf:Bag`,
`dc:creator` as `rdf:Seq`. Every written namespace is declared on `rdf:RDF`,
and properties are upserted (the previous element of the same property is
replaced), so writing the same values twice is byte-identical.

## Containers

| Container | EXIF | XMP | IPTC |
|---|---|---|---|
| JPEG | APP1 merge | APP1 packet splice/create | APP13 Photoshop IRB merge |
| PNG | eXIf chunk | `iTXt` (uncompressed, keyword `XML:com.adobe.xmp`) | — |
| WebP | EXIF chunk (VP8X flag) | `XMP ` RIFF chunk (VP8X flag) | — |
| TIFF (plain) | IFD structural merge | IFD0 XMP tag (0x02BC) | — |

Camera RAW (CR2, NEF, ARW, ORF, RAF, RW2, …) and TIFF/DNG files carrying
SubIFDs (0x014A: raw image data, previews, tiles) are **never rewritten in
place** — writes to those throw `UnsupportedFormatError`. Use the sidecar
mode instead.

## Sidecar Writes

For RAW/DNG pickup, write a Lightroom-readable `.xmp` sidecar instead:

```typescript
const { sidecarPath, written } = await exiftool.writeSidecar('IMG_0001.ARW', {
  'XMP-dc:Subject': ['kelp', 'forest'],
  'XMP-dc:Title': 'My photo',
  'XMP-xmp:MetadataDate': new Date().toISOString(),
});
```

The sidecar defaults to `<media>.xmp` next to the file. An existing sidecar is
read and merged: unknown properties already in it are preserved, matching
properties are replaced. Re-running with unchanged values is byte-identical —
derive `MetadataDate` from the file's indexed mtime if you need stable dates
across runs.

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

- There are no delete or clear-all semantics: an empty string overwrites the
  value, omitted keys are untouched.
- MakerNotes limitation: when EXIF entries are *added* to a JPEG's EXIF block,
  the TIFF rebuild can shift value areas, breaking MakerNotes whose internal
  offsets are absolute from the TIFF header (e.g. Olympus). XMP/IPTC-only
  writes never touch the EXIF block. Reference exiftool fixes this with
  per-maker offset logic; that is not implemented here.
- IPTC into TIFF (IFD0 IPTC-NAA) and AVIF XMP are not yet written.
