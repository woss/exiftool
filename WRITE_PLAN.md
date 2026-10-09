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
| `PNG` | Partial EXIF merge preserving unrelated eXIf entries, fresh ExifIFD/GPS directories, negative GPS coordinate reference synthesis, partial XMP, tEXt/iTXt/zTXt text writing including language-qualified iTXt, optional `-z` compression, existing text-chunk form preservation on update, eligible post-IDAT text/EXIF chunk hoisting, RFC-1123 `CreationTime` and ISO `CreateDate`/`ModDate` normalization, canonical names for special writable text keywords; iCCP ICC field parsing and profile set/delete; pHYs/gAMA/sRGB fields; tIME ModifyDate set/delete | Full `eXIf`, ICC tag editing, remaining writable text/tag conversions and groups, all writable PNG metadata semantics, advanced ordering/barrier cases, unknown-chunk preservation, CRC and delete behavior. ExifTool only writes the fake `PNG:ProfileName` field when `ICC_Profile` is written; name-only requests are skipped. |
| `WEBP` | Partial EXIF/XMP plus ICCP whole-profile set/delete | Full EXIF/XMP write semantics, ICC tag editing, chunk flags/order/padding, absent/present chunk cases, and unknown chunk preservation |
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

- [ ] Pin the catalog to ExifTool 13.55 and make the generation script record the upstream version/hash used.
- [ ] For every writable tag, capture canonical name, ID, metadata family, actual read group, preferred write group, supported file types, type, count, list shape, writable/protected status, mandatory status, and enum values.
- [ ] Do not treat `-listx`'s `writable=true` flag as a complete write recipe. ExifTool's table source carries important `WriteGroup`, `Protected`, conditions, and custom conversion behavior that must also be extracted or explicitly ported.
- [ ] Preserve aliases and duplicate names as a multimap keyed by name + group; never collapse distinct tags into one global name lookup.
- [ ] Represent simple tables as generated data and expression/condition-based behavior as reviewed TypeScript handlers. Fail generation on unclassified writable types instead of silently dropping them.
- [ ] Generate a report listing writable tags without a destination group, value encoder, inverse PrintConv, or test fixture.

**Acceptance:** every upstream writable definition is accounted for as implemented, intentionally unsupported with a reason, or blocked by an unresolved condition. No tag is silently accepted based only on its name.

### B. EXIF, TIFF, and GPS Serializer

- [ ] Replace the small hand-maintained IFD maps with the complete writable ExifTool tables for IFD0, ExifIFD, GPS, InteropIFD, IFD1, SubIFDs, and supported maker-specific TIFF directories.
- [ ] Add all relevant TIFF field encoders: BYTE/SBYTE, ASCII, SHORT/SSHORT, LONG/SLONG, RATIONAL/SRATIONAL, UNDEFINED, FLOAT/DOUBLE, plus BigTIFF LONG8/SLONG8/IFD8 where supported.
- [ ] Implement value parsing and validation: signed/unsigned bounds, rational approximation and exact fractions, arrays/counts, null-terminated strings, fixed-count tags, undefined byte payloads, and byte order.
- [ ] Port inverse PrintConv/ValueConv behavior for enumerations and formatted values. Support numeric/raw writes (`#`), valid enum names, ExifTool's unambiguous partial-value matching, and reject ambiguous or invalid values with actionable diagnostics.
- [ ] Route unqualified tags to ExifTool's preferred group; route group-qualified tags to only that group. Handle tags found in multiple groups, priority, duplicate removal, and the documented IFD0/ExifIFD ambiguity rules.
- [ ] Create missing pointer directories and required mandatory tags; remove empty optional directories and handle mandatory tags according to EXIF version/`NoMandatory` behavior.
- [ ] Add update, add, replace, and delete modes for existing tags, including repeated/list values. Preserve unknown entries and binary payloads byte-for-byte when their offsets are not invalidated.
- [ ] Rebase offset-bearing entries when directory layouts change. Preserve thumbnails/previews, strips/tiles, SubIFDs, maker-note base offsets, and out-of-line data. Reject unsafe rewrites when an offset cannot be repaired.
- [ ] Add JPEG EXIF APP1 size handling and TIFF/RAW large-offset handling; test malformed directories and cyclic/deep pointer graphs.

