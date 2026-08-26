# Parity Matrix — exiftool-ts vs ExifTool 13.55

Status legend: **FULL** = implemented and verified · **PARTIAL** = subset shipped,
gaps listed · **NONE** = not started. "Ref" = reference ExifTool behavior.

Enforcement: value parity is continuously verified by
`src/cli/exiftool-parity.test.ts` against the real `exiftool` binary when
available; the known-divergence registry lives in that file
(`KNOWN_DIVERGENCES`). Coverage of everything we *do* ship is gated at
100% line / 100% function by `deno task coverage-audit`.

---

## 1. Container readers

| Container | Ref | Ours | Status | Evidence |
|---|---|---|---|---|
| JPEG/JFIF/EXIF | r/w ~140 formats | APP0/APP1(EXIF,XMP)/APP2(MPF)/APP13(Photoshop,IPTC)/APP14(Adobe)/COM/SOF/DQT/SOS walk, thumbnail extraction | FULL (read) | `src/format/jpeg.ts`, 30 tests |
| PNG | r/w | IHDR/eXIf/iTXt/zTXt/tEXt/iCCP/gAMA/pHYs, CRC-validated walk | FULL (read) | `src/format/png.ts`, 15 tests |
| WebP/RIFF | r/w | VP8X flags+canvas, EXIF/XMP/ICCP/ANIM chunks, odd-size pad handling | FULL (read) | `src/format/webp.ts`, 15 tests |
| AVIF/HEIF/HEIC (ISOBMFF) | r/w | ftyp brands, meta[hdlr/pitm/iinf/infe], Exif item, colr(nclx/rICC/prof), pixi/ispe, iloc-free structural walk | PARTIAL — no ipco/iprp property tree, no mdat item resolution | `src/format/avif.ts`, 19 tests |
| TIFF | r/w | IFD0 + ExifIFD + GPS + Interop + IFD1(thumbnail), both endians via shared parseTiff | PARTIAL — no standalone .tif container parser; DNG shares TIFF internals but untested as container | `src/exif/tiff.ts` (36 tiff tests) |
| CR2/CR3/NEF/ARW/ORF/RW2/RAF/DNG… (~60 raw formats) | r | NONE — no makernote parsing, most RAWs are TIFF-based so EXIF core would parse but untested | NONE | — |
| PDF / PostScript / EPS | r | NONE | NONE | — |
| QuickTime/MP4/MOV (moov atom metadata) | r | NONE (only generic ISOBMFF boxes inside AVIF) | NONE | — |
| Everything else (~70 types: MP3, ZIP, DOCX, SVG…) | r | NONE | NONE | — |

**Reader score: 4 containers fully verified + TIFF core engine; ref supports ~140.**

## 2. Metadata formats read

| Format | Status | Notes |
|---|---|---|
| EXIF IFD0 | FULL | both endians, TagDb-resolved names, sub-IFD pointers guarded |
| EXIF Sub-IFD | FULL | ExifIFD/Interop recursion with bounds guards |
| GPS | FULL | lat/long DMS + `-c` reformatting, refs, timestamps |
| IFD1 (thumbnail) | FULL | Thumbnail* renaming, byte-exact extraction (parity-tested) |
| XMP | PARTIAL | dc/tiff/xmp/crs namespaces, Bags/Seqs/lang-alt, history derivation; quirks pinned in tests (xmlns leak, entity passthrough); no full RDF struct model |
| IPTC (IIM) | PARTIAL | records 1/2 core datasets + Photoshop resources; compact-timezone normalization applied |
| ICC profile | PARTIAL | header, XYZ/sf32/curv/mluc/text/desc/meas/view/tech sig tags calibrated vs ExifTool numerics; missing lutA/B2A tables |
| Photoshop IRB | PARTIAL | 8BIM resources walked, IPTC embedded, thumbnail skipped cleanly |
| JFIF | FULL | density/version |
| Adobe APP14 | FULL | DCTEncodeVersion, APP14Flags, ColorTransform |
| MPF (Multi-Picture) | PARTIAL | index parsed for `-ee` extraction; attributes not surfaced as tags |
| MakerNotes (Canon et al.) | NONE | Canon assets: LensID/LensInfo stay unresolved (documented divergence) |
| FlashPix / MIE / EVRV / PhotoCD … | NONE | — |

