# Changelog

All notable changes to exiftool-ts are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: [SemVer](https://semver.org/).

## [0.7.1](https://github.com/woss/exiftool/compare/v0.7.0...v0.7.1) (2026-10-19)


### Bug Fixes

* **release:** JSON updater for jsr.json; sync version to 0.7.0 ([eb4a2db](https://github.com/woss/exiftool/commit/eb4a2db21d87b130582f2979a84dc460d59d2fea))
* **release:** use json updater for jsr.json extra-files; sync jsr version to 0.7.0 ([11a3fe6](https://github.com/woss/exiftool/commit/11a3fe6b18a79512eef6463cfd68a4ebe9dd9943))

## [0.7.0](https://github.com/woss/exiftool/compare/v0.6.0...v0.7.0) (2026-10-19)


### Features

* rework plugin presets — ALL exhaustive, MODERN web-only, new MODERN_RAW ([8496a07](https://github.com/woss/exiftool/commit/8496a07861f6eaff4c916378eb2655db26283340))
* rework plugin presets — ALL is exhaustive, MODERN is web formats, add MODERN_RAW ([436b4bd](https://github.com/woss/exiftool/commit/436b4bda56c9c59bd2c4dc6ca7f0faef658fd59b))


### Bug Fixes

* **docs:** MDX-safe header, resolvable links, correct C2PA status ([c045260](https://github.com/woss/exiftool/commit/c045260be4b7dc9ecfa55c7e9d77e8f5b1796c15))
* **docs:** MDX-safe header, resolvable links, correct C2PA status ([d67059c](https://github.com/woss/exiftool/commit/d67059cd3b97200131f345441a24a2eda4c29d56))

## [Unreleased]

### Changed
- `MODERN_PLUGINS` is now exactly the web image formats (JPEG, GIF, PNG, WebP,
  AVIF), chosen from HTTP Archive's Web Almanac 2024 usage data. It no longer
  includes TIFF-family RAW or the standalone packet formats.
- `ALL_PLUGINS` is now the same array as `BUILTIN_PLUGINS` — every shipped
  parser in detection order — instead of an alias of `MODERN_PLUGINS`.
- New `MODERN_RAW_PLUGINS` preset: the TIFF-family RAW container parser
  (TIFF/DNG/CR2/NEF/ARW/ORF/RW2/PEF/ERF/DCR/SRW) plus the standalone XMP
  parser for `.xmp` sidecar writes.

## [0.6.0] — 2026-10-19

### Added
- Metadata writing surface: JPEG (ICC, JFIF, Ducky, comment, XMP, IPTC
  append), PNG (tEXt/iTXt/zTXt, language-qualified text, ICC profile,
  ancillary chunks, modification date, XMP delete), WebP (ICC profile,
  XMP delete, EXIF preservation), GIF, EXV, PBM/PGM/PPM, and standalone
  EXIF, ICC, and XMP writing.
- CLI write workflows: tag copying (`tagsFromFile` with source-file
  selectors, exclusions, same-file mappings), conditional write
  filtering (boolean/regex/parenthesized conditions), output-path
  templates with source-token expansion, collision counters, batch
  writes to directories, stdout output, and `-o` XMP sidecars.
- ExifTool-compatible write modes (`wm`, `wc`, `wg`, and group-creating
  variants) with CLI validation.
- XMP list append/removal: Creator and Subject appends, IPTC Keywords,
  Dublin Core list properties, first-match list-item removal, and empty
  container cleanup after deletion.
- PNG read parity: ICC profile parsing and compressed text chunks.
- Standalone XMP and PBM/PGM/PPM/PPM format writers.

### Fixed
- JPEG ICC profile segment reassembly; PNG EXIF/ICC/text round-trip
  preservation, GPS sign encoding, date/value normalization, and
  late-chunk hoisting.
- Permission preservation in atomic metadata writes; quiet-mode write
  failure surfacing; unsupported CLI tag-write reporting.

### Docs
- CLI and API write workflow documentation and metadata write parity
  scope.

## [0.5.2] — 2026-09-29

### Added
- PNG IHDR read parity: `Filter` and `Interlace` with reference PrintConv
  strings, `SRGBRendering` from the sRGB chunk.
- PNG zTXt chunk support (zlib/deflate; Node parser layer).
- PNG tEXt/iTXt/zTXt keywords surface as bare capitalized tag names
  (`parameters` → `Parameters`), yielding to EXIF/eXIf/XMP-derived keys.
- XMP read parity: unknown-namespace properties surface with capitalized
  local names (InvokeAI `Metadata`/`Graph`, DMI `DigitalSourceType`,
  GPano panorama tags with integer typing); `xmpMM:History` flattens to
  `History*` fields and the raw container is no longer emitted; XMP dates
  with `Z` suffix normalize to EXIF-style rendering; TAG_REMAP entries
  pinned for `exif:UserComment`, InvokeAI, DMI, GPano/IGPano.
- `src/ai-parity.test.ts`: reference-equal tests against real exiftool on
  A1111 (`tEXt parameters`) and InvokeAI (XMP/DMI/History) fixtures.

### Fixed
- `pngWriter` omitted the IEND CRC — every PNG written by the library was
  truncated by 4 bytes and unreadable by strict parsers.

## [0.4.0] — 2026-09-29

### Added
- Generalized XMP property writer: arbitrary `group:property` keys with value
  shapes (scalar, `rdf:Alt` x-default, `rdf:Bag`, `rdf:Seq`), per-namespace
  xmlns declaration, upsert-or-replace semantics, and fresh-packet fallback
  when a container has no XMP.
- P0 descriptive tags on all write containers: `XMP-dc:Subject` (keywords Bag,
  replace-not-append), `XMP-dc:Title`, `XMP-dc:Description`
  (Alt/x-default), `XMP-xmp:MetadataDate`.
- XMP embedding per container: PNG (`iTXt`, uncompressed, keyword
  `XML:com.adobe.xmp`), WebP (`XMP ` RIFF chunk + VP8X flag), plain TIFF
  (IFD0 XMP/XMLPacket tag 0x02BC) — previously EXIF-only.
- IPTC IIM writer for JPEG APP13: repeatable Keywords (record 2, dataset 25)
  plus `CodedCharacterSet` (record 1, dataset 90) = UTF-8; merges into an
  existing Photoshop IRB, replacing only the 8BIM 0x0404 block.
- `ExifTool.writeSidecar()`: Lightroom-readable `.xmp` sidecar for RAW/DNG
  pickup, with read-merge of unknown properties and idempotent re-runs.
- `ExifToolCore.writeBytes` (in-memory path) supports all of the above.

### Changed
- TIFF writing restricted to plain TIFF: camera RAW (CR2, NEF, ARW, …) and
  files with SubIFDs (DNG raw data, previews, tiles) throw
  `UnsupportedFormatError` instead of risking corruption — use the sidecar
  mode for those.

### Fixed
- TIFF writer used a typo'd XMP tag id (0xBC01); the real XMP/XMLPacket tag
  is 0x02BC.
- Big-endian TIFF version check read bytes 2/3 swapped, rejecting valid
  big-endian TIFF files.

### Known limitation
- Adding EXIF *entries* to a JPEG can shift value areas in the rebuilt EXIF
  block, breaking MakerNotes whose internal offsets are absolute from the
  TIFF header (e.g. Olympus). XMP/IPTC-only writes never touch the EXIF
  block. Reference exiftool fixes this with per-maker offset logic.

## [0.3.1] — 2026-09-15

### Fixed
- JPEG parser no longer stamps a fabricated `ExifToolVersion` into parse
  output (tool-injected, not file data; was JPEG-only and inconsistent with
  the TIFF-RAW output).

### Added
- Docs demo page: tag dots colored by metadata group, with legend.

## [0.3.0] — 2026-09-15

### Added
- exiftool-compatible merge writes on JPEG: EXIF (IFD0/ExifIFD/GPS)
  structural merge plus `EXIF:Copyright`, `EXIF:Orientation`,
  `XMP-dc:Rights`, `XMP-xmpRights:WebStatement` with fresh-XMP fallback.
- Branding: custom aperture logo; human + AI credit in README and docs
  footer.

## [0.2.0] — 2026-09-15

### Added
- TIFF-family RAW container reading (TIFF, DNG, CR2, NEF, ARW, ORF, RW2/RWL,
  PEF, ERF, DCR, SRW).
- MakerNotes decoding for 6 core vendors; TIFF RAW read-parity gaps closed.
- ExifIFD/GPS IFD writing; C2PA docs sidebar.
- Measured performance numbers replacing placeholder claims; parity page.

### Fixed
- Dropped accidental self-dependency; bumped deprecated `uuid` via override.

## [0.1.3] — 2026-09-06

### Changed
- Version bump with JSR payload sync.

## [0.1.2] — 2026-09-06

### Changed
- Excluded heavy/test directories from the JSR publish payload.

[Unreleased]: https://github.com/woss/exiftool/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/woss/exiftool/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/woss/exiftool/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/woss/exiftool/compare/v0.4.0...v0.5.1
[0.4.0]: https://github.com/woss/exiftool/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/woss/exiftool/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/woss/exiftool/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/woss/exiftool/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/woss/exiftool/compare/v0.1.2...v0.1.3
