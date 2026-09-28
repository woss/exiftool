# Write tags & features needed to retire the Perl ExifTool (Kelp requirements)

> Requested by @woss, 2026-09-26. Source of truth for the write surface Kelp needs
> from exiftool-ts so `exiftool-vendored` (Perl binary) and `exiftoolFast` (CLI
> spawn) can be removed from kelp-oss entirely.
>
> Baseline: **v0.3.1 / `f920046`**. Today exiftool-ts writes **EXIF tags into
> JPEG/PNG/WebP/AVIF** (IFD0/ExifIFD/GPS via `writers.ts`) plus a **JPEG-only
> 4-key merge** (`jpeg-merge.ts`: `EXIF:Copyright`, `EXIF:Orientation`,
> `XMP-dc:Rights`, `XMP-xmprights:WebStatement`). Everything below is the delta.

## Consumers in kelp-oss

| Call site | Uses today | Needs from exiftool-ts |
|---|---|---|
| `market/apps/desktop/src/lib/server/desktop/metadata-write.ts` — "Write metadata to files" (Lightroom pickup) | `exiftool-vendored` Perl `write()` + hand-rolled `.xmp` sidecar writer for RAW | P0 tags below, on all four raster containers + sidecar mode |
| `market/packages/db/src/pipeline.ts` — `stampLicenseMetadata` + `embedXmpMetadata` | `@woss/exiftool` merge writer (4 keys) + hand-rolled JPEG XMP packet rewriter | P0 tags make `embedXmpMetadata` deletable; publish stamping collapses to one `writeBytes` call |
| `services/worker/src/tasks/*`, `services/main`, `services/unified-link` — `exiftoolFast` reads | Perl CLI spawn | Read parity only (no new writes) — see "Read parity" at the end |

## P0 — descriptive metadata writes (Lightroom-visible)

Lightroom Classic is the acceptance oracle: embedded XMP on import for
JPEG/TIFF/PNG/WebP, `.xmp` sidecars auto-read for RAW/DNG, "Read Metadata from
Files" refresh for cataloged files. Keywords must land in BOTH homes.

| Tag | Group | Value shape | Containers | Consumer |
|---|---|---|---|---|
| `XMP-dc:subject` | XMP-dc | `rdf:Bag` of `rdf:li`, one per keyword; replace-not-append on write; write order = array order | JPEG, PNG, TIFF, WebP, `.xmp` sidecar | desktop metadata-write, publish embed |
| `XMP-dc:title` | XMP-dc | `rdf:Alt` / `rdf:li xml:lang="x-default"` | same | desktop, publish embed |
| `XMP-dc:description` | XMP-dc | `rdf:Alt` / `rdf:li xml:lang="x-default"` | same | desktop, publish embed |
| `IPTC:Keywords` | IPTC IIM (APP13, record 2, dataset 25) | repeatable; write alongside `dc:subject` so legacy consumers see the same list | JPEG (+ TIFF via IFD0 IPTC tag, P2) | desktop metadata-write |
| `XMP-xmp:MetadataDate` | XMP-xmp | ISO 8601, no timezone folding | same | freshness marker (sidecar idempotence in desktop depends on caller-controllable date) |

Already shipped (no work needed): `EXIF:Copyright`, `EXIF:Orientation` (+`#`
numeric convention), `XMP-dc:Rights`, `XMP-xmprights:WebStatement`,
`EXIF:ImageDescription`.

## P1 — same tags, missing containers

| Gap | Detail |
|---|---|
| **XMP into PNG** | `iTXt` chunk, keyword `XML:com.adobe.xmp`, compression flag 0 (XMP spec: uncompressed), null separator bytes. Today `pngWriter` writes eXIf only. |
| **XMP into WebP** | `XMP ` RIFF chunk after image data, size even-padded. Today `webpWriter` writes EXIF chunk only. |
| **XMP into TIFF** | `tiffWriter` does not exist — TIFF-family is read-only. Desktop ingests `.tiff` and currently shells out to Perl for it. Needs: IFD0 `XMP` tag (0xBC01, type BYTE) + same EXIF tag support writers.ts already has for JPEG. |
| **IPTC into TIFF** | IFD0 `IPTC-NAA` tag (0x83BB) — needed only if TIFF IPTC lands in scope; XMP-dc:subject alone satisfies Lightroom. |

## P2 — opportunistic (nice, not required)

| Tag / feature | Detail |
|---|---|
| `XMP-photoshop:Credit`, `XMP-photoshop:Headline` | desktop may surface credit lines later |
| `XMP-dc:creator` | `rdf:Seq` of `rdf:li` — author byline |
| `EXIF:DateTimeOriginal`, `EXIF:CreateDate`, `EXIF:ModifyDate` | capture-time correction writes |
| `EXIF:GPS*` + `XMP-exif:GPSLatitude/Longitude` | worker `extractGps` currently read-only; would enable desktop geotag fix-up |
| DNG in-file XMP | DNG carries XMP in-file; would remove the sidecar for DNG specifically (ARW/CR2/CR3/NEF/ORF/RAF/RW2 must stay sidecar-only — those bytes are provenance material and must never be rewritten) |

