# Full Metadata Writing Plan

## Goal

Bring exiftool-ts metadata writing toward parity with the vendored Phil Harvey ExifTool 13.55, without treating every readable file type as writable. The upstream support matrix is the contract: implement write (`w`) and create (`c`) only where ExifTool supports them, and record deliberate differences by format, metadata family, and operation.

“Full” means parity for the upstream-supported write surface, including tag selection and copy semantics, metadata groups, preservation behavior, and observable CLI/API results. It does not mean writing every tag in every format. MakerNotes, signatures, and other provenance-sensitive blocks need explicit per-family safety rules; unknown binary data must never be rewritten speculatively.

## Current Baseline

- `FormatParser` exposes an optional `writeBytes` hook. The filesystem pipeline detects the container, invokes its writer, creates an `_original` backup by default, and replaces the file through a same-directory temporary file.
- Built-in writers cover JPEG, PNG, WebP, AVIF/HEIF, and plain TIFF. The TIFF writer rejects camera RAW and unsupported TIFF structures.
- EXIF/TIFF writing is built around `buildTiff`; XMP writing supports a limited property set and XMP sidecars. JPEG has a separate merge path to preserve existing metadata.
- The current feature branch additionally preserves file modification time through `WriteOptions.preserveTime` and CLI `-P`; JPEG merge can create missing ExifIFD/GPS directories and delete mapped EXIF tags with `null` / `-Tag=`.
- JPEG IPTC-IIM writes now resolve writable ApplicationRecord and EnvelopeRecord datasets from the generated ExifTool tables, preserve unrelated datasets/resources, and support deleting datasets. JPEG, PNG, and WebP XMP routing accepts properties in namespaces already registered by the XMP serializer, preserving case-sensitive names.
- These additions are still a narrow subset: EXIF remains hand-mapped, IPTC is embedded only through JPEG APP13, XMP namespace URIs are limited to the serializer registry, and tag copy workflows and most upstream writable containers are not implemented.
- Embedded writing is still limited in tag groups, metadata formats, and container coverage. The public `WriteOptions` surface is also much smaller than ExifTool's command-line write options.
- `src/format/tiff-raw.ts` and the parity documentation disagree about TIFF-family RAW write and MakerNote support. Resolve this against executable behavior before using those comments as a baseline.

## Compatibility Contract

Maintain a generated or reviewed matrix based on `vendor/exiftool/README` for each ExifTool version used by parity tests:

| Dimension | Contract |
| --- | --- |
| Container | File type, including whether ExifTool reads, writes, or creates it |
| Metadata family | EXIF, GPS, IPTC-IIM, XMP, ICC, Photoshop IRB, MakerNotes, and format-specific families |
| Operation | Set, delete, copy, preserve, create, and binary-block handling as applicable |
| Tag behavior | Name/group resolution, value conversion, writable status, duplicate/priority rules |
| Safety | Bytes preserved, removed, or regenerated; signature/provenance consequences |

Each supported cell needs a documented implementation and tests. Unsupported or intentionally read-only cells must fail clearly or appear in `skipped`; they must not silently report a successful write. Upstream behavior is versioned, and an ExifTool upgrade requires reviewing the matrix and parity fixtures.

## Exact Upstream Inventory

This inventory is copied from the vendored ExifTool 13.55 `README`. It contains 77 file-type entries marked writable: 70 `r/w` and 7 `r/w/c`. `r/w` means read and write; `r/w/c` additionally means create from scratch. These are upstream claims, not claims that exiftool-ts already supports those operations.

### File Types Marked Writable

| Upstream mode | File types |
| --- | --- |
| `r/w/c` | `DR4`, `EXIF`, `EXV`, `ICC`, `MIE`, `VRD`, `XMP` |
| `r/w` | `360`, `3G2`, `3GP`, `AAX`, `AI`, `ARQ`, `ARW`, `AVIF`, `CR2`, `CR3`, `CRM`, `CRW`, `CS1`, `DCP`, `DNG`, `DVB`, `EPS`, `ERF`, `F4A/V`, `FFF`, `FLIF`, `GIF`, `GLV`, `GPR`, `HDP`, `HEIC`, `HEIF`, `IIQ`, `IND`, `INSP`, `JNG`, `JP2`, `JPEG`, `JXL`, `LRV`, `M4A/V`, `MEF`, `MNG`, `MOS`, `MOV`, `MP4`, `MPO`, `MQV`, `MRW`, `NEF`, `NKSC`, `NRW`, `ORF`, `ORI`, `PBM`, `PDF`, `PEF`, `PGM`, `PNG`, `PPM`, `PS`, `PSB`, `PSD`, `QTIF`, `RAF`, `RAW`, `RW2`, `RWL`, `SR2`, `SRW`, `THM`, `TIFF`, `WEBP`, `WDP`, `X3F` |

The current port has adapters for JPEG, PNG, WebP, AVIF/HEIC/HEIF, and TIFF-family inputs, but these are partial implementations, not full format parity. The TIFF adapter writes plain TIFF only; camera RAW variants must each be explicitly validated before they are advertised writable. Every other type in the table above needs a writer adapter or a documented, tested reason for deferral. File-type aliases and extension handling must follow ExifTool's detected `FileType`, not just filename suffixes.

### Metadata Families Marked Writable

| Upstream mode | Metadata families |
| --- | --- |
| `r/w/c` | EXIF, GPS, IPTC, XMP, MakerNotes, Photoshop IRB, ICC Profile, MIE, JFIF, Ducky APP12, PDF, PNG metadata, Canon VRD, GeoTIFF |
| `r/w` | CIFF, AFCP, Kodak Meta, FotoStation, PhotoMechanic |

All other metadata families in the upstream README are read-only in that matrix and are not write-parity targets unless ExifTool 13.55 source or behavior tests show otherwise. A container's writeability does not imply every metadata family can be written into it; represent this as a container-by-family matrix, not one boolean per format.

Current family coverage is partial: EXIF/GPS use a small hand-maintained tag map; IPTC-IIM supports generated ApplicationRecord/EnvelopeRecord entries only inside JPEG APP13; XMP supports only registered namespace URIs and limited RDF shapes; MakerNotes are preserved but not edited; ICC and most Photoshop IRB resources are preserved but not edited. The other writable families above do not have complete serializers/container integration.

### Current Container Matrix

