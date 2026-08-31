# exiftool-ts — Parity Divergence Register

**Last updated:** 2026-08-31 · HEAD `f921ae8` · Library: 218 files, 65,826 comparisons · Asset parity: 0 NEW

## Summary

| Metric | Count |
|---|---|
| **NEW divergences** | 488 |
| **Allowlisted** | 546 |
| **Shared tag comparisons** | 65,826 |

---

## 1. DerivedFrom Group Priority (146 files)

| Tag | Files | Ref example | Ours example |
|---|---|---|---|
| DerivedFromDocumentID | 74 | `4B27093674C86564E4F96CA0C10C0DD5` | `xmp.did:c5024cfa-...` |
| DerivedFromInstanceID | 72 | `xmp.iid:1cb72454-...` | `xmp.iid:bb4e4353-...` |

**Cause:** exiftool's group-priority engine prefers IPTC/EXIF hex IDs over XMP UUIDs. We take the first XMP source encountered.

**Fix:** Implement exiftool's group priority (IPTC > XMP > EXIF) for these IDs.

---

## 2. Optical Composites — Per-Model Tables Missing (191 files)

| Tag | Files | Ref example | Ours example |
|---|---|---|---|
| DOF | 53 | `0.001 m (0.300 - 0.300 m)` | MISSING |
| CircleOfConfusion | 52 | `0.019 mm` | `0.030 mm` (default) |
| FocalLength35efl | 44 | `100.0 mm (35 mm equivalent: 158.5 mm)` | `100.0 mm (35 mm equivalent: 100.0 mm)` |
| FOV | 42 | `13.0 deg` | `20.4 deg` |
| HyperfocalDistance | ~40 | (varies) | (wrong, follows CoC) |

**Cause:** Composites exist but use defaults: crop factor 1.0, CoC 0.030 mm. exiftool has per-model tables (Canon APS-C = 1.6, Nikon APS-C = 1.5, etc.) and per-model CoC values.

**Fix:** Add makernote-based model lookup → crop factor table + CoC table. ~200 models covered in exiftool.

---

## 3. Missing XMP Tag Mappings (52 files)

| Tag | Files | Ref example | Status |
|---|---|---|---|
| CreatorWorkURL | 33 | `https://woss.photo` | Namespace `XMP-iptcCore` not in extracted XMP block |
| LookCopyright | 19 | `© 2018 Adobe Systems, Inc.` | `crs:LookCopyright` mapped but source absent |
| LookName | 19 | `Adobe Standard` | `crs:Name` mapped |
| LookAmount | 19 | `1.00` | `crs:Amount` mapped |
| LookGroup | 19 | `Color` | `crs:Group` mapped |
| LookSupportsAmount | 19 | `True` | mapped |
| LookSupportsMonochrome | 19 | `True` | mapped |
| LookSupportsOutputReferred | 19 | `True` | mapped |
| CameraProfile | 19 | `Adobe Standard` | `crs:CameraProfile` mapped |
| CreatorAddress | 1 | `Triq Il Gebla...` | `Iptc4xmpCore:CreatorAddress` mapped |
| CreatorCity | 1 | ... | mapped |
| CreatorCountry | 1 | ... | mapped |
| CreatorPostalCode | 1 | ... | mapped |
| CreatorRegion | 1 | ... | mapped |
| CreatorWorkEmail | 1 | ... | mapped |
| CreatorWorkTelephone | 1 | ... | mapped |

**Cause:** Tags use `XMP-iptcCore:` or `XMP-lr:` namespaces with hyphens. Our extraction only finds XMP in the first `http://ns.adobe.com/xap/1.0/` block; Lightroom writes these tags in a separate XMP block we don't reach.

**Fix:** Extract all APP1 XMP blocks, not just the first.

---

## 4. MaskGroup Struct Flattening (~25 files)

| Tag | Files | Ref | Ours |
|---|---|---|---|
| MaskGroupBasedCorrMaskVersion | 2 | `2` | `2,2` |
| MaskGroupBasedCorrMaskFeather | 1 | `100` | `0.507812,100,100` |
| MaskGroupBasedCorrMaskFlipped | 1 | `true` | `true,true` |
| MaskGroupBasedCorrCorrectionName | ... | (single) | (array) |

**Cause:** exiftool emits one MaskGroup per correction (structured). We flatten all into comma-joined arrays.

**Fix:** Emit arrays of objects mirroring exiftool's struct output, or implement MaskGroup recursion.

---

## 5. Minor / Formatting (60 files)

| Tag | Files | Issue |
|---|---|---|
| CodedCharacterSet | 7 | IPTC `UTF8` vs exiftool `UTF-8` |
| GPSAltitude | 10 | formatting (exiftool: `123 m`, ours: `123.45`) |
| SubjectDistance | 10 | missing in some files (makernote) |
| FileSize | 26 | boundary: exiftool kB < 2048 kB, MB at 2 sig digits |
| SubSecCreateDate | 37 | subsecond + tz now fixed |
| SubSecDateTimeOriginal | 37 | subsecond + tz now fixed |
| SubSecModifyDate | 37 | subsecond + tz now fixed |
| ExposureCompensation | 20 | fraction rendering `-2/3` vs `-0.67` (fixed in asset parity) |
| ShutterSpeed | 16 | `s` suffix (exiftool omits, we fixed) |

---

## Fixed This Session (no longer NEW)

- ✅ `DateCreated` — was truncated to date-only; now full datetime with tz
- ✅ `DateTimeCreated` — no longer duplicates time
- ✅ `SubSecCreateDate/DateTimeOriginal/ModifyDate` — now include `.83` subseconds
- ✅ `HierarchicalSubject` — composite from Keywords/Subject, comma-separated (19 → 2 MISSING)
- ✅ XMP hyphenated prefixes (`XMP-lr`, `XMP-iptcCore`) — parsed
- ✅ Simple XMP element parsing (`<photoshop:DateCreated>...`)

---

## Priority for Next Work

1. **Per-model crop/CoC tables** — fixes 191 optical divergences at once
2. **Multi-block XMP extraction** — fixes 52 missing tag mappings
3. **DerivedFrom group priority** — fixes 146 ID divergences
4. **MaskGroup struct output** — fixes ~25 structural divergences