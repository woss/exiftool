---
sidebar_position: 5
slug: /parity
---

# Parity with ExifTool

exiftool-ts is not a clean-room reimplementation of ExifTool's *knowledge* — it reuses the real ExifTool as ground truth and wraps that in types. This page documents what parity means here, how it is enforced, what is known to diverge, what is not implemented, and what comes next.

The deal in one sentence: **any value difference from real ExifTool is either fixed or registered with a documented reason. Unregistered divergence fails the build.**

## How parity is enforced

The reference implementation is the real ExifTool binary, **pinned to 13.55** in CI (both the CI and release workflows download the 13.55 tarball, so local and CI comparisons test the same reference).

### 1. The parity suite (`src/cli/exiftool-parity.test.ts`)

Runs on every test pass when `exiftool` is on PATH (skipped with a placeholder otherwise, so sandboxed environments stay green):

| Check | What it proves |
|---|---|
| Version declaration | Our declared ExifTool version matches the reference `exiftool -ver` major.minor |
| JSON value parity | Same fixtures through both implementations; every shared tag compared as-printed; any mismatch not in the known-divergence register fails |
| Thumbnail parity | `-ThumbnailImage` bytes match the reference byte-for-byte |
| Write round-trip (ours → theirs) | Files our writer produces read identically via real exiftool |
| Write round-trip (theirs → ours) | Files written by real exiftool parse identically via our reader |
| Backup convention | `_original` backup naming matches ExifTool's convention |

### 2. The library sweep (`scripts/library-parity.mts`)

CI fixtures are few. The library sweep is the wide net: it compares the built CLI against real exiftool for **every file in a real photo library** — 218 files and **66,156 shared-tag comparisons** on the last full run — and aggregates divergences by tag name. Results and fix history are recorded in the working register at [`DIVERGENCES.md`](https://github.com/woss/exiftool/blob/main/DIVERGENCES.md).

Run it against your own library (requires `exiftool` on PATH):

```bash
pnpm build
pnpm tsx scripts/library-parity.mts /path/to/your/photos
```

### 3. Generated tag database

The tag database is not hand-maintained: `pnpm generate-tags` parses ExifTool's Perl source and extracts tag tables — names, numeric ids, print conversions — into TypeScript. When ExifTool learns a tag, the library inherits it on the next regeneration.

## Known divergences

These are the differences we know about, each with a reason (`KNOWN_DIVERGENCES` in `src/cli/exiftool-parity.test.ts`). Shrinking this table is progress; adding to it requires a documented reason.

| Tag | Reason |
|---|---|
| `FileModificationDate`, `FileAccessDate`, `FileModifyDate`, `FileInodeChangeDate` | Local UTC offset not appended yet |
| `ApplicationRecordVersion` | IPTC record stored raw (bytes) instead of converted to number |
| `HyperfocalDistance` | Circle-of-confusion lookup not implemented |
| `ApproximateFocusDistance` | Rational printed as fraction, not decimal |
| `LensID` | Requires Canon makernote lens-model lookup tables (blocked on MakerNotes) |
| `FlashCompensation` | Rational printed as fraction, not decimal |
| `ScaleFactor35efl` | Crop-factor lookup not implemented (defaults to 1) |
| `CircleOfConfusion` | Model-specific CoC tables not implemented (default 0.030 mm) |
| `FOV` | Depends on the crop factor (model-specific table pending) |
| `FocalLength35efl` | Crop-factor dependent (e.g. 100 mm Canon APS-C reads 272 mm in exiftool, 100 mm at our 1.0 default) |
| `SubSecCreateDate` | Sub-second segment of composite dates not merged yet |

The library sweep additionally tracks live divergences found on real-world files (Lightroom edit stacks are the current frontier: `RetouchArea*` structs, remaining `MaskGroup` attributes, `GPSAltitude` composite reference suffix). Recent fixes landed there include the full optical composite chain (`FOV`/`DOF`/`CircleOfConfusion` math ported from `Exif.pm`/`Canon.pm`), XMP struct-attribute parsing (`DerivedFrom*`, `Creator*` contact flattening), and MaskGroup flattening — see `DIVERGENCES.md` for the current counts and fix log.

## What works

| Area | State |
|---|---|
| Read JPEG / PNG / WebP / AVIF-HEIF | ✅ verified against reference exiftool |
| EXIF (IFD0 + sub-IFDs + GPS + IFD1) | ✅ both endians |
| XMP / IPTC-IIM / ICC / Photoshop IRB / JFIF | 🟨 core coverage, not full |
| MPF embedded-image extraction (`-ee`) | 🟨 partial |
| Write JPEG / PNG / WebP / AVIF | ✅ IFD0 tag subset, `_original` backups |
| `-stay_open` daemon protocol | ✅ stdin command loop |
| CLI: `-j -csv -X -b -d -c -g -G -v -q -if -o -r -ext -i` | ✅ |
| Browser export (`@woss/exiftool/browser`) | ✅ same parsers, in-memory buffers |

## What is not implemented

Honest list, in rough priority order:

- **MakerNotes decoding** — vendor-specific binary metadata blocks (Canon, Nikon, Sony, …). This is the single biggest gap: it blocks `LensID`, model-specific crop-factor lookups, and a family of camera-specific tags.
- **RAW containers** — CR2, DNG, NEF and the rest of the TIFF-based camera formats. Not started.
- **PDF and video metadata** — not started.
- **C2PA / Content Credentials (JUMBF + CBOR)** — planned, not implemented. The full architecture and phased plan live in [`C2PA_PLAN.md`](https://github.com/woss/exiftool/blob/main/C2PA_PLAN.md): JUMBF box parser, APP11/`caBX`/QuickTime format hooks, CBOR decoder, tag tables.
- **Full write surface** — writes cover an IFD0 tag subset on JPEG/PNG/WebP/AVIF. ExifTool writes far more groups (XMP, IPTC, EXIF sub-IFDs, makernotes).
- **Full XMP/IPTC/ICC coverage** — core coverage today; long tail of schemas and edge cases remains.

## Roadmap

1. **Shrink the divergence register toward zero** — current sweep priorities: the `RetouchArea*` family (~65 pairs across 5 files), the `GPSAltitude` composite reference suffix, remaining mask struct attributes (`MasksValue`, `ZeroX`/`ZeroY`), and a handful of formatting singles.
2. **MakerNotes decoding** — unlocks `LensID`, crop-factor-dependent composites, and camera-specific tags.
3. **C2PA/JUMBF support** — per the phased plan; each format (JPEG, PNG, QuickTime) works independently.
4. **Deeper writing** — EXIF sub-IFDs, XMP, IPTC-IIM beyond the current IFD0 subset.
5. **More containers** — RAW formats, PDF, video, extending toward ExifTool's reading surface.

## Helping with parity

This is the part where outside testing beats anything the maintainer can do alone — the fixture set is finite, your camera is not in it.

- **Run the sweep on your own library** (commands above). Every NEW divergence it prints is actionable.
- **Report mismatches** at [github.com/woss/exiftool/issues](https://github.com/woss/exiftool/issues) — ideally with a sample file that reproduces it. Files that parse strangely are exactly how MakerNotes support gets built.
- **Send a pull request** — fixing a register entry, porting a PrintConv table, or picking up a roadmap item. A PR that shrinks `KNOWN_DIVERGENCES` is the fastest way to help.