| Container area | Current state | Exact remaining work |
| --- | --- | --- |
| `JPEG`, `MPO` | Partial EXIF/GPS, limited XMP, partial IPTC-IIM in APP13, COM Comment set/replace/delete, JFIF density set/create, ICC_PROFILE APP2 whole-profile set/delete/reassembly, Ducky APP12 Quality/Comment/Copyright | Full writable tag coverage; APP1/APP13 multi-segment semantics and other APP2 families; multi-comment COM semantics; JFIF thumbnails/all writable fields; ICC tag editing; preserve/merge other Ducky blocks; all resources; preview/MPF offset safety; ambiguity rules; delete/add/copy; exact segment ordering and limits |
| `PNG` | Partial EXIF merge preserving unrelated eXIf entries, fresh ExifIFD/GPS directories, negative GPS coordinate reference synthesis, partial XMP, tEXt/iTXt/zTXt text writing including language-qualified iTXt, optional `-z` compression, existing text-chunk form preservation on update, eligible post-IDAT text/EXIF chunk hoisting with SAVE barrier preservation, RFC-1123 `CreationTime` and ISO `CreateDate`/`ModDate` read/write normalization, canonical names for special writable text keywords; iCCP ICC field parsing, profile set/delete, and profile-name preservation on replacement; pHYs/gAMA/sRGB fields; tIME ModifyDate set/delete | Full `eXIf`, ICC tag editing, remaining writable text/tag conversions and groups, all writable PNG metadata semantics, advanced ordering/barrier cases, unknown-chunk preservation, CRC and delete behavior. ExifTool only writes the fake `PNG:ProfileName` field when `ICC_Profile` is written; name-only requests are skipped. |
| `WEBP` | Partial EXIF merge preserving unrelated entries, partial XMP including selected-property deletion, ICCP whole-profile set/delete | Full EXIF/XMP write semantics, ICC tag editing, chunk flags/order/padding, absent/present chunk cases, and unknown chunk preservation |
| `AVIF`, `HEIC`, `HEIF` | Partial EXIF write | Correct ISO-BMFF item/`iloc` updates, 32/64-bit sizes, offsets, XMP/ICC integration, metadata deletion, brands, and HEIC/HEIF parity |
| `GIF` | Partial: Comment, XMP application extension, ICC application extension | Match upstream duplicate-comment handling, raw XMP packet/landing-zone behavior, large ICC data, and byte preservation across all GIF block types; complete parser coverage for animation/text/application metadata separately |
| `PPM` | Partial: P3/P6 read and Comment set/delete | Match all upstream PPM variants and header/comment normalization; verify ASCII P3 and 16-bit max-value P6 cases |
| `PGM` | Partial: P2/P5 read and Comment set/delete | Match header/comment normalization; verify 16-bit max-value P5 cases and upstream edge behavior |
| `PBM` | Partial: P1/P4 read and Comment set/delete | Match header/comment normalization; verify packed P4 row padding and upstream edge behavior |
| TIFF | Plain TIFF subset | Full IFD graph handling, BigTIFF, SubIFDs, thumbnails, all writable families, large offsets, and preservation of image strips/tiles |
| Camera RAW | TIFF-based reader; write behavior is not established as safe | Per-type read/write probes and fixtures for `ARQ`, `ARW`, `CR2`, `CR3`, `CRM`, `CRW`, `CS1`, `DNG`, `ERF`, `FFF`, `IIQ`, `INSP`, `MEF`, `MOS`, `MRW`, `NEF`, `NKSC`, `NRW`, `ORF`, `ORI`, `PEF`, `RAF`, `RAW`, `RW2`, `RWL`, `SR2`, `SRW`, `X3F`; port format-specific offsets/previews/makernotes or keep that type read-only |
| Video/audio ISO-BMFF | No adapter | `3G2`, `3GP`, `AAX`, `DVB`, `F4A/V`, `GLV`, `LRV`, `M4A/V`, `MOV`, `MP4`, `MQV`, `QTIF`; parse/rebuild atom trees, metadata keys/ilst, timed tracks, UUID boxes, offsets, and media-data preservation |
| Other image/graphics | No adapter | `360`, `AI`, `DCP`, `EPS`, `FLIF`, `GPR`, `HDP`, `JNG`, `JP2`, `JXL`, `MNG`, `PS`, `PSB`, `PSD`, `THM`, `WDP`; port each format's documented metadata blocks and preserve compressed/image payloads |
| Documents and standalone metadata | Partial: standalone EXIF update, EXV update, XMP parser/writer plus sidecar create/merge/delete, ICC whole-profile replacement; TIFF subset | `DR4`, `IND`, `MIE`, `PDF`, `VRD`; complete EXIF/EXV create semantics, ICC tag-level editing/create, XMP namespace/schema and CLI create parity, and each format's distinct write/create semantics |

The grouped rows above are work queues, not permission to mark an entire group supported after one adapter lands. Each individual file type must pass its own matrix cells and release gate.

## Exact Implementation Checklist

### A. Source-of-Truth Tag Catalog

- [x] Pin the catalog to ExifTool 13.55 and make the generation script record the upstream version/hash used.
- [ ] For every writable tag, capture canonical name, ID, metadata family, actual read group, preferred write group, supported file types, type, count, list shape, writable/protected status, mandatory status, and enum values.
- [ ] Do not treat `-listx`'s `writable=true` flag as a complete write recipe. ExifTool's table source carries important `WriteGroup`, `Protected`, conditions, and custom conversion behavior that must also be extracted or explicitly ported.
- [ ] Preserve aliases and duplicate names as a multimap keyed by name + group; never collapse distinct tags into one global name lookup.
- [ ] Represent simple tables as generated data and expression/condition-based behavior as reviewed TypeScript handlers. Fail generation on unclassified writable types instead of silently dropping them.
- [ ] Generate a report listing writable tags without a destination group, value encoder, inverse PrintConv, or test fixture.
- [x] Preserve all `-listx` enum values in the generated catalog; the generation manifest inventories writable types and explicitly lists writable tags with unknown types.
- [x] The manifest records source/version, catalog and XMP-namespace hashes, writable type/enum counts, unresolved `?` tags, and explicitly distinguishes family-1 read groups from preferred write groups.
- [x] Catalog, XMP namespace/shape, Perl write-metadata reports, and manifest regenerate byte-for-byte deterministically from the pinned 13.55 source.
- [x] Generate core Exif/GPS/IPTC/XMP runtime metadata from ExifTool Perl tables, including table read groups, explicit write groups, protection/conditions, list/struct flags, and conversion-handler presence; fail when a selected table cannot load.

**Acceptance:** every upstream writable definition is accounted for as implemented, intentionally unsupported with a reason, or blocked by an unresolved condition. No tag is silently accepted based only on its name.

### B. EXIF, TIFF, and GPS Serializer