**Acceptance:** all writable standard EXIF/GPS tags selected for supported containers have unit encoders and upstream round-trip tests; adding or deleting one tag cannot alter unrelated decoded metadata or corrupt image data.

### C. IPTC-IIM and Photoshop Resources

- [ ] Cover the complete upstream writable ApplicationRecord and EnvelopeRecord datasets, including repeated fields, fixed/digit values, coded character sets, dataset extension lengths, and record version semantics.
- [ ] Port IPTC NewsPhoto writable entries and any special dataset conversion rules only where the upstream table marks them writable and the corresponding container supports them.
- [ ] Support set/replace/add/delete, repeatable values, character-set conversion, UTF-8 declarations, dataset ordering, and empty-record removal.
- [ ] Expand Photoshop IRB from the IPTC `0x0404` resource to all writable resources; preserve Pascal names, padding, unknown 8BIM/8B64 resources, and resource ordering.
- [ ] Integrate IPTC/IRB into every upstream-writable container that supports these families, not just JPEG APP13. Handle APP13 and related metadata that spans multiple JPEG segments.
- [ ] Preserve or intentionally recalculate IPTC digest tags when Photoshop IPTC changes; verify digest behavior against upstream.

**Acceptance:** every writable IPTC dataset and Photoshop resource has an explicit test; ExifTool reads our output and exiftool-ts reads upstream output with equivalent values and groups.

### D. XMP Serializer and Schema Catalog

- [ ] Generate all upstream XMP namespace URIs, property names, types, writable flags, value enums, aliases, and struct definitions. Keep URI-to-prefix mapping canonical and collision-safe.
- [ ] Implement RDF/XML parsing and writing for attributes and elements, scalar values, `rdf:Bag`, `rdf:Seq`, `rdf:Alt`, language alternatives, nested structs, qualified properties, namespaces, and `xml:lang`/resource qualifiers.
- [ ] Implement correct list split/join, language selection, numeric/raw modes, date/time formatting, enum inverse conversions, and structured-property flattening expected by ExifTool.
- [ ] Upsert without duplicating an existing property represented as either attribute or element; preserve unknown properties, packet wrappers, processing instructions, xpacket padding, and unrelated RDF descriptions.
- [ ] Support property/group selection, creation, replacement, append/add, deletion, empty-structure cleanup, and XMP sidecar creation/merge.
- [ ] Integrate XMP packet location and update semantics for JPEG, PNG, WebP, AVIF/HEIC/HEIF, TIFF/RAW, PDF, video, and every other applicable upstream-writable container.
- [ ] Enforce packet/segment/box size constraints and use extended XMP or container-supported multipart storage where ExifTool does.

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
- [ ] Ducky APP12: writable quality/comment/alpha fields and block ordering/size behavior.
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

- [ ] `-TAG=VALUE`: resolve group/name/alias, validate conversion, write in preferred group, report a failure when no eligible destination accepts the value.
- [ ] `-TAG=` / API null: delete from applicable groups; remove empty optional groups; retain or remove mandatory tags according to upstream behavior.
- [ ] `-TAG+=VALUE` and list operations: append without replacing; honor repeatable tags, list split/join, duplicate policy, and tag-specific list semantics.
- [ ] `-wm MODE`: implement ExifTool write/create mode combinations and prevent creation or replacement when the selected mode disallows it.
- [ ] `-tagsFromFile FILE`: basic parsed-tag copy is implemented; remaining work includes selected/group-qualified tags, wildcards, tag renames, ordering, `-srcfile`, same-file `@`, multiple sources, and transformations applied to copied values.
- [ ] Group and tag selection: support family-qualified names, `-GROUP:all`, tag wildcards, exclusions, duplicates, preferred groups, numeric/raw tag names, and precedence when multiple groups contain the same logical tag.
- [ ] Output/filesystem semantics: `-o`, extension-derived destinations, overwrite-original options, backups, `-P`, file permissions and timestamps, sidecars, recursion, conditions, per-file errors, partial batch success, and stable exit statuses.
- [ ] Binary writes: explicit tag selection, raw bytes, binary block copy, output delimiters/concatenation behavior, and no accidental concatenation of unrelated binary tags.
- [ ] Date/time and geotag write workflows: port `-geotag`, `-geosync`, `-geotime`, `-globalTimeShift`, and other documented write transformations if the goal includes full CLI parity; keep these distinct from basic tag assignment.
- [ ] Programmatic API: request/result types must represent set/add/delete/copy, source selection, write mode, warnings, and per-tag failures. `ExifTool.write`, `writeBytes`, sidecar APIs, and CLI must share the same request model.
- [ ] Help text, generated capabilities, and docs must advertise only implemented options and format/family combinations.

