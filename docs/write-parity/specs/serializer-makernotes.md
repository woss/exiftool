# MakerNotes spec (§E)

Upstream source: 13.64 vendor modules (Canon, FujiFilm, Nikon, Olympus/Epson,
Sony, Panasonic/Leica, Pentax, Phase One, Sigma/Foveon, etc.). Code today:
`src/exif/makernotes.ts` (preserved, not edited). Catalog data:
`src/tags/generated/maker-printconv.json`.

## Scope (per vendor, never blanket)

For each vendor/model family: tag ID, type, byte order, base-offset rule,
encryption/checksum, version/model condition, PrintConv/ValueConv, write
priority, conditionally-writable + protected tags.

## Invariants (the whole spec)

- **Preserve by default.** Opaque/unknown tags and encrypted sections are
  copied byte-for-byte. **Never rewrite a vendor block** whose offset,
  checksum, encryption key, or proprietary structure can't be preserved.
- Absolute TIFF offsets (Olympus) and non-maker-relative offsets: TIFF
  rewrites that would move directory values under them are **refused** unless
  the offset is repaired and verified.
- Standalone Nikon Capture `r/w/c` family and DNG/CR3 embedded MakerNotes are
  handled per-container (§J), not by a generic TIFF pass.

## Operations

read-modify-write of writable tags only, with vendor + model gating;
vendor support is reported **individually** in the matrix.

## Test vectors

Redistributable fixtures per vendor/model (`fixtures/`): our write read by
upstream, upstream write read by us, unchanged-block byte comparison.
A family is `implemented` only when value, offset, preservation, corruption,
and upstream read-after-write tests all pass.