- [ ] Replace the small hand-maintained IFD maps with the complete writable ExifTool tables for IFD0, ExifIFD, GPS, InteropIFD, IFD1, SubIFDs, and supported maker-specific TIFF directories.
- [x] Add all relevant TIFF field encoders: BYTE/SBYTE, ASCII, SHORT/SSHORT, LONG/SLONG, RATIONAL/SRATIONAL, UNDEFINED, FLOAT/DOUBLE, plus BigTIFF LONG8/SLONG8/IFD8 where supported.
- [ ] Implement value parsing and validation: signed/unsigned bounds, rational approximation and exact fractions, arrays/counts, null-terminated strings, fixed-count tags, undefined byte payloads, and byte order.
- [x] TIFF `RATIONAL`/`SRATIONAL` components reject fractional, zero-denominator, and out-of-range values before serialization rather than truncating or wrapping.
- [x] Decimal TIFF rationals use a bounded continued-fraction approximation; explicit `numerator/denominator` values remain exact and high-precision ExifTool 13.55 readback passes.
- [x] TIFF unsigned BYTE/LONG numeric writes round fractional inputs before range checks, matching ExifTool; LONG overflow is rejected.
- [x] EXIF `ExifImageWidth` and `ExifImageHeight` use their upstream SHORT storage type rather than LONG; raw TIFF type is regression-tested.
- [x] ExifIFD `SubjectLocation` and IFD0 `PageNumber` write fixed-count two-element SHORT arrays with count and component bounds enforced; ExifTool 13.55 reads back both pairs.
- [x] Fixed-count IFD0 `WhitePoint`, `PrimaryChromaticities`, `HalftoneHints`, `YCbCrCoefficients`, `YCbCrSubSampling`, and `ReferenceBlackWhite` enforce element counts; flattened rational pairs are validated as the declared number of values and pass ExifTool 13.55 readback.
- [x] IFD0 `ProcessingSoftware`, `DocumentName`, `PageName`, `HostComputer`, `TargetPrinter`, `SEMInfo`, `XPosition`, and `YPosition` are writable with ExifTool 13.55 round-trip coverage.
- [x] IFD0 `ImageWidth`, `ImageHeight`, `SubfileType`, and `OldSubfileType` write numeric/raw values with ExifTool 13.55 readback.
- [x] IFD0 `Rating` and `RatingPercent` write SHORT values with ExifTool 13.55 readback.
- [x] IFD0 sample/strip/tile fields `BitsPerSample`, `SamplesPerPixel`, `RowsPerStrip`, `TileWidth`, `TileLength`, `CellWidth`, `CellLength`, `MinSampleValue`, and `MaxSampleValue` pass ExifTool 13.55 readback.
- [x] IFD0 `GeoTiffDirectory`, `GeoTiffDoubleParams`, and `GeoTiffAsciiParams` preserve declared SHORT/DOUBLE/ASCII data through ExifTool 13.55 raw readback.
- [x] DNG `DNGVersion` and `DNGBackwardVersion` accept four bounded version bytes; `UniqueCameraModel` and UTF-8 `LocalizedCameraModel` round-trip through ExifTool 13.55.
- [x] DNG `CameraSerialNumber` and `DNGLensInfo` write through IFD0; lens-range formatting reuses the EXIF LensInfo inverse conversion and passes ExifTool 13.55 readback.
- [x] DNG 1.4 original size/crop, exposure offset, preview gain, profile policy/encoding, black rendering, reel, and camera-label fields use their declared TIFF types and pass ExifTool 13.55 readback.
- [x] DNG calibration illuminants, pre-profile matrices, FrameRate, TStop, and OriginalRawFileName use upstream groups/types and pass ExifTool 13.55 readback.
- [x] DNG `CalibrationIlluminant3` and depth metadata `DepthFormat`, `DepthUnits`, and `DepthMeasureType` write their upstream SHORT enums with ExifTool 13.55 readback.
- [x] DNG RawDataUniqueID, PreviewSettingsDigest, RawImageDigest, OriginalRawFileDigest, and NewRawImageDigest convert validated hex strings to UNDEFINED bytes with source-declared counts; ExifTool 13.55 reads them back.
- [x] DNGPrivateData accepts opaque byte payloads; MakerNoteSafety accepts its ExifTool enum values, both verified by ExifTool 13.55.
- [x] DNG camera/profile signatures, profile names/copyright, preview application/settings strings, and PreviewColorSpace round-trip through ExifTool 13.55; structured ICC payloads remain separate.
- [x] DNG `ColorMatrix1`, `AsShotNeutral`, `AsShotWhiteXY`, and `BaselineExposure` encode signed/unsigned fixed and variable rational calibration values with ExifTool 13.55 readback.
- [x] DNG `ColorMatrix2`, camera calibration, reduction, analog balance, baseline noise/sharpness, linear response, and forward matrices use exact signed/unsigned RATIONAL list encoders.
- [x] EXIF `FileSource`, `SceneType`, and `CFAPattern` encode their UNDEFINED byte representations, including Sigma's four-byte FileSource case and CFA dimension/count validation.
- [x] IFD0 `Orientation`, `ResolutionUnit`, `PhotometricInterpretation`, `Thresholding`, `FillOrder`, `Compression`, `PlanarConfiguration`, and `Predictor` accept exact enum labels or unique partial labels; ambiguous prefixes and duplicate labels are skipped, verified against ExifTool 13.55.
- [x] ExifIFD exposure, metering, lighting, sensing, sensitivity, capture, color-space (including Wide Gamut RGB), and composite-image enums accept ExifTool labels in standalone TIFF writes.
- [x] GPS `GPSDifferential` accepts its ExifTool 13.55 enum labels in standalone TIFF writes.
- [x] Trailing `#` raw-mode keys bypass enum/value conversions in standalone TIFF and JPEG EXIF writes; group-qualified raw requests round-trip numerically.
- [x] IFD0 `SubfileType` accepts ExifTool enum labels while preserving numeric/raw value writes.
- [x] TIFF FLOAT/DOUBLE values encode finite scalar and list values; IFD0 GeoTIFF `PixelScale`, `ModelTiePoint`, and `ModelTransform`, plus DNG `JXLDistance`, pass ExifTool 13.55 readback.
- [x] TIFF SLONG values enforce signed 32-bit bounds; IFD0 `OffsetSchema` passes ExifTool 13.55 readback.
- [x] Classic TIFF field types BYTE through DOUBLE (types 1–12, excluding reserved type 13–15) encode scalar/list values with signed bounds; BYTE accepts opaque `Uint8Array` values and SBYTE is covered directly.
- [x] `buildTiff` supports big-endian output for field values, directory entries, and nested IFD pointers; ExifTool 13.55 reads the complete IFD0/ExifIFD/GPS/InteropIFD graph.
- [x] Fresh little- and big-endian BigTIFF output writes IFD0 plus linked ExifIFD and Interop directories with 64-bit entry counts, offsets, and pointers; LONG8/SLONG8/IFD8 encoders are covered. GPS requests are skipped because ExifTool 13.55 does not read generated BigTIFF GPS directories with GPS tag semantics; thumbnails/SubIFDs remain unsupported.
- [x] Fresh TIFF output can create an IFD1 JPEG thumbnail and calculate its offset alongside ExifIFD, GPS, and Interop directories; ExifTool 13.55 extracts the thumbnail byte-for-byte.
- [x] Fresh TIFF output creates a linked IFD1 JPEG thumbnail with repaired offsets. Ordinary IFD1-qualified tags remain skipped because ExifTool 13.55 does not write them to IFD1; offset-bearing strips remain unsupported.
- [x] Fresh TIFF output can create one DNG SubIFD with LinearizationTable, black/white levels and deltas, crop fields, NoiseProfile/NoiseReductionApplied, ActiveArea/MaskedAreas, and supported rational calibration fields; ExifTool 13.55 readback passes, while rewriting existing SubIFD trees remains refused.
- [x] Fixed-count IFD0 rational tags reject wrong counts for both flattened numerator/denominator lists and scalar inputs; rational arrays and GeoTIFF FLOAT/DOUBLE values are ExifTool 13.55 round-trip tested.
- [x] ExifIFD `SubjectArea` writes variable-count two-to-four-element SHORT arrays while `SubjectLocation` remains exactly two; both pass ExifTool readback.
- [ ] Port inverse PrintConv/ValueConv behavior for enumerations and formatted values. Support numeric/raw writes (`#`), valid enum names, ExifTool's unambiguous partial-value matching, and reject ambiguous or invalid values with actionable diagnostics.
- [x] EXIF `LensInfo` accepts numeric focal/aperture range strings and shorthand forms, expanding them to four rational values verified by ExifTool 13.55; unknown `?` components remain unsupported.
- [x] JPEG EXIF `FocalLength` and GPS `GPSHPositioningError` accept their ExifTool `mm`/`m` PrintConv suffixes and serialize rational values; readback verified by ExifTool 13.55.
- [x] JPEG EXIF `SubjectDistance` accepts finite values with ExifTool's `m` suffix and serializes as a rational; `inf`/`undef` remain unsupported.
- [x] Standalone TIFF writes convert EXIF focal-length/distance unit suffixes, APEX scalar displays, and LensInfo shorthand; explicit rational arrays remain raw pairs.
- [x] GPS `GPSProcessingMethod` and `GPSAreaInformation` emit ExifTool `ASCII\0\0\0` or endian-aware `UNICODE\0` headers; ASCII and Unicode byte payloads pass ExifTool 13.55 readback.
- [x] EXIF `UserComment` shares the ASCII/Unicode header encoder; Unicode UTF-16 payloads pass ExifTool 13.55 readback.
- [x] `ExifVersion` and `FlashpixVersion` normalize valid dotted values to raw four-digit strings and skip malformed lengths per ExifTool 13.55.
- [x] EXIF `ComponentsConfiguration` writes exactly four bounded UNDEFINED bytes and passes ExifTool 13.55 readback.
- [x] JPEG EXIF `ApertureValue`, `MaxApertureValue`, and `ShutterSpeedValue` convert display values to EXIF APEX rationals; nonpositive aperture values map to APEX zero, verified with ExifTool.
- [x] ExifIFD `BrightnessValue` writes signed rational values and passes ExifTool 13.55 numeric readback.
- [x] GPS destination bearing/distance tags and reference codes are writable; all four values pass ExifTool 13.55 readback.
- [x] GPS status, measurement mode, speed unit, and direction-reference PrintConv values convert to their raw GPS codes and pass ExifTool 13.55 readback.
- [x] GPS `GPSAltitudeRef` supports all four ExifTool 13.55 states, including EXIF 3.0 positive/negative sea-level references, verified by raw-code readback.
- [x] Explicit `IFD0:`, `ExifIFD:`, `GPS:`, and `InteropIFD:` keys route only to the requested directory; unqualified Interop tags use their declared default group, and duplicate tag IDs are scoped per directory.
- [x] `InteropIndex` and mandatory `InteropVersion` serialize through the ExifIFD `0xA005` pointer, verified with simultaneous IFD0, ExifIFD, GPS, and InteropIFD data in ExifTool 13.55.
- [x] Fresh InteropIFDs synthesize mandatory `InteropVersion=0100` when another Interop tag is written without an explicit version; ExifTool 13.55 reads the generated pointer and value.
- [x] Fresh GPS IFDs synthesize mandatory `GPSVersionID=2.3.0.0` when GPS entries are written without an explicit version; ExifTool 13.55 reads the generated version and pointer.
- [x] Fresh ExifIFDs synthesize `ExifVersion=0232`, `ComponentsConfiguration=1 2 3 0`, and `ColorSpace=65535` unless explicitly supplied; ExifTool 13.55 reads the defaults.
- [x] ExifIFD `TimeZoneOffset`, sensitivity integers, `ExposureIndex`, `CompositeImageCount`, `RelatedSoundFile`, `FlashEnergy`, `CompressedBitsPerPixel`, `ImageNumber`, `ImageHistory`, and `SecurityClassification` use their declared field types and pass ExifTool 13.55 readback.
- [x] IFD0 `GrayResponseUnit` inverse-converts its decimal labels, `InkSet` uses the upstream enum, and fixed-count `TransferFunction` writes all 768 SHORT values; ExifTool 13.55 readback passes.
- [x] InteropIFD `RelatedImageFileFormat`, `RelatedImageWidth`, and `RelatedImageHeight` write through the nested pointer; the unqualified file-format tag follows its ExifTool default group.
- [ ] Route unqualified tags to ExifTool's preferred group; route group-qualified tags to only that group. Handle tags found in multiple groups, priority, duplicate removal, and the documented IFD0/ExifIFD ambiguity rules.
- [x] When multiple input aliases target the same tag ID in one IFD, the last valid value wins without creating duplicate directory entries; DateTime/ModifyDate behavior matches ExifTool 13.55.
- [ ] Create missing pointer directories and required mandatory tags; remove empty optional directories and handle mandatory tags according to EXIF version/`NoMandatory` behavior.
- [x] `BuildTiffOptions.noMandatory` suppresses synthesized GPS/EXIF/Interop defaults in classic TIFF and BigTIFF while retaining explicit mandatory-tag values; ExifTool 13.55 readback passes for classic TIFF.
- [x] Optional GPS directories are pruned when empty; deleting the final ordinary GPS field preserves the mandatory GPSVersionID exactly as ExifTool 13.55 does.
- [x] ExifIFDs containing only synthesized mandatory defaults are removed after deleting the final ordinary EXIF tag; explicit mandatory writes are retained, matching ExifTool 13.55.
- [x] JPEG merge writes explicit `InteropIFD:` tags through the nested ExifIFD pointer, synthesizes InteropVersion, and serializes nested IFD offsets for ExifTool 13.55 readback.
- [ ] Add update, add, replace, and delete modes for existing tags, including repeated/list values. Preserve unknown entries and binary payloads byte-for-byte when their offsets are not invalidated.
- [x] JPEG/TIFF merge writes normalize negative decimal GPS coordinates to positive DMS magnitudes and synthesize S/W references unless explicitly supplied.
- [ ] Rebase offset-bearing entries when directory layouts change. Preserve thumbnails/previews, strips/tiles, SubIFDs, maker-note base offsets, and out-of-line data. Reject unsafe rewrites when an offset cannot be repaired.
- [x] EXIF rewrites of Olympus TIFF data with MakerNotes are refused rather than shifting their absolute TIFF offsets; XMP/IPTC-only JPEG writes remain allowed.
- [x] Plain TIFF rewrites with strip/tile/SubIFD image offsets are refused when the payload cannot be safely rebased; captured JPEG IFD1 thumbnails remain preserved.
- [x] Reject JPEG EXIF APP1 payloads that exceed the segment limit instead of emitting an invalid JPEG segment.
- [ ] Add TIFF/RAW large-offset handling; test malformed directories and cyclic/deep pointer graphs.