## 3. Writers

| Target | Status | Notes |
|---|---|---|
| Safe-overwrite pipeline | FULL | temp-swap in dir, `_original` backup unless suppressed, failure leaves original untouched (`pipeline.test`) |
| JPEG APP1 rebuild | FULL | single rebuilt APP1, stale ones dropped, other segments preserved; round-trip read by real exiftool (parity test) |
| PNG eXIf | FULL | CRC-valid chunk inserted after IHDR, stale eXIf dropped |
| WebP EXIF | PARTIAL | requires existing VP8X (flag set); files without VP8X rejected |
| AVIF meta box | PARTIAL | replaces Exif payload inside existing meta or appends minimal meta box; pre-existing iloc offsets are NOT rewritten |
| Tag surface | PARTIAL | IFD0 only: ImageDescription, Make, Model, Orientation, X/YResolution, ResolutionUnit, Software, DateTime/ModifyDate, Artist, Copyright. No ExifIFD/GPS sub-IFD writing, no XMP/IPTC writing |
| In-place maker notes | NONE | permanent-tag model not implemented |

## 4. CLI surface (implemented vs reference)

| Flag/feature | Ours | Parity notes |
|---|---|---|
| default tabular | yes | tab-separated internal names; ref prints spaced display names by default (cosmetic) |
| `-j` JSON | yes | array-of-objects shape matches; binary summarized without `-b`, base64 with `-b -j` |
| `-csv` | yes | header + per-file rows, quote escaping |
| `-X` XML | yes | `<exiftool><file><tag name=…>` shape |
| `-b` binary | yes | raw dump to stdout; `-b -j` embeds base64 |
| `-d FMT` date format | yes | strftime-style tokens applied across all outputs |
| `-g`/-G group headings/prefix | yes | family-0 banners, family-1 prefixes |
| `-c` coord format | yes | decimal `%+.6f` and DMS templates `%d %.Nf %.Ns %c` |
| `-if COND` | partial v1 | `$Tag eq/ne/< > <= >= value`, ANDed; ref has full Perl expressions |
| `-v`/`-q` verbosity | partial v1 | summary/tag-dump lines; ref has deep structure dumps |
| `-o FILE` output redirect | yes | |
| `-r`/`-ext`/`-i` recursion | yes | deterministic sort, symlink-safe |
| `-ee` extract embedded | partial v1 | MPF individual images only; ref covers PDF/video/embedded docs |
| `-stay_open` daemon | yes | stdin protocol, `-execute` batching, `{ready}` sentinel, False shutdown |
| `-overwrite_original` | yes | plus `_original` backups by default (same naming as ref) |
| TAG=VALUE writing | yes | routes to writer pipeline |
| `-tagsFromFile`, `-p`, `-args`, `-php`, `-k`, `-m`, `-P`, `-scanForXMP`, `-struct`, `-z`, `-fast`, `-fileOrder`, `-progress`, `-geotag`, `-api`, … | NONE | ~80 further ref options |

## 5. Composite tags

Implemented: Megapixels, Aperture, GPSPosition, GPSDateTime, SubSec trio,
Lens/LensID passthrough, LightValue, ShutterSpeed, HyperfocalDistance,
ScaleFactor35efl, FocalLength35efl, Compression, ImageSize.
Ref computes ~200 composites. Missing ones degrade silently (absent key).

## 6. Known divergences registry

Live list maintained in `src/cli/exiftool-parity.test.ts`
(`KNOWN_DIVERGENCES`) — currently 19 documented entries across file dates
(timezone), flash wording, lens/makernote lookups, crop-factor composites,
fraction display, and JSON binary summarization. The parity suite fails on
any new unregistered divergence.

---

*Generated from code inventory on 2026-08-26 against ExifTool 13.55.*
