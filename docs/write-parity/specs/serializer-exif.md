# EXIF / TIFF / GPS serializer spec (§B)

Upstream source: vendored ExifTool 13.64 Perl tables (`Exif::Main`,
`Exif::GPS`, `Exif::ExifIFD`, `Exif::InteropIFD`, maker TIFF dirs) loaded via
`scripts/generate-tags.ts` → `src/tags/generated/write-metadata.json`.
Code: `src/exif/tiff-builder.ts`, `src/exif/values.ts`, `src/write/tiff-merge.ts`.

## Scope

- Writable tag catalog per directory: IFD0, ExifIFD, GPS, InteropIFD, IFD1,
  SubIFDs, maker TIFF dirs. Type encoders: BYTE/SBYTE, ASCII, SHORT/SSHORT,
  LONG/SLONG, RATIONAL/SRATIONAL, UNDEFINED, FLOAT/DOUBLE, LONG8/SLONG8/IFD8
  (BigTIFF).
- Group routing: group-qualified keys route only to that directory;
  unqualified route to the preferred write group; duplicate IDs scoped per
  directory; last valid alias wins.
- Value handling: enum labels (+rotated `#` raw mode), unique-prefix matching,
  ambiguous labels rejected, PrintConv inverse for units/APEX/LensInfo,
  rational bounds (no truncation of fractional/zero-denominator/out-of-range).
- Directory lifecycle: create missing pointers (ExifIFD/GPS/Interop), synth
  mandatory defaults unless `noMandatory`, prune empty optional dirs,
  delete via `null`/`-Tag=` targeting one entry.

## Invariants

- **Preserve byte-for-byte** anything the rewrite can't rebase: unknown
  entries, thumbnails, strips/tiles, SubIFDs, maker-note bases. If an offset
  cannot be repaired, **refuse loud** (`UnsupportedFormatError`) — never shift.
- Olympus absolute TIFF-offset writes are refused; XMP/IPTC-only writes stay
  allowed (existing rule in TIFF merge).
- Standalone `buildTiff` (fresh TIFF/EXIF) must round-trip through ExifTool
  13.64 readback per tag; JPEG merge must preserve unrelated EXIF entries.

## Operations

set / add / replace / delete per writable tag with repeatable-value semantics;
no-op delete of absent tag; malformed directory / cyclic pointer graph ⇒
fail, no mutation.

## Test vectors

Extend `src/exif/tiff-builder.test.ts` + `src/write/tiff-merge.test.ts`:
per-tag ExifTool round-trip; group-routing collisions; delete-last-field
mandatory behavior; unsafe-offset refusal (strip/tile/SubIFD payloads);
BigTIFF IFD graph. Gate: adding/deleting one tag never alters unrelated
decoded metadata or image data.

## Exit gate

Every selected writable standard tag in a supported container has a unit
encoder + upstream round-trip test; matrix cells for `*/EXIF|set`,
`*/GPS|set`, `*/GeoTIFF|set` promote only per cell.