**Acceptance:** all writable standard EXIF/GPS tags selected for supported containers have unit encoders and upstream round-trip tests; adding or deleting one tag cannot alter unrelated decoded metadata or corrupt image data.

### C. IPTC-IIM and Photoshop Resources

- [ ] Cover the complete upstream writable ApplicationRecord and EnvelopeRecord datasets, including repeated fields, fixed/digit values, coded character sets, dataset extension lengths, and record version semantics.
- [x] JPEG APP13 writes IPTC NewsPhotoVersion as record 3 dataset 0 and passes ExifTool 13.55 readback.
- [x] JPEG APP13 writes NewsPhoto image/pixel dimensions (`int16u`), `IPTCBitsPerSample` (`int8u`), and `DataCompressionMethod` (`int32u`) with ExifTool 13.55 readback; remaining NewsPhoto datasets are still open.
- [x] Port all generated IPTC NewsPhoto writable datasets supported by the current string/int8u/int16u/int32u IIM encoder and verify readback in JPEG APP13; broader special NewsPhoto conversions remain open if the upstream table adds non-scalar types.
- [x] Sweep all 105 writable ApplicationRecord, EnvelopeRecord, and NewsPhoto datasets through the IIM encoder; `ActionAdvised` enum labels resolve to fixed-width codes and pass ExifTool 13.55 readback.
- [x] IPTC `RasterizedCaption` and `ObjectPreviewData` write bounded `undef` byte payloads; IIM extended dataset lengths round-trip through ExifTool 13.55.
- [x] IPTC `digits[N]` datasets enforce exact widths for scalar and repeated values, with valid dataset round-trip and malformed widths skipped.
- [x] Generated IPTC `values` tables inverse-convert labels for digits, string-code, and unsigned integer datasets, verified with ExifTool 13.55 across ApplicationRecord and NewsPhoto.
- [x] IPTC By-line supports multiple dataset values, replacement, and deletion while preserving sibling IPTC fields; ExifTool 13.55 readback passes.
- [x] IPTC date datasets accept ExifTool-formatted `YYYY:MM:DD`/`YYYY-MM-DD` values and encode the declared eight digits.
- [x] Explicit IPTC `CodedCharacterSet` accepts `UTF8`, `UTF-8`, and `ESC % G`, storing `ESC%G`; unsupported charset labels are skipped, and new text gets a UTF-8 declaration when the same update deletes the old declaration.
- [x] Photoshop IPTCDigest is recalculated when it matches the pre-edit IPTC MD5; an already-stale digest is preserved as an out-of-sync marker.
- [x] JPEG APP13 splits large Photoshop payloads with repeated headers and reassembles existing Photoshop segments before IPTC updates; a 120 KB preview round-trips unchanged across edits.
- [x] JPEG parsing concatenates consecutive Photoshop APP13 segments and decodes extended-length IIM datasets, including records following large binary previews.
- [ ] Support set/replace/add/delete, repeatable values, character-set conversion, UTF-8 declarations, dataset ordering, and empty-record removal.
- [ ] Expand Photoshop IRB from the IPTC `0x0404` resource to all writable resources; preserve Pascal names, padding, unknown 8BIM/8B64 resources, and resource ordering.
- [x] IPTC updates preserve unrelated ordinary 8BIM/8B64 resource blocks byte-for-byte, including Pascal names and padding.
- [x] Unknown Photoshop IRB resources retain their Pascal names and original data-padding bytes when IPTC is updated.
- [x] Photoshop APP13 scalar resources `CopyrightFlag`, `URL`, `GlobalAngle`, and `GlobalAltitude` support replace/delete and ExifTool 13.55 readback; nested and binary resource types remain open.
- [x] Nested `PhotoshopQuality` updates only an existing `0x0406` resource, preserves sibling fields, and skips without modifying files when the resource is absent.
- [x] Photoshop APP13 `ResolutionInfo` writes X/Y fixed-point resolution and units through shared-resource byte-range patches; local parser and ExifTool 13.55 readback pass.
- [x] Photoshop `PhotoshopThumbnail` and `PhotoshopBGRThumbnail` build the 28-byte ImageSource header from JPEG dimensions and round-trip the embedded JPEG bytes.
- [ ] Integrate IPTC/IRB into every upstream-writable container that supports these families, not just JPEG APP13. Handle APP13 and related metadata that spans multiple JPEG segments.
- [x] Recalculate `IPTCDigest` when it matches the old IPTC block, preserve stale values, and verify stored/current digest semantics with ExifTool 13.55.

**Acceptance:** every writable IPTC dataset and Photoshop resource has an explicit test; ExifTool reads our output and exiftool-ts reads upstream output with equivalent values and groups.

