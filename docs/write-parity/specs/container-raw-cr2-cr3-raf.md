# Canon + Fujifilm RAW: CR2, CR3, RAF spec (§J)

Upstream marks `CR2`, `CR3`, `RAF` `r/w` (none creatable) — full parity is the
target; first fixture-backed RAW batch, motivated by body-serial coverage
(`SerialNumber` 0xa431, `LensSerialNumber` 0xa435, Canon/Fuji
`InternalSerialNumber`). Depends on complete writable tables (§A/§B) and
MakerNotes gates (§E). **No type is advertised writable until its own cells
pass**; per-cell `read-only`/`unsafe` with a reason is an acceptable outcome.

## Prerequisites (all three)

- Read-side container parser where absent — CR3 ISOBMFF boxes and the RAF
  wrapper have no parser today; writing cannot built without the read path.
- MakerNotes adapters: Canon (CR2/CR3), FujiFilm (RAF), under §E
  preserve-by-default rules.

## Per-type

- **CR2** (Canon TIFF-based): header dialect (LE, IFD0 at 0x10, `CR` marker,
  trailing trailer relocation); full IFD graph through §B serializer;
  Canon MakerNotes incl. serial tags with base-offset handling; preview
  preservation or refusal.
- **CR3** (Canon ISOBMFF): `ftyp crx` validation; `moov` + `CMT1..4` boxes
  (IFD0/ExifIFD/MakerNotes/GPS); `iloc`/offset + 32/64-bit sizes; XMP/ICC
  item-box writes; `mdat` never touched.
- **RAF** (FujiFilm wrapper): `FUJIFILMCCD-RAW ` header, section table,
  embedded JPEG preview, trailing metadata table with offsets/sizes; section
  offset/size updates preserving preview + raw blocks byte-for-byte; refuse
  unsupported RAF versions/layouts loud.

## Test vectors (per type)

set/add/replace/delete/no-op, malformed, unsupported, backup/atomicity;
redistributable fixtures per vendor/model; differential vs ExifTool 13.64
both directions + unchanged-block byte comparison. Matrix cells promote only
on passing focused tests — including read-side body-serial coverage before
write advertising.