**Acceptance:** use upstream `t/Writer.t`, format-specific `vendor/exiftool/t/*.t` write cases, and purpose-built differential tests as the behavioral inventory. Each implemented operation compares bytes where exact preservation is expected, metadata semantics where serialization differs, diagnostics, exit code, and output files.

### I. Release and Upgrade Gates

- [ ] Produce a checked-in machine-readable format/family/operation matrix with statuses `implemented`, `partial`, `read-only`, `unsafe`, or `not-started` and links to tests.
- [ ] CI runs focused tests for every `implemented` cell; a feature cannot be marked implemented if its reference ExifTool test skipped.
- [ ] Keep the vendored source at a recorded release and verify `exiftool -ver` equals the matrix version.
- [ ] When updating ExifTool, diff file-type flags, metadata-family flags, writable tag definitions, write groups, protected/mode behavior, and upstream writer tests; require review of every change.
- [ ] Publish the remaining `partial` and `not-started` cells in docs and report exact reasons. “Full parity” is reached only when no upstream `r/w` or `r/w/c` cell in scope remains partial or unexplained.

## Phases

### 0. Establish the Write-Parity Baseline

- Extract the upstream `r/w/c` file-type and metadata-format matrix for pinned ExifTool 13.55 into a machine-reviewable inventory or a compact maintained table.
- Run capability probes against ExifTool for representative tags and write operations; do not infer writeability from read support or tag-table presence.
- Record the port's current behavior per matrix cell, including plain TIFF versus camera RAW, embedded metadata versus XMP sidecar, and format-specific exceptions.
- Resolve conflicts between implementation, tests, API docs, and comments before expanding the support claim.
- Capture reference outputs and representative fixtures for each initial format and metadata family.

**Exit gate:** every advertised writable format has an explicit passing test; unimplemented upstream-writeable cells are listed and prioritized.

### 1. Define Stable Write Semantics

- Specify normalized tag keys, group-qualified names, aliases, duplicate handling, tag precedence, and behavior for unknown/read-only tags.
- Extend `WriteOptions` only for behavior the implementation can guarantee: overwrite/backup policy, preserve modification time, write mode, and failure policy.
- Make result reporting consistent: distinguish written, skipped, deleted, and failed requests; include warnings for destructive format limitations.
- Keep the existing atomic replacement and backup guarantees. Ensure every error before replacement leaves the original unchanged, and clean temporary files on all failure paths.
- Define in-place, output-file, and sidecar destinations explicitly. Preserve filesystem metadata when requested and document platform limitations.
- Preserve unknown metadata blocks byte-for-byte whenever possible. Never silently discard a block because its parser or serializer does not understand it.

**Exit gate:** API contract tests cover success, partial support, backup, overwrite, preservation, and failure-with-original-unchanged behavior.

### 2. Complete Core Metadata Serializers

Implement reusable serializers independently of container mutation:

- **EXIF/TIFF:** IFD0, ExifIFD, GPS, interoperability IFD, SubIFDs, IFD1/thumbnail, data types, offsets, byte order, maker-note preservation, and tag deletion.
- **IPTC-IIM:** datasets, character sets, repeatable values, record/version handling, and embedded-resource serialization.
- **XMP:** schema/namespace registration, scalar and structured properties, arrays and language alternatives, existing-packet merge, deletion, unknown-property preservation, and sidecar output.
- **Photoshop IRB/IPTC resources:** resource parsing, replacement, deletion, padding, and preservation of unrelated resources.
- **ICC and other writable metadata blocks:** only the families marked writable/createable by the pinned upstream matrix; preserve opaque payloads and validate lengths/checksums where required.
- **MakerNotes:** begin with preservation and safe pass-through. Add vendor-specific value writing only where reference behavior and fixtures prove it safe. Never regenerate encrypted, offset-sensitive, or signature-bound data without a vendor-specific implementation.

Serializer tests should assert both semantic round trips and byte preservation of unrelated blocks. EXIF/TIFF serializers should be deterministic for newly created data; merge operations should avoid reformatting untouched packets.