### D. XMP Serializer and Schema Catalog

- [x] `rdf:Alt` shape selection is derived from generated writable XMP metadata for all mapped tables with registered prefixes (including DC, XMP, TIFF, EXIF, IPTC, Camera Raw, ACDSee, digiKam, Dex, and Pur); representative values pass ExifTool 13.55 readback.
- [x] Language-keyed XMP `rdf:Alt` values serialize all translations, put `x-default` first, and preserve ExifTool's default-value readback.
- [x] XMP Photoshop `ColorMode`, EXIF Extended `SensitivityType`, and TIFF `Orientation`/`PlanarConfiguration`/`YCbCrPositioning` labels inverse-convert to numeric storage values; unknown labels are rejected and ExifTool 13.55 readback passes.
- [x] XMP enum matching accepts exact labels or unique case-insensitive prefixes and rejects ambiguous/unknown labels.
- [x] Generated numeric and string-coded XMP enum tables inverse-convert labels to storage values; XMP2 AudioSampleType and GPS references pass ExifTool raw/display readback.
- [x] Generated XMP enum lists convert each item to its storage code before Bag/Seq serialization; PRISM OriginPlatform passes ExifTool raw readback.
- [x] XMP trailing `#` bypasses enum label conversion and accepts numeric storage values only, verified with ExifTool 13.55.
- [x] Generated XMP date properties in supported namespaces normalize valid EXIF-style dates to ISO 8601, preserve fractional seconds/timezones, and reject malformed date-shaped values; PDF, PRISM, PUR, DICOM, and core readback pass ExifTool 13.55.
- [x] XMP property upsert replaces single- or double-quoted description attributes, preserves existing namespace declarations in either quote style, and expands empty self-closing `rdf:Description` elements.
- [x] XMP `xmpRights:Owner`, `xmp:Advisory`, and `xmp:Identifier` use upstream `rdf:Bag` shapes and pass ExifTool 13.55 array readback.
- [x] XMP `photoshop:DocumentAncestors` and `photoshop:SupplementalCategories` serialize as upstream `rdf:Bag` properties and pass ExifTool 13.55 readback; structured list items remain open.
- [x] XMP `Iptc4xmpCore:Scene`/`SubjectCode` serialize as Bags and `xmpTPg:PlateNames` as a Sequence; ExifTool 13.55 array readback passes.
- [x] XMP Lightroom `HierarchicalSubject` and `WeightedFlatSubject` serialize as Bags and pass ExifTool 13.55 readback.
- [x] XMP Camera Raw `ToneCurve` serializes as an ordered Sequence and passes ExifTool 13.55 readback.
- [x] XMP TIFF `BitsPerSample` serializes as an ordered Sequence and passes ExifTool 13.55 readback.
- [x] XMP `xmpTPg:MaxPageSize`, `xmpMM:DerivedFrom`, and `xmpMM:ManagedFrom` support qualified `rdf:parseType="Resource"` structs, nested namespace declarations, and schema-checked child names with ExifTool 13.55 structured readback; other structs and structured lists remain open.
- [x] XMP `xmpMM:Ingredients` supports a Bag of validated ResourceRef structs and passes ExifTool 13.55 structured readback; other struct-list shapes remain open.
- [x] XMP `xmpBJ:JobRef` supports a Bag of `stJob` Resource structs and passes ExifTool 13.55 structured readback.
- [x] XMP `xmp:Thumbnails` supports an `rdf:Alt` of `xmpGImg` structs, including base64-encoded binary images with byte-exact ExifTool readback.
- [x] XMP `xmp:PageInfo` supports a Seq of page image structs, including namespaced page number and base64 binary image readback.
- [x] XMP `photoshop:TextLayers` supports a Seq of Layer structs and passes ExifTool 13.55 structured readback.
- [x] XMP `xmpMM:Manifest` supports Bag ManifestItem structs, including nested ResourceRef fields, with ExifTool 13.55 structured readback.
- [x] XMP `xmpMM:Versions` supports an ordered Seq of Version structs, including nested ResourceEvent values, with ExifTool 13.55 structured readback.
- [x] XMP `xmpMM:History` supports an ordered Seq of scalar ResourceEvent fields with ExifTool 13.55 readback.
- [x] XMP `xmpDM:markers` uses its source-defined lowercase property name and supports scalar Marker fields in an ordered Seq; ExifTool 13.55 readback passes.
- [x] XMP `xmpDM:Tracks` supports a Bag of Track structs with nested Marker Sequences and passes ExifTool 13.55 structured readback.
- [x] XMP `xmpMM:Pantry` supports Bag entries with required `InstanceID` fields and passes ExifTool 13.55 structured readback.
- [x] XMP `xmpTPg:Colorants` supports an ordered Seq of validated Colorant structs with ExifTool 13.55 structured readback.
- [x] XMP `xmpTPg:Fonts` supports a Bag of Font fields including the nested `childFontFiles` Seq, verified with ExifTool 13.55 structured readback.
- [x] XMP `xmpTPg:SwatchGroups` supports an ordered Seq of group structs with nested Colorants Sequences, verified with ExifTool 13.55.
- [x] XMP `Iptc4xmpCore:CreatorContactInfo` supports its scalar contact fields as a qualified struct with ExifTool 13.55 readback.
- [x] XMP `Iptc4xmpExt:AboutCvTerm` supports Bag entries with a multilingual `CvTermName` child; ExifTool 13.55 structured output passes.
- [x] XMP `Iptc4xmpExt:Contributor` and `Creator` support EntityWithRole Bags with identifier/role Bags and a multilingual Name; ExifTool 13.55 structured readback passes.
- [x] XMP `Iptc4xmpExt:ProductInImage` supports a Bag of ProductDetails with multilingual fields and numeric GTIN; ExifTool 13.55 structured readback passes.
- [x] XMP `Iptc4xmpExt:PublicationEvent` supports a Bag of Date/Identifier values and passes ExifTool 13.55 structured readback.
- [x] XMP `Iptc4xmpExt:DopesheetLink` supports a flat Link/LinkQualifier Bag and passes ExifTool 13.55 structured readback.
- [x] XMP `prism:OnSaleDay` supports a Bag of day/platform structs and passes ExifTool 13.55 structured readback.
- [x] XMP `prism:URL` supports a Bag of URL/platform structs and passes ExifTool 13.55 structured readback.
- [x] XMP `Iptc4xmpExt:Genre` reuses the CVTerm Bag and multilingual name schema; ExifTool 13.55 structured output passes.
- [ ] Generate all upstream XMP namespace URIs, property names, types, writable flags, value enums, aliases, and struct definitions. Keep URI-to-prefix mapping canonical and collision-safe.
- [x] Generate all 96 ExifTool 13.55 XMP prefix-to-URI mappings from `XMP.pm` and consume the generated map in the writer; namespace provenance is pinned to the catalog source hash.
- [x] Generate writable XMP Bag/Seq/Alt shapes from ExifTool's loaded namespace tables and merge them under explicit serializer overrides; `Iptc4xmpExt:Creator` passes ExifTool 13.55 readback.
- [x] Generate 108 recursive XMP struct schemas, including field namespaces, nested structs, lists, enums, and conversion flags, from the pinned Perl table API; runtime support remains intentionally schema-checked and partial.
- [x] Resolve generated XMP family-1 group aliases (for example `XMP-iptcExt` and `XMP-getty`) to canonical namespace prefixes, verified through write/readback.
- [x] Fail tag generation when a new writable ExifTool type label appears; retain `?` types in the manifest as explicit manual-review items.
- [ ] Implement RDF/XML parsing and writing for attributes and elements, scalar values, `rdf:Bag`, `rdf:Seq`, `rdf:Alt`, language alternatives, nested structs, qualified properties, namespaces, and `xml:lang`/resource qualifiers.
- [ ] Implement correct list split/join, language selection, numeric/raw modes, date/time formatting, enum inverse conversions, and structured-property flattening expected by ExifTool.
- [x] Upsert and delete matching XMP attributes/elements across sibling top-level `rdf:Description` elements without discarding unrelated descriptions; nested Camera Raw descriptions remain untouched. ExifTool 13.55 readback passes.
- [ ] Upsert without duplicating an existing property represented as either attribute or element; preserve unknown properties, packet wrappers, processing instructions, xpacket padding, and unrelated RDF descriptions.
- [ ] Support property/group selection, creation, replacement, append/add, deletion, empty-structure cleanup, and XMP sidecar creation/merge.
- [ ] Integrate XMP packet location and update semantics for JPEG, PNG, WebP, AVIF/HEIC/HEIF, TIFF/RAW, PDF, video, and every other applicable upstream-writable container.
- [x] Split oversized fresh JPEG XMP packets into a standard HasExtendedXMP pointer and MD5-addressed APP1 extension chunks; ExifTool 13.55 reads the full packet.
- [x] Reassemble existing JPEG Extended XMP packets before update/delete; validate chunk lengths, offsets, and MD5 GUID, and remove obsolete chunks when the packet shrinks.
- [ ] Enforce packet/box size constraints and use container-supported multipart storage for XMP outside JPEG.

