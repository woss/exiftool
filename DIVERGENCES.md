# exiftool-ts — Parity Divergence Register

**Last updated:** 2026-08-31 · HEAD `8c68358` · Library: 218 files, 66,156 comparisons · Asset parity: 0 NEW (allowlist 3)

## Summary

| Metric | Count |
|---|---|
| **NEW divergences** | **47** |
| **Allowlisted** | 240 |
| **Shared tag comparisons** | 66,156 |

---

## 1. ~~DerivedFrom Group Priority~~ FIXED (was 146 files → 0)

Fixed in `d321888`. Root cause was structural, not priority:
- exiftool reads `<xmpMM:DerivedFrom stRef:documentID="hex" stRef:originalDocumentID="hex"/>` — attributes on a child struct element (often self-closing)
- Our XMP parser only read attributes on `rdf:Description` elements
- Fix: listPattern loop now maps attributes on child struct elements, plus a new self-closing child element pass (`src/exif/xmp.ts`)

---

## 2. ~~Optical Composites~~ FIXED (was 191 files → 0)

Fixed in `92fa63e` — ported from the exiftool Perl source (`exiftool-repo/lib/Image/ExifTool/{Exif,Canon}.pm`), NOT from output diffing:
- `calcScaleFactor35efl`: ① `FocalLengthIn35mmFormat/FocalLength` → ② **Canon raw-rational sensor diagonal** (FocalPlaneX/YResolution rationals encode sensor size in the denominators; e.g. `5184000/894` px/in → 27.30 mm diag → scale 1.585) → ③ focal-plane size from image dims ÷ resolution with aspect + 1–100 mm sanity windows
- `CircleOfConfusion = D/(scale×1440)`, `FOV` uses exiftool's **literal 3.14159** divisor, DOF renders `inf` and 3-decimal macro depths exactly like exiftool's PrintConv
- `ScaleFactor35efl` emitted as a JSON number; the whole optical chain is omitted when no scale source exists (exiftool never fakes 1.0)
- All formulas documented in `src/exif/composite.ts` with Exif.pm references and quirk notes

---

## 3. ~~Missing XMP Tag Mappings~~ FIXED (was 52 files)

Fixed in `e2f6222` — root cause was NOT multi-block XMP (investigation showed only one XMP block):
- `CreatorWorkURL` etc. live in `<Iptc4xmpCore:CreatorContactInfo Iptc4xmpCore:CiUrlWork="..."/>` — a self-closing struct whose fields exiftool **flattens** into standalone `Creator*` tags. Same structural gap as DerivedFrom; fixed by adding `Ci*` → `Creator*` TAG_REMAP entries (the self-closing struct-attribute parser from the DerivedFrom fix picks them up).
- `LookCopyright` lives in `crs:Copyright` attribute inside the `crs:Look` struct; fixed with a scoped rename to `crs:LookCopyright` in `renameContextProperties` (which TAG_REMAP already mapped).
- Remaining: `LookParametersClarity2012` (6 files, deeper Parameters struct recursion).

---

## 4. MaskGroup Structs — top level + inner sub-masks FIXED (`6b45741`, `8c68358`)

- Correction arrays, per-mask last-wins, RangeMask renames, inner `crs:Masks` sub-mask fields (`MaskMasks*` incl. comma-joined Dabs), document-order resolution across both mask forms (`8c68358`)
- **Remaining (~23 pairs):** `MasksValue` (8) — sub-mask value attr not reached in some element-form li's; `ZeroX/ZeroY` (5+5) — gradient attrs on element-form li's; to be finished with the same machinery

## 5. New families surfaced (5 files each — Lightroom heal/retouch edits)

- `RetouchArea*` (~13 tags × 5 files): `photoshop:RetouchArea` structs — same struct-attribute pattern, unfetched
- `GPSAltitude` (5): exiftool's composite appends the ref — `26.9 m Below Sea Level`
- ExposureTime/ShutterSpeed(Value)/Title/FileSize singles (1-4 each): formatting edges

---

## Fixed This Session

- ✅ **Optical composites (191 files → 0)** — ported from Exif.pm/Canon.pm source
- ✅ **DerivedFrom\* (146 files → 0)** — struct-attribute parsing + group priority
- ✅ **Creator\* ContactInfo flatten + LookCopyright (52 files → 0)**
- ✅ **PrintConv precision ports (37 pairs → 0)** — IPTC record-collision, PrintFraction, GPS ToDMS, GPSAltitudeRef, Look Clarity2012 (`21a71b5`)
- ✅ **MaskGroup flattening (top level + inner sub-masks)** — correction arrays, per-mask last-wins, inner `Masks*`, document-order resolution (`6b45741`, `8c68358`)
- ✅ IPTC location datasets, distance units, DateTimeCreated subsec, XMP rationals, HierarchicalSubject composite

---

## Priority for Next Work

1. **RetouchArea\* family** — ~65 pairs (5 files × 13 tags), same struct-attribute pattern
2. **GPSAltitude composite ref suffix** — 5 pairs
3. **Remaining mask attr reach** — MasksValue/ZeroX/ZeroY (~18 pairs)
4. **Misc formatting** — ExposureTime/ShutterSpeed/Title/FileSize singles