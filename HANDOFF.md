# Handoff: exiftool-ts

Date: 2026-08-31 · HEAD: `57d371e` · Working tree clean · exiftool 13.55 installed locally (ground truth)

## Mission

Node ≥18 ESM port of ExifTool (migrated from Deno earlier this year). Zero runtime deps. Goal: byte-for-byte parity of `-j` JSON output vs exiftool 13.55, three-channel release (npm `dist/`, JSR source, GitHub).

## Current verified state

- **465/465 tests pass, `tsc` 0 errors, coverage 100% lines/functions (35 modules)** — all gates green
- Parity suites: `scripts/parity-check.mts` (5 assets) and `scripts/library-parity.mts` (218-file sweep, 65,799 comparisons) report **0 new divergences** — but see "date bugs in flight" below: three real divergences exist and are masked by the parity allowlist
- Toolchain: pnpm 10.5.2, vitest 4 + native V8 coverage (standalone c8 mis-remaps vite-transformed code — always `vitest --coverage`), tsc NodeNext, tsdown/rolldown build → `dist/`, tsx for scripts
- Assets renamed: `assets/{01.jpg, 02.dng, 03.jpg, 04-ai.png, 05-ai.jpeg}`

## In flight: three date bugs (user-reported "Date is weirdly parsed")

Evidence gathered, fixes NOT yet applied. All three confirmed by side-by-side diff on `assets/01.jpg` and `assets/03.jpg`.

### 1. XMP `DateCreated` truncated to date-only (WRONG)

- `src/exif/xmp.ts:428-432` special-cases `photoshop:DateCreated` → date portion only
- exiftool renders FULL date+time: `2015:04:25 16:34:38` (01.jpg), `2021:06:10 17:34:25+01:00` (03.jpg)
- Fix: delete the special case. The standard final-pass normalization (`T`→space at `src/exif/xmp.ts` ~line 404) already produces the exact exiftool string
- **Also remove the masking allowlist entry** in `src/cli/exiftool-parity.test.ts:49-51` (`DateCreated: 'xmp date tz rendering varies with group priority'`)

### 2. `SubSecCreateDate` missing subsec suffix

- 01.jpg: exiftool `2015:04:25 16:34:38.83` (CreateDate `16:34:38` + SubSecTimeDigitized `83`); ours drops `.83`
- `src/exif/composite.ts:93-101` `fmtDateTime(dt, offset)` never appends subsec; call sites at 103-105 pass only offsets
- Fix: append `.${subsec}` when SubSecTimeDigitized/SubSecTimeOriginal/SubSecTime present (normalize 2-digit → `.83` stays `.83`)

### 3. Spurious `SubSecDateTimeOriginal` on 01.jpg

- Ours emits `2015:04:25 16:34:38` (identical to DateTimeOriginal: no subsec, no tz); exiftool omits the tag
- 03.jpg (has `OffsetTimeOriginal +01:00`) — both emit it; 01.jpg has only `OffsetTime +02:00` (not Original)
- Likely gate: emit only when subsec exists OR `OffsetTimeOriginal`/`OffsetTimeDigitized` applies a real tz change. **Not yet pinned — verify empirically against exiftool before coding** (exiftool's SubSec* composite fallback logic is subtle; test with a synthetic file if needed)

Verification after fixes: `rm -rf dist && pnpm build`, then per-file `node dist/cli.js assets/01.jpg -j` vs `exiftool -j assets/01.jpg`, then full gates.

## Release readiness (user asked; answer pending the date fixes)

**Verdict: ready for 1.0.0 after the three date bugs land** (they're user-visible correctness). Everything else:

- Blocking-level gaps: CLI file-level tags missing (`SourceFile`, `FileName`, `Directory`, `FileType`, `FileTypeExtension`, `MIMEType`, `ExifToolVersion` placement). exiftool `-j` emits them per file; FileType/MIMEType already set by jpeg/png parsers, so this is a small `runAction` overlay in `src/cli.ts` + a `FILE_TYPE_META` map (jpeg→jpg/image-jpeg, png, webp, avif; tiff→tiff/image-tiff). Decide whether to ship v1 with or without (recommend: add first, ~30 lines)
- Version: `package.json` still `0.1.0` — bump to `1.0.0`; release workflow `.github/workflows/release.yml` already handles npm + JSR (native binary channel was dropped)
- Known non-blocking divergences (documented in `KNOWN_DIVERGENCES` in `src/cli/exiftool-parity.test.ts`): MaskGroup mask-struct recursion (~40 files), `DerivedFromDocumentID` group-priority (exiftool prefers IPTC hex IDs), makernotes (Canon `LensID` tables, per-model CoC/crop factors — affects ~45 files' optical composites), C2PA/JUMBF plugin, `SubSecDateTimeOriginal` edge cases above

## Architecture decisions locked in (do not relitigate)

- Parser registry = explicit plugin objects (`FormatParser` interface); default = all built-ins via lazy `import('./format/all.js')` — the one sanctioned dynamic import
- `src/mod.ts` public barrel; root `mod.ts` re-exports for JSR; `src/browser.ts` browser entry, build fails on `node:` leaks
- Entity decode centralized in `parseXMP` final pass (`&amp;` LAST); XMP lists render as JSON arrays; scalar single keywords stay scalars
- IFD1 duplicate suppression with `duplicates` opt mirroring exiftool `-a`; `ThumbnailCompression` suppressed only in JPEG container
- tsdown: CLI single-file (`inlineDynamicImports`), lib unbundled, 3.8 MB JSON tag DB externalized; `publint`+`attw` gate

## Session gotchas

- **bash `grep`/`sed -i` are rtk-proxied and return wrong results** — use built-in Grep/read; verify file state with `read`, never bash grep
- Edit tool: **one file per edit call** when ranges come from bash output (multi-file calls with relative lines misapplied twice this session)
- `dist/` goes stale: always `rm -rf dist && pnpm build` before comparing dist CLI output
- Coverage gate is 100% — any new branch needs a test or `pnpm coverage-audit` fails
- `assets/` files are real user photos; exiftool binary at PATH is the reference implementation

## Orientation map

| Area | Files |
|---|---|
| XMP | `src/exif/xmp.ts` (TAG_REMAP, hyphen-tolerant attrs, entity decode ~392-427, DateCreated case 428-432) |
| Composites/PrintConv | `src/exif/composite.ts` (SubSec 93-109, optical composites, exposure fractions), `src/exif/values.ts` |
| Containers | `src/format/{jpeg,png,webp,avif}.ts` (jpeg: JFIF APP0, APP13, Adobe; png: iTXt XMP parse, tEXt) |
| EXIF/IPTC | `src/exif/tiff.ts` (hints: coordFormat+duplicates), `src/exif/iptc.ts` |
| CLI | `src/cli.ts` (runAction, file-stat overlay), `src/cli/output.ts` (formatJSON), `src/cli/args.test.ts` |
| Parity tools | `scripts/parity-check.mts`, `scripts/library-parity.mts`, `scripts/coverage-audit.ts`, `src/cli/exiftool-parity.test.ts` |
| CI/Release | `.github/workflows/{ci,release}.yml`, `jsr.json`, `package.json` |

## Command cheat sheet

```bash
pnpm vitest run --reporter=dot          # suite
npx tsc -p tsconfig.json                # typecheck (expect 0)
pnpm coverage-audit                     # 100% gate
rm -rf dist && pnpm build               # rebuild before CLI comparisons
pnpm exec tsx scripts/parity-check.mts  # asset parity vs exiftool
pnpm exec tsx scripts/library-parity.mts # 218-file sweep (slow)
git add -A && git commit                # conventional commits
```