**Acceptance:** generated schema completeness report has no unexplained writable properties; tests cover each RDF value shape, namespace, group routing, and upsert/delete behavior; ExifTool parity verifies semantic output.

### E. MakerNotes

- [ ] Extract the exact vendor/module list and per-vendor writable tag tables from the 13.55 source; include conditionally writable tags and protected tags.
- [ ] Build vendor-specific read/modify/write adapters for Canon, Casio, DJI, FLIR, FujiFilm, GE, HP, JVC, Kodak, Leaf, Minolta/Konica-Minolta, Nikon, Nintendo, Olympus/Epson, Panasonic/Leica, Pentax/Asahi, Phase One, Reconyx, Ricoh, Samsung, Sanyo, Sigma/Foveon, Sony, and every additional vendor supported by the pinned source.
- [ ] Port each vendor's tag ID, type, byte order, base-offset rule, encryption, checksum, version/model condition, value conversion, and write priority.
- [ ] Preserve opaque/unknown tags and encrypted sections exactly. Do not rewrite a vendor block if an offset, checksum, encryption key, or proprietary structure cannot be preserved safely.
- [ ] Handle Olympus absolute TIFF offsets and other non-maker-relative offsets when any TIFF directory/value moves. Handle embedded Makernotes in DNG/CR3 and maker-specific raw wrappers individually.
- [ ] Add redistributable fixtures by vendor/model and compare both output tags and unchanged maker-note bytes against the upstream writer.

**Acceptance:** vendor support is reported individually; each advertised vendor/model family passes value, offset, preservation, corruption, and upstream read-after-write tests. No blanket “MakerNotes writable” claim before those gates pass.

### F. Other Writable Metadata Families

- [ ] ICC Profile: edit/create/delete profiles and tags, preserve unknown profile elements, maintain declared size and valid profile structure; integrate ICC-in-file and standalone `.icc` behavior.
- [ ] JFIF: writable density/unit/comment fields and exact APP0 preservation/update behavior.
- [x] Ducky APP12 writes the three ExifTool 13.55 fields (Quality, Comment, Copyright) and preserves unknown blocks byte-for-byte.
- [ ] Ducky APP12 duplicate-block ordering and APP12 size-limit parity.
- [ ] MIE: create, read-modify-write, delete, group, and binary block behavior, including large files and nested sections.
- [ ] PDF: XMP, PDF Info dictionary, and other upstream-writable PDF metadata; preserve incremental/object structure or deliberately rewrite safely, and account for encryption, signatures, and linearization.
- [ ] PNG metadata: XMP, EXIF, ICC, textual chunks, and standard PNG metadata fields with correct chunk ordering and CRCs.
- [ ] Canon VRD: create/edit/delete VRD blocks and preserve associated proprietary preview data.
- [ ] GeoTIFF: GeoKey directory, doubles, ASCII parameters, and dependent-tag consistency.
- [ ] CIFF, AFCP, Kodak Meta, FotoStation, and PhotoMechanic: port writable blocks and value conversions; these are upstream `r/w`, not `r/w/c`.
- [ ] Explicitly model all other upstream metadata families as read-only for the pinned version; do not allow generic container rewrites to mutate them accidentally.

**Acceptance:** each family is tested in every container where upstream can write it; binary payload and unrelated-family preservation tests are mandatory.

### G. Container Adapters for the Exact Writable File Matrix

Implement and test one adapter per upstream file type from the inventory, reusing serializers only where the underlying structure is genuinely shared:

- [ ] JPEG/JFIF/MPF/Photoshop APP segments: insertion, replacement, deletion, multi-segment APP2/APP13/COM, size limits, preview offsets, MPF offsets, segment order.
- [ ] TIFF/EXIF/EXV and TIFF-family RAW: classic TIFF and BigTIFF, all IFD chains, thumbnails/previews, RAW offsets, compressed data, camera-specific blocks; per-type safety decisions.
- [ ] PNG/GIF/JNG/MNG/FLIF/PBM/PGM/PPM/WEBP/WDP/HDP: format-specific chunk/block metadata, CRC/length/padding updates, pixel-data preservation.
- [ ] AVIF/HEIC/HEIF/3G2/3GP/MOV/MP4/M4A/V/F4A/V/MQV/QTIF/GLV/AAX: ISO-BMFF boxes, metadata items/keys, tracks, offsets, extended sizes, fragments, and unknown box preservation.
- [ ] JP2/JXL: box/container metadata, compression and extended lengths, profile/XMP/EXIF blocks, unknown box preservation.
- [ ] PSD/PSB/AI/EPS/PS/IND: document resource blocks, lengths, padding, preview/proprietary data, and safe rewriting.
- [ ] PDF: object/xref handling, metadata updates, incremental-write choice, encrypted files, signatures, and linearization.
- [ ] MIE/ICC/XMP/EXIF/EXV/VRD/DR4 standalone types: create/write separately from in-place update; honor the exact upstream `r/w/c` distinction.
- [ ] CR2/CR3/CRM/CRW/ARW/ARQ/DNG/ERF/FFF/IIQ/MEF/MOS/MRW/NEF/NKSC/NRW/ORF/ORI/PEF/RAF/RAW/RW2/RWL/SR2/SRW/X3F/CS1: implement the specific wrapper and offset changes for each type; no group-wide assumption that one TIFF writer covers all RAW variants.
- [ ] 360/DCP/GPR/LRV/THM/DR4/VRD and remaining matrix entries: inspect the upstream writer module and add type-specific adapter and fixtures.

For every row: implement write-existing, add-new, replace, delete, no-op, malformed input, unsupported operation, preservation, backup, and ExifTool round-trip cases. `create` tests are required only for `DR4`, `EXIF`, `EXV`, `ICC`, `MIE`, `VRD`, and `XMP` unless the upstream version changes.

### H. ExifTool Write Operations and CLI/API