## Features (the real work — tags are the easy part)

1. **Generalized XMP property writer.** `jpeg-merge.ts` currently hard-codes
   four keys and only knows `dc:rights` (Alt). Generalize: arbitrary
   `group:property` keys, value-shape map (`Alt` w/ `x-default`, `Bag`, `Seq`,
   scalar), xmlns declaration for every written namespace, and
   upsert-or-replace of existing properties (strip old value of the same
   property first — the desktop's sidecar writer and kelp's
   `mergeXmpPacket` both need replace semantics for idempotence).
2. **Fresh-packet fallback.** When a container has no XMP packet, build a
   minimal valid one (`xpacket` prolog/eplog + padding, `x:xmpmeta`,
   `rdf:RDF`, one `rdf:Description` carrying all written namespaces).
   kelp-oss's `freshXmpPacket` is the reference shape.
3. **IPTC IIM writer (JPEG APP13).** Photoshop IRB + IIM records:
   record 2 dataset 25 repeatable Keywords, plus `CodedCharacterSet`
   (record 1, dataset 90) = UTF-8 so non-ASCII keywords survive. Must
   coexist with an existing APP13/Photoshop segment (merge, not replace) —
   Lightroom writes both IPTC and XMP and expects both to agree.
4. **Merge-write preservation.** Writing N tags must not touch any other
   byte: MakerNotes, IFD1 thumbnail, ICC, Photoshop resources, unknown
   segments/chunks stay bit-identical. This is already true for the 4-key
   JPEG merge — keep it true for the generalized writer, on every container.
   PRNU sensor fingerprints are computed from pixels, but provenance claims
   in Kelp assume "only the requested tags changed" — enforce with a
   before/after structural diff in tests, not just "image still opens".
5. **Sidecar `.xmp` write mode.** `write(file, tags, { sidecar: true })` (or a
   `writeSidecar`) producing a packet LR reads for RAW/DNG: same P0 tags,
   `rdf:about=""`, `xmlns:dc` + `xmlns:xmp` on the `rdf:Description`,
   `MetadataDate` overridable (desktop derives it from the file's indexed
   mtime so repeat runs are byte-identical). Must also READ an existing
   sidecar and merge into it rather than clobber unknown properties.
6. **Idempotence.** Writing the same values twice → byte-identical output
   (or zero-op). Desktop's "second run → unchanged" contract and scan-dedupe
   logic rely on no mtime churn.
7. **In-memory path everywhere.** `writeBytes` must support every new
   capability `write` does — kelp's publish pipeline stamps buffers, not
   paths.

## Read parity (removes `exiftoolFast`, the last Perl spawn)

Reads already land for the EXIF surface kelp needs (Make/Model/serials,
DateTimeOriginal, dimensions). Remaining read consumers and the tags they
extract:

| Consumer | Tags |
|---|---|
| `worker/tasks/extractGps.ts` | `GPSPosition` (+ components) |
| `worker/tasks/extractImportantMetadata.ts` | `Keywords`, `XPKeywords`, IGPano (`CroppedArea*`, `FullPano*`, `UsePanoramaViewer`…) |
| `worker/tasks/ai/detectAiImage.ts` | AI forensics: `xmp:CreatorTool`, `History/ActionsSoftwareAgent`, `Software`, InvokeAI (`Invokeai_metadata`, `Invokeai_graph`), SD (`Parameters`, `seed`, `steps`, prompts), `DMI-*` / `DigitalSourceType` |
| `services/main` v1/files, `unified-link` | full `-j -n -a -u -g1 --struct -b` dump |

Gaps: C2PA/JUMBF box parsing, PNG tEXt arbitrary chunks (InvokeAI/A1111
prompts live there, not in EXIF), `-struct` JSON shape parity, GPS
composite derivation. Note: `exiftoolFast` also accepts URLs — TS callers
can fetch bytes themselves; the library API stays bytes/paths only.

## Acceptance

- Kelp's own gate: `exiftool -j -G1 -a` before/after a write shows ONLY the
  requested tags changed; camera EXIF (Make/Model/Serial) bit-identical.
- Lightroom: fresh import shows keywords/title/description on JPEG/PNG/TIFF/
  WebP; RAW pickup via sidecar; "Read Metadata from Files" refreshes a live
  catalog.
- Re-run with unchanged values → `unchanged`, no byte delta.
- The existing parity suite (`exiftool-parity.test.ts`) extended to the new
  write tags — diff TS output vs Perl exiftool output on shared fixtures.
