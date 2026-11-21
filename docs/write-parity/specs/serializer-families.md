# Other writable families spec (§F)

Families with upstream `r/w` or `r/w/c` beyond EXIF/GPS/IPTC/XMP/MakerNotes:
ICC Profile, Photoshop IRB (→ IPTC spec), JFIF, Ducky APP12, MIE, PDF,
PNG metadata, Canon VRD, GeoTIFF, CIFF, AFCP, Kodak Meta, FotoStation,
PhotoMechanic.

## Per-family invariants

| Family | Rule |
|---|---|
| ICC Profile | Create/edit/delete profiles **and** tags; preserve unknown elements, declared size, valid structure. Standalone `.icc` is `r/w/c` — create tests required. `PNG:ProfileName` is written only with `ICC_Profile`. |
| JFIF | Density/unit/comment; exact APP0 preservation/update. |
| Ducky APP12 | Quality/Comment/Copyright writable; unknown blocks byte-preserved; duplicate-block ordering + size limit parity. |
| MIE | Create/read-modify-write/delete, nested sections, large files, binary blocks. |
| PDF | XMP + Info dict; safe incremental vs full rewrite; encryption/signatures/linearization accounted. |
| Canon VRD | Create/edit/delete VRD blocks; preserve proprietary preview data. |
| GeoTIFF | GeoKey dir + doubles/ascii params; dependent-tag consistency. |
| CIFF/AFCP/Kodak Meta/FotoStation/PhotoMechanic | Upstream `r/w` (not `r/w/c`); port writable blocks + values. |

- All other upstream families are **read-only** for 13.64. Generic container
  rewrites must never mutate them accidentally — binary-block preservation
  tests are mandatory per family × container cell.

## Test vectors

per family × container matrix cell: set/delete, binary-payload preservation,
unrelated-family preservation, ExifTool 13.64 readback. Current partials:
JPEG ICC/JFIF/Ducky, PNG ICC, WEBP ICC, TIFF GeoTIFF — see `matrix.json` `cells`.