- [x] CLI reports explicitly requested tags returned in `skipped`; writes with no accepted requested tags fail before replacing the source. Full group/name resolution and conversion parity remain open.
- [ ] `-TAG=VALUE`: resolve all groups/aliases, validate ExifTool conversions, write to preferred groups, and report per-tag failures for unsupported values.
- [x] JPEG explicit `IFD0:`, `ExifIFD:`, and `GPS:` tag prefixes route only to their matching IFD; mismatched groups are skipped. Verified with ExifTool 13.55 readback.
- [x] JPEG EXIF Orientation accepts all eight ExifTool PrintConv strings and unique prefixes, rejects ambiguous prefixes, and serializes numeric values verified by ExifTool 13.55.
- [x] JPEG EXIF ExposureProgram accepts all ten ExifTool PrintConv values and unique prefixes, rejects ambiguous prefixes, and serializes numeric values verified by ExifTool 13.55.
- [x] JPEG EXIF MeteringMode accepts all eight ExifTool PrintConv values and unique prefixes, rejects ambiguous prefixes, and serializes numeric values verified by ExifTool 13.55.
- [x] JPEG EXIF `Flash` accepts all pinned PrintConv values plus the `On`/`Off` aliases; each raw value and invalid-value rejection is tested against ExifTool 13.55.
- [x] JPEG EXIF `LightSource` accepts all 22 defined ExifTool 13.55 PrintConv labels and serializes each matching numeric code.
- [x] JPEG EXIF `ImageUniqueID` is writable as an ExifIFD ASCII tag and passes ExifTool 13.55 readback.
- [x] ExifIFD `RelatedSoundFile` writes as a string and passes ExifTool 13.55 readback.
- [x] ExifIFD `SpectralSensitivity` writes as a plain string and passes ExifTool 13.55 readback.
- [x] ExifIFD `ImageTitle` through `MetadataEditingSoftware` (`0xA436-0xA43C`) are writable strings and pass ExifTool 13.55 readback.
- [x] ExifIFD EXIF 3.0 sensitivity fields (`SensitivityType`, SOS, REI, ISO speed, and latitude values) are writable; all eight `SensitivityType` enums pass ExifTool readback.
- [x] ExifIFD `SelfTimerMode` is mapped as a writable SHORT and passes ExifTool 13.55 readback.
- [x] ExifIFD `TimeZoneOffset` writes one or two signed SHORT values and rejects longer lists; both accepted counts pass ExifTool 13.55 readback.
- [x] ExifIFD `ISO`/`ISOSpeedRatings` writes variable-count SHORT lists from arrays or comma-separated strings and passes ExifTool 13.55 readback.
- [x] EXIF 2.32 `CompositeImage` supports all four PrintConv values; `CompositeImageCount` writes its fixed two-SHORT pair, both verified with ExifTool 13.55.
- [x] ExifIFD `0xA401-0xA40A` and `0xA40C` scalar enum tags, plus `DigitalZoomRatio` and `FocalLengthIn35mmFormat`, are writable and ExifTool-verified; binary `DeviceSettingDescription` remains unsupported.
- [x] ExifIFD `SensingMethod` supports all seven defined ExifTool 13.55 PrintConv values with numeric readback verification.
- [x] ExifIFD `FileSource` standard labels, the Sigma legacy byte payload, and `SceneType` encode to their documented UNDEFINED bytes and pass ExifTool readback.
- [x] JPEG EXIF ResolutionUnit accepts its three ExifTool PrintConv values and unique prefixes, with numeric serialization verified by ExifTool 13.55.
- [x] JPEG EXIF ColorSpace accepts all five ExifTool PrintConv values and unique prefixes, with numeric serialization verified by ExifTool 13.55.
- [x] JPEG EXIF FocalPlaneResolutionUnit and GPSDifferential accept their documented ExifTool 13.55 PrintConv values and serialize to matching numeric values.
- [x] Null assignments delete requested properties from JPEG, PNG, and WebP XMP packets while preserving siblings; deleting the last property removes the packet/chunk and clears the WebP XMP flag. Sidecars are removed when emptied; standalone XMP writes reject an empty document.
- [x] Empty `IPTC:Keywords` assignment deletes only the JPEG IPTC datasets and preserves XMP Subject.
- [ ] General `-TAG=` / API null deletion across applicable groups; remove empty optional groups and handle mandatory tags according to upstream behavior.
- [x] Null EXIF assignments delete one targeted tag in JPEG, PNG, and WebP while preserving unrelated EXIF entries.
- [x] Standalone TIFF null EXIF assignments delete one entry while preserving unrelated IFD tags.
- [x] `-TAG+=VALUE` appends XMP `Subject`/`Keywords`, `Creator`, `Contributor`, `Publisher`, `Language`, `Relation`, `Type`, `Identifier`, and `Date`, plus JPEG `IPTC:Keywords`, to each target's existing list; duplicate XMP list values are preserved as upstream does; unsupported scalar `+=` requests fail before writing.
- [x] `-TAG-=VALUE` removes the first matching item from supported XMP lists; absent values are true no-ops and unsupported scalar removals fail before mutation. IPTC Keywords `-=` remains a no-op, matching upstream.
- [ ] General `-TAG+=VALUE` and list operations: support all repeatable tags, list split/join, duplicate policy, write order, and tag-specific list semantics.
- [x] Basic `w`/`c` gating uses parsed tag presence; for XMP, `w` and `c` may add properties only to an existing XMP packet, while `g` allows creating the packet.
- [ ] Complete `-wm MODE` parity for group creation and metadata-specific existing-tag detection.
- [x] Basic `-tagsFromFile FILE` copy supports repeated sources in order, with later sources overriding earlier ones and explicit assignments applied last.
- [x] Bare `-TAG` / `--TAG` operands include/exclude source tags when `-tagsFromFile` is active; unselected target metadata remains untouched.
- [x] Simple `*` and `?` wildcards match bare source tag names in `-tagsFromFile` selectors.
- [x] Basic `-DSTTAG<SRCTAG` mappings copy one source value to a differently named destination, scoped to the active source.
- [x] `-tagsFromFile @` reads each target as a source and preserves its position among repeated source requests.
- [x] Repeatable `-srcfile FMT` candidates resolve from the original target name, choose the first existing file, and leave `@` bound to the original input.
- [ ] Advanced `-tagsFromFile`: group-qualified selector semantics and transformations applied to copied values.
- [x] Basic `-if` write filtering evaluates target tags before mutation and leaves nonmatching files untouched.
- [x] `-if` supports comparisons, `=~`/`!~` slash-delimited regexes (`i`/`m`/`s`/`u` flags), `and`/`or` or `&&`/`||`, AND-before-OR precedence, and parenthesized groups; full ExifTool expression semantics remain open.
- [x] Read mode applies bare `-TAG` / `--TAG` selectors, including simple `*` and `?` wildcards, after condition filtering.
- [x] `-all` selects every tag in read and tagsFromFile projection modes.
- [ ] Group and tag selection: support family-qualified names, `-GROUP:all`, grouped wildcards, duplicate groups, preferred groups, numeric/raw tag names, and precedence when multiple groups contain the same logical tag. Runtime parsing currently flattens some group identities.
- [x] Basic `-o FILE` writes one input to a new destination; `.xmp` destinations use the sidecar writer without modifying the media; `-o -` streams one updated image byte stream per input and formatted text in read mode; existing directories accept batches using source basenames, and parent directories are created as needed; `%d`/`%D`/`%f`/`%F`/`%e`/`%E` source-path tokens expand per input; lowercase `%c` uses supported sign/width collision suffixes and uppercase `%C` counts from zero. Sources remain unchanged, known cross-format output extensions are rejected using the parser registry, existing files are not overwritten, and multiple inputs to one literal file destination are rejected. Actual format conversion remains unsupported.
- [x] `-P` preserves the input modification time for in-place writes and separate `-o` outputs; output-directory batches continue after a per-file failure and return a failing status if any input fails.
- [x] `FileModifyDate` assignments update filesystem mtime directly; date-only writes leave metadata bytes unchanged and create no backup, while explicit dates override `-P` in mixed writes.
- [x] In-place metadata replacement preserves source permission bits across the atomic temp-file rename.
- [x] `-overwrite_original_in_place` suppresses the backup and updates the existing inode, preserving hard links; broader ExifTool filesystem-attribute parity remains open.
- [x] Write mode reuses recursive input expansion and case-insensitive `-ext` filtering; nested matching files are written and nonmatching extensions are skipped.
- [x] `-q` suppresses per-file write diagnostics without masking a failing exit status.
- [x] Stay-open batches accept numbered `-executeN` commands and emit the matching `{readyN}` response.
- [ ] Output/filesystem semantics: `-o`, extension-derived destinations, overwrite-original options, backups, `-P`, file permissions and timestamps, sidecars, recursion, full condition grammar, per-file errors, partial batch success, and stable exit statuses.
- [x] `-b` emits selected binary tag values as raw bytes; explicit tag selection is covered byte-for-byte.
- [ ] Binary writes: binary block copy, output delimiters/concatenation behavior, and no accidental concatenation of unrelated binary tags.
- [ ] Date/time and geotag write workflows: port `-geotag`, `-geosync`, `-geotime`, `-globalTimeShift`, and other documented write transformations if the goal includes full CLI parity; keep these distinct from basic tag assignment.
- [ ] Programmatic API: request/result types must represent set/add/delete/copy, source selection, write mode, warnings, and per-tag failures. `ExifTool.write`, `writeBytes`, sidecar APIs, and CLI must share the same request model.
- [ ] Help text, generated capabilities, and docs must advertise only implemented options and format/family combinations.

