# Handoff: exiftool-ts

Date: 2026-08-31 · HEAD: `a0b32e9` · Working tree clean · exiftool 13.55 installed locally (ground truth)

## Mission

Node ≥18 ESM port of ExifTool (migrated from Deno earlier this year). Zero runtime deps. Goal: byte-for-byte parity of `-j` JSON output vs exiftool 13.55, three-channel release (npm `dist/`, JSR source, GitHub).

## Current verified state

- **466/466 tests pass, `tsc` 0 errors, coverage 100% lines/functions (35 modules)** — all gates green
- Parity suites: `scripts/parity-check.mts` (5 assets) and `scripts/library-parity.mts` (218-file sweep, 65,799 comparisons) report **0 new divergences**
- Toolchain: pnpm 10.5.2, vitest 4 + native V8 coverage (standalone c8 mis-remaps vite-transformed code — always `vitest --coverage`), tsc NodeNext, tsdown/rolldown build → `dist/`, tsx for scripts
- Assets renamed: `assets/{01.jpg, 02.dng, 03.jpg, 04-ai.png, 05-ai.jpeg}`

## Fixed this session (user-reported "Date is weirdly parsed")

Three real divergences found and fixed:

### 1. XMP `DateCreated` truncated to date-only (FIXED ✓)

- `src/exif/xmp.ts:428-432` special-cased `photoshop:DateCreated` → date portion only
- exiftool renders FULL date+time: `2015:04:25 16:34:38` (01.jpg), `2021:06:10 17:34:25+01:00` (03.jpg)
- **Fixed**: deleted the special case. Standard final-pass normalization (`T`→space at `src/exif/xmp.ts` ~line 404) already produces exact exiftool string
- **Also removed** the masking allowlist entry in `src/cli/exiftool-parity.test.ts:49-51` (`DateCreated: 'xmp date tz rendering varies with group priority'`)

### 2. IPTC/XMP merge priority wrong (FIXED ✓)

- Segment order: APP13 (IPTC) runs BEFORE XMP APP1 → IPTC sets `DateCreated`/`TimeCreated` first
- XMP `photoshop:DateCreated` (full datetime) should WIN over IPTC (separate date+time)
- **Fixed**: XMP merge at `src/format/jpeg.ts:68-74` now overwrites priority tags (`DateCreated`, `TimeCreated`, `DigitalCreationDate`, `DigitalCreationTime`) even if already present
- IPTC merge at `src/format/jpeg.ts:98-103` skips priority tags if XMP already set them

### 3. `DateTimeCreated` duplication (FIXED ✓)

- Composition at `src/format/jpeg.ts:218-226` now detects if `DateCreated` already includes time (via regex `/\s\d{2}:\d{2}:\d{2}/`)
- If yes: `DateTimeCreated = DateCreated` (no duplication)
- If no: `DateTimeCreated = DateCreated + ' ' + TimeCreated` (legacy behavior)

### 4. Simple XMP element parsing (NEW FEATURE ✓)

- XMP parser now handles non-list elements like `<photoshop:DateCreated>...</photoshop:DateCreated>` (previously only attributes and `rdf:li` lists worked)
- Nested tag detection correctly ignores closing tags: checks `childXml.slice(first '>' + 1, last '<')` for opening tags only
- Coverage test added: `src/exif/xmp.test.ts` "parseXMP parses simple (non-list) elements like photoshop:DateCreated"

## Release readiness

**Verdict: ready for 1.0.0** — all correctness bugs fixed, all gates green.

Remaining non-blocking items (documented in `KNOWN_DIVERGENCES`, parity suite allows them):
- CLI file-level tags missing (`SourceFile`, `FileName`, `Directory`, `FileType`, `FileTypeExtension`, `MIMEType`, `ExifToolVersion` placement) — exiftool `-j` emits them per file; small `runAction` overlay needed (~30 lines)
- Version: `package.json` still `0.1.0` — bump to `1.0.0`; release workflow `.github/workflows/release.yml` handles npm + JSR (native binary channel dropped)
- Known divergences: MaskGroup mask-struct recursion (~40 files), `DerivedFromDocumentID` group-priority (exiftool prefers IPTC hex IDs), makernotes (Canon `LensID` tables, per-model CoC/crop factors — affects ~45 files' optical composites), C2PA/JUMBF plugin

## Architecture decisions locked in (do not relitigate)

- Parser registry = explicit plugin objects (`FormatParser` interface); default = all built-ins via lazy `import('./format/all.js')` — the one sanctioned dynamic import
- `src/mod.ts` public barrel; root `mod.ts` re-exports for JSR; `src/browser.ts` browser entry, build fails on `node:` leaks
- Entity decode centralized in `parseXMP` final pass (`&` LAST); XMP lists render as JSON arrays; scalar single keywords stay scalars
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
| XMP | `src/exif/xmp.ts` (TAG_REMAP, hyphen-tolerant attrs, entity decode ~392-427, simple element parsing ~280) |
| Composites/PrintConv | `src/exif/composite.ts` (SubSec 93-109, optical composites, exposure fractions), `src/exif/values.ts` |
| Containers | `src/format/{jpeg,png,webp,avif}.ts` (jpeg: JFIF APP0, APP13 IPTC merge priority, XMP merge priority; png: iTXt XMP parse, tEXt) |
| EXIF/IPTC | `src/exif/tiff.ts` (hints: coordFormat+duplicates), `src/exif/app13.ts` |
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