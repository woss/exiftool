# exiftool-ts — Parity Divergence Register

**Last updated:** 2026-08-31 · HEAD `92fa63e` · Library: 218 files, 65,956 comparisons · Asset parity: 0 NEW (allowlist 3)

## Summary

| Metric | Count |
|---|---|
| **NEW divergences** | **201** |
| **Allowlisted** | 240 |
| **Shared tag comparisons** | 65,956 |

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

## 4. MaskGroup Deep Structs (~110 file-tag pairs) — largest remaining

Lightroom masking metadata nests several levels deep (`crs:CorrectionMasks` → per-mask structs → inner `Masks` arrays). ExifTool emits the flattened names per struct level; we comma-join arrays or miss the deepest levels.

| Shape | Example tags | Files |
|---|---|---|
| Array joined vs per-struct | MaskSyncID, MaskWhat, MaskVersion, MaskActive, MaskValue, MaskBlendMode | 12-14 each |
| Deep levels missing entirely | `Mask*InputDigest`, `Mask*ModelVersion`, `Mask*ReferencePoint`, `Mask*WholeImageArea`, `Mask*Origin`, inner `Masks*` | 8-9 each |

**Fix:** extend the struct-attribute machinery to recurse into nested struct arrays — same pattern as DerivedFrom/CreatorContactInfo, but with arrays.

---

## 5. Minor / Remaining (~60 file-tag pairs)

| Tag | Files | Issue |
|---|---|---|
| DateTimeCreated | 18 | ours keeps `.00` subsec from XMP DateCreated; exiftool's composite drops it |
| SubjectDistance | 11 | PrintConv: exiftool renders `0 m` (units appended) |
| GPSAltitude | 10 | PrintConv: exiftool renders `48.9 m` |
| CodedCharacterSet | 7 | IPTC `UTF8` rendering |
| Province-State / Country-\* | 7+7+7 | Iptc4xmpCore location attrs on 7 files (likely element-form or second struct) |
| ExposureCompensation / Clarity2012 / FileSize / misc | 1-7 each | formatting edge cases |

---

## Fixed This Session

- ✅ **Optical composites (191 files → 0)** — ported from Exif.pm/Canon.pm source: crop-factor pipeline, CoC, FOV, DOF, HyperfocalDistance
- ✅ **DerivedFrom\* (146 files → 0)** — struct-attribute parsing + group priority
- ✅ **Creator\* ContactInfo flatten + LookCopyright (52 files → 0)** — Ci\* remap + scoped rename
- ✅ `DateCreated` truncation, `DateTimeCreated` duplication, SubSec composites
- ✅ `HierarchicalSubject` composite, XMP hyphenated prefixes, simple XMP elements
- ✅ XMP rationals (`39/100` → `0.39`) — fixes FlashCompensation/ApproximateFocusDistance rendering
- ✅ IPTC_LOOKUP restored (ObjectName, Keywords, By-line were accidentally dropped)

---

## Priority for Next Work

1. **MaskGroup deep recursion** — ~110 file-tag pairs, same struct pattern now proven three times
2. **Quick PrintConv wins** — SubjectDistance/GPSAltitude ` m` suffix, DateTimeCreated subsec drop (~39 pairs)
3. **Province-State/Country-\* element form** — 21 pairs on 7 files
4. **LookParametersClarity2012** — deeper Parameters struct recursion (6)