# Container adapters spec (§G)

One adapter per upstream file type (78 writable types at 13.64: 71 `r/w` +
7 `r/w/c`). Serializers (§B–§F) are reused only where the underlying
structure is genuinely shared. **A grouped row is a work queue, never
permission to mark a whole group supported.** Every file type passes its own
matrix cells and release gate.

## Batches

1. **Close out existing adapters** (`src/format/*` + `src/write/*`):
   JPEG/MPO, PNG, WEBP, AVIF/HEIC/HEIF, GIF, PBM/PGM/PPM, TIFF.
   Current partials are enumerated as cells in `matrix.json`.
2. **Standalone `r/w/c` types** (create ≠ write): `DR4`, `EXIF`, `EXV`,
   `ICC`, `MIE`, `VRD`, `XMP`. `create` matrix cells only for these 7.
3. **ISO-BMFF video/audio**: `3G2/3GP`, `AAX`, `DVB`, `F4A/V`, `GLV`, `LRV`,
   `M4A/V`, `MOV`, `MP4`, `MQV`, `QTIF` + `MIF3 r/w` (13.62 #503, compressed
   EXIF/XMP, distinct from AVIF/HEIF `meta`). No adapter today.
4. **Camera RAW**: §J batch (CR2/CR3/RAF) first; every other RAW type is
   probed individually — no assumption that one TIFF writer covers all.
5. **Other images**: `360, AI, DCP, EPS, FLIF, GPR, HDP, JNG, JP2, JXL, MNG,
   PS, PSB, PSD, THM, WDP`.
6. **Docs**: `IND, PDF` (PDF family detail in §F spec).

## Per-row contract (every adapter, every family cell)

write-existing, add-new, replace, delete, no-op, malformed input, unsupported
operation, preservation, backup, ExifTool round-trip. Fixtures + differential
tests required (see `fixtures/README.md`). File-type identity follows
ExifTool's detected `FileType`, not filename suffixes.

## Invariants

- Unknown boxes/chunks/blocks preserved byte-for-byte; CRC/length/padding
  updated; media payloads and preview offsets never silently shifted — refuse
  or repair + verify.
- Bakups/atomicity: same-directory temp + rename, `_original` backup by
  default (existing pipeline in `src/write/pipeline.ts`).
- Stale `13.55` behaviour notes (GIF C2PA delete #515,
  extension fix #516, PNG pointer guard #453, Insta360 X6 atom robustness)
  must be verified against 13.64 before any cell is promoted.

## Upstream fix watchlist (13.56–13.64, tracked not ported)

- `MIF3` r/w adapter (13.62 #503): `mif3` detection, mini metadata
  read/write incl. compressed EXIF/XMP; distinct from AVIF/HEIF `meta`
  handling; preserve image payload, handle brands/item table.
- GIF: C2PA application-extension delete only (13.62 #515) + 13.63
  extension regression fix — animation/text blocks preserved.
- ISO-BMFF video: Insta360 X6 `Meta`/empty `ItemList` patch + trailer write
  error (13.64) — track until the MP4/MOV adapter exists; don't half-implement.
- Sony ARW write compat (13.61 #465): verify against our TIFF/RAW path when
  ARW cells are probed.
- Xiaomi HEIC EXIF delete/recreate crash fix (13.62 #485) and Samsung HEIC
  `sefd` motion-photo repair (13.60): upstream-side fixes, no code action
  until a HEIC writer adapter exists.