**Exit gate:** each serializer passes unit tests and ExifTool read-after-write comparisons for supported tags, groups, arrays, and deletes.

### 3. Expand Container Writers

Extend the existing plugin boundary with focused container adapters. Each adapter owns locating, replacing, inserting, deleting, and preserving metadata blocks; serializers remain shared.

1. Finish JPEG, PNG, WebP, AVIF/HEIF, and plain TIFF behavior, including all supported groups and removal operations.
2. Add TIFF-family camera RAW writing only where upstream supports it and the mutation preserves proprietary image data. Treat CR2/NEF/ARW/DNG and other variants individually; do not equate TIFF-based with safe-to-write.
3. Add writable ISO-BMFF families such as QuickTime/MOV/MP4 and supported audio/video variants using box-level preservation and size/offset repair.
4. Add other upstream-writable containers in prioritized groups: JP2/JXL, PDF, PSD/PSB, GIF, and additional formats according to the pinned matrix.
5. Add create-from-scratch support only for upstream `c` formats, with distinct creation tests and API semantics.

For each adapter, validate truncation, extended sizes, unknown boxes/chunks, duplicate metadata blocks, padding, checksums, large-file offsets, and malformed inputs. A failed parse or write must not corrupt the source.

**Exit gate:** the supported-write matrix is updated only after each adapter passes format-specific structural tests and reference ExifTool validation.

### 4. Implement ExifTool-Compatible Write Workflows

- Support tag assignment and deletion, group-qualified tag names, wildcard/group operations where applicable, and write-mode behavior (`-wm`).
- Implement `-tagsFromFile` with source selection, tag/group selection, ordering, and copy semantics. Test copying between different containers and metadata families.
- Add file-level behavior for output paths, backups, overwrite controls, modification-time preservation, conditional writes, recursion, and batch failures.
- Make binary writes tag-selective; do not concatenate all discovered binary values without framing or selection.
- Complete argument normalization and CLI option handling for the upstream write options included in the compatibility contract. Do not advertise help entries that are not implemented.
- Keep the library API and CLI behavior aligned; the CLI should be a thin adapter over the same write request model.

**Exit gate:** command-level tests compare exit status, resulting metadata, backup/output files, and diagnostics with ExifTool for each implemented workflow.

### 5. Differential, Preservation, and Safety Verification

- Add reference tests against the pinned ExifTool 13.55 for every supported format/metadata/operation matrix cell.
- Verify both directions: exiftool-ts writes and ExifTool reads; ExifTool writes and exiftool-ts reads.
- Compare values, groups, duplicate handling, deletion, binary payloads, and format structure. Use exact byte comparisons for payloads that should be preserved and semantic comparisons for regenerated metadata.
- Maintain minimal synthetic fixtures for boundaries and malformed inputs, plus a small redistributable real-world fixture set for vendor-specific behavior.
- Run a library sweep for broad regression detection, but do not treat shared-tag parity alone as proof of correct writing or preservation.
- Track every intentional difference with format, metadata family, tag/operation, reason, fixture, and a removal condition. Keep active write divergences separate from read-value divergences.
- Include mutation/failure tests proving invalid requests, unsupported formats, and serializer errors cannot partially replace source files.

**Release gate:** all advertised write capabilities pass focused tests; no unexplained write divergence remains for the claimed support matrix; the docs and generated capability list match runtime behavior.

### 6. Documentation and Capability Reporting

- Publish separate read, write, and create support tables; do not use one generic “supported formats” list for all three.
- Document tag groups writable per format, delete/copy behavior, MakerNote safety, backups, timestamp handling, and known lossy cases.
- Generate CLI help and API capability reporting from the same writer registry where practical.
- Update `parity.md`, API docs, and examples as each phase ships. Keep partial support explicit and avoid claiming full format support from successful parsing alone.

## Suggested Delivery Order

1. Baseline matrix and correct current capability claims.
2. Complete EXIF/TIFF writing and preservation semantics across supported IFDs.
3. Complete XMP merge/delete/sidecar behavior; then IPTC-IIM and Photoshop IRB.
4. Close the existing JPEG/PNG/WebP/AVIF/TIFF gaps before adding containers.
5. Add safe, individually validated RAW and ISO-BMFF writers.
6. Add remaining upstream-writable formats in batches selected by user value and fixture availability.
7. Complete CLI copy/delete/batch workflows and release-level parity reporting.

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
