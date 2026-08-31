# exiftool-ts — Parity Divergence Register

**Last updated:** 2026-08-31 · HEAD `d321888` · Library: 218 files, 65,852 comparisons · Asset parity: 0 NEW

## Summary

| Metric | Count |
|---|---|
| **NEW divergences** | **342** (was 488 before DerivedFrom fix) |
| **Allowlisted** | 546 |
| **Shared tag comparisons** | 65,852 |

---

## 1. ~~DerivedFrom Group Priority~~ FIXED (was 146 files → 0)

Fixed in `d321888`. Root cause was structural, not priority:
- exiftool reads `<xmpMM:DerivedFrom stRef:documentID="hex" stRef:originalDocumentID="hex"/>` — attributes on a child struct element (often self-closing)
- Our XMP parser only read attributes on `rdf:Description` elements
- Fix: listPattern loop now maps attributes on child struct elements, plus a new self-closing child element pass (`src/exif/xmp.ts`)

---

## 2. Optical Composites — Per-Model Tables Missing (191 files) — TOP PRIORITY

| Tag | Files | Ref example | Ours example |
|---|---|---|---|
| DOF | 53 | `0.001 m (0.300 - 0.300 m)` | MISSING |
| CircleOfConfusion | 52 | `0.019 mm` | `0.030 mm` (default) |
| FocalLength35efl | 44 | `100.0 mm (35 mm equivalent: 158.5 mm)` | `100.0 mm (35 mm equivalent: 100.0 mm)` |
| FOV | 42 | `13.0 deg` | `20.4 deg` |

**Cause:** Composites exist but use defaults: crop factor 1.0, CoC 0.030 mm. exiftool has per-model tables (Canon APS-C = 1.6, Nikon APS-C = 1.5, full-frame = 1.0) and per-model CoC values. Also ~53 files missing DOF need SubjectDistance from makernotes.

**Fix:** Per-model crop-factor + CoC tables keyed on Make/Model. Canon/Nikon/Sony cover most of the 218-file library.

---

## 3. Missing XMP Tag Mappings (52 files)

| Tag | Files | Cause |
|---|---|---|
| CreatorWorkURL | 33 | `XMP-iptcCore:` namespace — our extraction reads only the first XMP block; these tags live in a second APP1 XMP block written by Lightroom |
| LookCopyright / LookName / LookAmount / LookGroup / LookSupports* | 19 | `crs:Look*` struct fields — the Look struct is not recursed (similar to MaskGroup issue, fix pattern known from DerivedFrom) |
| CreatorAddress/City/Country/PostalCode/Region/WorkEmail/WorkTelephone | 1-2 | `Iptc4xmpCore:Creator*` — likely also in second XMP block |

**Fix:** (a) extract ALL APP1 XMP blocks, not just the first; (b) apply the struct-attribute pattern to crs:Look.

---

## 4. MaskGroup Struct Flattening (~25 files)

| Tag | Files | Ref | Ours |
|---|---|---|---|
| MaskGroupBasedCorrMaskVersion | 2 | `2` | `2,2` |
| MaskGroupBasedCorrMaskFeather | 1 | `100` | `0.507812,100,100` |
| MaskGroupBasedCorrMaskFlipped | 1 | `true` | `true,true` |

**Cause:** Nested `crs:Masks`/`crs:CorrectionMasks` arrays — each mask is a struct; we flatten all values into comma-joined strings.

**Fix:** Same struct-attribute + array-of-struct recursion as DerivedFrom fix. Emit one flattened struct per mask index.

---

## 5. Minor / Remaining (~70 files)

| Tag | Files | Issue |
|---|---|---|
| FileSize | 26 | boundary formatting (exiftool kB < 2048 kB, MB 2 sig digits) — fix exists, needs verification on edge values |
| GPSAltitude | 10 | formatting (`123 m` vs `123.45`) |
| SubjectDistance | 10 | makernote-sourced (blocked on makernotes) |
| CodedCharacterSet | 7 | IPTC `UTF8` rendering |
| HierarchicalSubject | 2 | files with no Keywords/Subject |
| Misc single-file | ~15 | crs ToneCurve separators, stEvt joins, etc. |

---

## Fixed This Session

- ✅ **DerivedFrom\* (146 files → 0)** — struct-attribute parsing + group priority
- ✅ `DateCreated` truncation — full datetime with tz now
- ✅ `DateTimeCreated` duplication
- ✅ SubSec composites — subseconds + tz
- ✅ `HierarchicalSubject` — composite from Keywords/Subject (19 → 2)
- ✅ XMP hyphenated prefixes (`XMP-lr`, `XMP-iptcCore`)
- ✅ Simple XMP element parsing
- ✅ IPTC_LOOKUP restored (ObjectName, Keywords, By-line were accidentally dropped)

---

## Priority for Next Work

1. **Per-model crop/CoC tables** — fixes 191 optical divergences at once (biggest single win)
2. **Multi-block XMP extraction** — fixes ~35 missing tag mappings
3. **crs:Look struct recursion** — fixes ~19×5 Look* tags (same pattern as DerivedFrom fix)
4. **MaskGroup struct output** — fixes ~25 structural divergences (same pattern)