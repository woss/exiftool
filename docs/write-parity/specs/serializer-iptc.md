# IPTC-IIM + Photoshop IRB spec (§C)

Upstream source: 13.64 `IPTC.pm`/`Photoshop.pm` tables. Code:
`src/write/iptc.ts`, `src/exif/app13.ts`, `src/write/jpeg-merge.ts`.

## Scope

- Complete writable ApplicationRecord + EnvelopeRecord + NewsPhoto datasets:
  repeated fields, fixed/digit widths, coded character sets, extended
  dataset lengths, enum/label→code tables (`values`), date formats.
- Photoshop IRB: all writable 8BIM/8B64 resources — Pascal names, padding,
  ordering, unknown-resource preservation, scalar resources
  (CopyrightFlag, URL, GlobalAngle/Altitude, ResolutionInfo, thumbnails).

## Invariants

- `IPTCDigest`: recalculate only when the stored digest matches the pre-edit
  block; a stale digest is preserved as an out-of-sync marker.
- Character sets: explicit `CodedCharacterSet` (`UTF8`/`UTF-8`/`ESC % G`) stored
  as `ESC%G`; new text gets a UTF-8 declaration when the same update deletes
  the old one.
- Photoshop APP13: repeated-header split + reassembly for oversized payloads
  (120 KB preview round-trips); extended-length IIM datasets decoded across
  segments. Preserve ordinary 8BIM/8B64 blocks byte-for-byte on IPTC updates.
- 13.64 delta: IPTCDigest TIFF padding + `PhotoshopSettings` TIFF code before
  IPTC-in-TIFF beyond JPEG APP13.
- Empty `IPTC:Keywords` deletes IPTC datasets only, preserving XMP Subject.

## Operations

set / replace / add / delete; repeatable values; empty-record removal.
Integration beyond JPEG APP13 only as §F/§G lanes land per container.

## Test vectors

`src/write/iptc.test.ts`: all 105 writable datasets swept through the IIM
encoder, `digits[N]` widths, By-line multi-value replace/delete, digest
recalc/stale-preserve, 120 KB split/reassemble. ExifTool 13.64 readback gates
promotion of `*/IPTC|set|delete` and `*/Photoshop IRB|set|delete`.