**Acceptance:** use upstream `t/Writer.t`, format-specific `vendor/exiftool/t/*.t` write cases, and purpose-built differential tests as the behavioral inventory. Each implemented operation compares bytes where exact preservation is expected, metadata semantics where serialization differs, diagnostics, exit code, and output files.

### I. Release and Upgrade Gates

- [ ] Produce a checked-in machine-readable format/family/operation matrix with statuses `implemented`, `partial`, `read-only`, `unsafe`, or `not-started` and links to tests.
- [ ] CI runs focused tests for every `implemented` cell; a feature cannot be marked implemented if its reference ExifTool test skipped.
- [x] Keep the vendored source pinned at ExifTool 13.55; verified `vendor/exiftool/exiftool -ver` reports `13.55`.
- [ ] When updating ExifTool, diff file-type flags, metadata-family flags, writable tag definitions, write groups, protected/mode behavior, and upstream writer tests; require review of every change.
- [ ] Publish the remaining `partial` and `not-started` cells in docs and report exact reasons. “Full parity” is reached only when no upstream `r/w` or `r/w/c` cell in scope remains partial or unexplained.

## Phases

Phases below map directly to the remaining tracker items. Serializers are the first implementation priority because container adapters, assignments, deletion, and copy workflows all depend on correct family-level encoding. Section A-I remains the detailed acceptance checklist; a phase is complete only when its specific exit gate passes.

### Phase 0: Establish the Parity Baseline

**Tracker:** differential capability gates, baseline prerequisites.

- Pin the matrix and tag catalog to ExifTool 13.55; record upstream version/hash and distinguish read, write, and create support.
- Reconcile code, tests, docs, and divergences for existing adapters, especially plain TIFF versus RAW behavior and MakerNote safety.
- Capture reference fixtures and assign matrix statuses per format, family, and operation.

**Exit gate:** every current capability has a test-backed status; unexplained support claims are removed before new support is added. See sections A and I.

### Phase 1: Complete Core Serializers (Highest Implementation Priority)

**Tracker:** serializers and containers, serializer portion.

Implement family encoders independently from container mutation, in this order:

1. EXIF/TIFF/GPS: complete writable tag catalog, group routing, data types, conversions, IFD graph safety, deletion, and offset preservation.
2. XMP: namespace/schema catalog, RDF scalar and structured forms, arrays, language alternatives, merge/delete, and sidecar semantics.
3. IPTC-IIM and Photoshop IRB: complete writable datasets/resources, repetition, character sets, deletion, ordering, and preservation.
4. ICC and format metadata blocks: tag-level operations, validation, lengths/checksums, and opaque-field preservation.
5. MakerNotes: preserve by default; add vendor-specific edits only with safe offset/checksum handling and redistributable fixtures.

For every serializer, test semantic round trips and byte preservation of unrelated blocks. Do not report support for an unimplemented family based on container writeability.

**Exit gate:** each claimed family/tag cell has focused unit and ExifTool 13.55 differential tests. See sections B-F.

### Phase 2: Complete Existing Container Adapters, Then Expand

**Tracker:** serializers and containers, container portion.

- Close the supported subsets and known structural gaps in JPEG/MPO, PNG, WebP, AVIF/HEIF, and plain TIFF using the Phase 1 serializers.
- Add standalone create/update behavior for upstream `r/w/c` types with separate create tests.
- Evaluate each TIFF-family RAW type individually; keep unsafe types read-only and document why.
- Add ISO-BMFF, PDF, JP2/JXL, PSD/PSB, and remaining formats only in fixture-backed batches.
- Test malformed/truncated data, offsets and sizes, duplicate blocks, padding, checksums, unknown-block preservation, and failure atomicity.

**Exit gate:** each newly advertised container/family/operation has structural tests, preservation tests, and upstream read-after-write verification. See sections C-G.

### Phase 3: Finish Assignment, Group Resolution, Deletion, and Write Modes

**Tracker:** assignment and delete semantics.

- Build shared tag resolution for names, aliases, family/group-qualified requests, duplicate names, and preferred write groups; migrate writer-specific resolution onto it incrementally.
- Complete value conversion, numeric/raw syntax, exact and unambiguous enum matching, and per-tag failures for `-TAG=VALUE`.
- Complete `-TAG=` and API-null deletion across supported families, including empty optional and mandatory-group behavior.
- Finish metadata-aware `-wm w/c/g` behavior and keep failures from mutating source files.

**Exit gate:** grouped collisions, invalid values, existing/missing tags, delete behavior, and write modes match ExifTool on supported cells. See section H assignment/delete/write-mode items.

### Phase 4: Generalize List Operations and Tag Copy

**Tracker:** list and copy workflows.

- Extend append/remove/set semantics to every supported repeatable tag with tag-specific duplicate, ordering, split/join, and empty-list rules.
- Complete `-tagsFromFile` group-qualified selection, wildcard/`-all` behavior, transformations, mappings, source ordering, `@`, and `-srcfile` interactions.
- Define precedence among multiple copy sources, assignments, append/remove operations, and deletes.

**Exit gate:** differential tests cover repeated values, groups, source ordering, transformations, precedence, and no-op behavior. See section H list/copy items.

### Phase 5: Finish Filesystem, Batch, and Output Semantics

**Tracker:** filesystem and batch parity.

- Complete output naming/destinations, overwrite and backup choices, sidecars, timestamps, permissions, and platform-specific attributes. The tested inode/hard-link behavior for `-overwrite_original_in_place` is complete; remaining native metadata attributes are not.
- Finish recursive and conditional batches, per-file/per-tag diagnostics, partial success, stay-open option parity, and stable exit codes.
- Preserve atomicity and clean temporary files on all pre-commit failures.

**Exit gate:** single and mixed-success batch tests match output files, backups, metadata, diagnostics, and exit codes. See section H output/filesystem items.

### Phase 6: Complete Binary, Date/Geotag, and Shared API Workflows

**Tracker:** remaining CLI/API behavior.

- Define binary write selection and framing so unrelated binary tags are never concatenated implicitly.
- Implement geotag/time-shift workflows only if they remain in the declared compatibility scope; otherwise record them explicitly as unsupported.
- Unify set/add/delete/copy requests and results across `ExifTool.write`, `writeBytes`, sidecars, and CLI; generate help and capabilities from implemented behavior.

**Exit gate:** API and CLI exercise the same request semantics, binary framing is differential-tested, and help/capabilities expose only supported behavior. See section H.

### Phase 7: Differential Release Gates and Documentation

**Tracker:** differential capability gates.

- Maintain a machine-readable format/family/operation matrix with status, reason, fixture, and test links.
- Run focused bidirectional ExifTool comparisons for every `implemented` cell in CI; track intentional divergences with removal conditions.
- Publish separate read/write/create support tables and update parity docs, API docs, help, and examples as phases land.

**Exit gate:** no advertised capability lacks a passing focused test; no claimed cell has an unexplained divergence; docs and runtime capability data agree. See sections I and the documentation requirements in H.

## Non-Goals and Guardrails

- Do not implement writes for formats that upstream marks read-only just to claim broad coverage.
- Do not promise lossless rewriting of encrypted, signed, proprietary, or unknown metadata blocks without a format-specific preservation strategy.
- Do not copy ExifTool's entire Perl implementation mechanically; port observable write semantics and format algorithms with focused TypeScript modules.
- Do not make broad write support depend on a single “all tags” serializer. Container layout, metadata serialization, and CLI request semantics remain separate layers.

## References

- Pinned upstream capability inventory: `vendor/exiftool/README`
- Current format writer contract: `src/format/mod.ts`
- Current write pipeline: `src/write/pipeline.ts`
- Container writers: `src/write/writers.ts`
- TIFF/EXIF serializer: `src/exif/tiff-builder.ts`
- XMP serializer and merge behavior: `src/write/xmp-writer.ts`
- Existing write tests: `src/write/` and `src/exiftool.test.ts`
- Public write options and results: `src/types.ts`
