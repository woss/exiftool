# exiftool-ts — Parity Divergence Register

**Last updated:** 2026-08-31 · HEAD `21a71b5` · Library: 218 files, 66,003 comparisons · Asset parity: 0 NEW (allowlist 3)

## Summary

| Metric | Count |
|---|---|
| **NEW divergences** | **62** |
| **Allowlisted** | 240 |
| **Shared tag comparisons** | 66,003 |

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

## 4. MaskGroup Structs — top level FIXED (`6b45741`), deep AI-mask level remains (~60 pairs)

Fixed in `6b45741` (verified against exiftool on multi-mask edits):
- `CorrectionName`/`CorrectionSyncID` + `RangeMask*` → arrays, one value per correction
- per-mask fields (`MaskGroupBasedCorrMask*`) → **last mask wins** (sequential assignment, not comma-joined arrays)
- `CorrectionRangeMask` scoped renames + TAG_REMAP entries

**Remaining deep level (~9 files × ~10 tags):** AI-subject masks nest a THIRD level — the mask `rdf:li` is element-form (no attrs) containing a nested Description plus an inner `crs:Masks` Seq. Tags: `Mask*InputDigest(Version)`, `Mask*ModelVersion`, `Mask*MaskVersion/SubType/Digest`, `Mask*ReferencePoint`, `Mask*WholeImageArea`, `Mask*Origin`, inner `Masks*` (Dabs, What, Value, Radius, Flow, CenterWeight...). Also element-form masks leave `Mask*ZeroX/ZeroY` missing (5 files) and MaskWhat/MaskSyncID diverging (8).

---

## 5. Minor / Remaining (~35 file-tag pairs)

| Tag | Files | Issue |
|---|---|---|
| CodedCharacterSet | 7 | IPTC `UTF8` rendering |
| ExposureCompensation / FileSize / misc | 1-7 each | formatting edge cases |

Fixed in `199ccef`: DateTimeCreated subsec (18), SubjectDistance/GPSAltitude ` m` units (21), Province-State / Country-\* IPTC datasets 95/100/101 (21).

---

## Fixed This Session

- ✅ **Optical composites (191 files → 0)** — ported from Exif.pm/Canon.pm source: crop-factor pipeline, CoC, FOV, DOF, HyperfocalDistance
- ✅ **DerivedFrom\* (146 files → 0)** — struct-attribute parsing + group priority
- ✅ **Creator\* ContactInfo flatten + LookCopyright (52 files → 0)** — Ci\* remap + scoped rename
- ✅ `DateCreated` truncation, `DateTimeCreated` duplication, SubSec composites
- ✅ `HierarchicalSubject` composite, XMP hyphenated prefixes, simple XMP elements
- ✅ XMP rationals (`39/100` → `0.39`) — fixes FlashCompensation/ApproximateFocusDistance rendering
- ✅ **PrintConv precision ports (37 pairs → 0)** — `21a71b5`: IPTC 1:90/2:90 record-collision (City no longer overwrites CodedCharacterSet), ExposureCompensation PrintFraction port, GPS ToDMS decimal-degrees round-trip, GPSAltitudeRef sea-level PrintConv, Look-struct Clarity2012 rename

---

## Priority for Next Work

1. **MaskGroup deep AI-mask level** — ~60 pairs, element-form third-nesting (see section 4)
2. **Misc formatting** — FileSize/CodedCharacterSet edge cases (1-7 each)