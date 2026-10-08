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
