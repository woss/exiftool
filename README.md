# exiftool-ts

TypeScript rewrite of [ExifTool](https://exiftool.org) for Node.js. Read and write
metadata from JPEG, PNG, WebP, AVIF/HEIF, and TIFF-family images — with a fully
typed library API and a drop-in CLI.

## Why

ExifTool is the gold standard for metadata — but it's a 30k-line Perl program.
Every invocation pays a Perl startup cost, embedding it in a JS/TS service means
shelling out or managing sidecars, and there are no types.

exiftool-ts exists to bring that capability natively into the TypeScript
ecosystem:

- **Typed end to end** — `read()` returns an inferred `FileInfo`; no parsing strings.
- **Embeddable** — zero runtime dependencies; import the library directly or
  ship the CLI alongside your service. No child processes.
- **Trust ExifTool as ground truth** — our parity suite diffs our output against
  the real `exiftool` binary on every run; formatting bugs get caught, not shipped.
- **Auto-generated tag database** — tag definitions are parsed from the ExifTool
  Perl source at build time (~thousands of tags), not hand-maintained.

## Status & parity

Early development, moving fast. Full detail lives in
[`docs/PARITY_MATRIX.md`](./docs/PARITY_MATRIX.md). Summary:

| Area                                                     | State                                   |
| -------------------------------------------------------- | --------------------------------------- |
| Read JPEG / PNG / WebP / AVIF-HEIF                       | ✅ verified against reference exiftool  |
| EXIF (IFD0 + sub-IFDs + GPS + IFD1)                      | ✅ both endians                         |
| XMP / IPTC-IIM / ICC / Photoshop IRB / JFIF              | 🟨 core coverage                        |
| MPF embedded-image extraction (`-ee`)                    | 🟨                                      |
| Write JPEG / PNG / WebP / AVIF                           | ✅ IFD0 tag subset, `_original` backups |
| `-stay_open` daemon protocol                             | ✅ stdin command loop                   |
| CLI: `-j -csv -X -b -d -c -g -G -v -q -if -o -r -ext -i` | ✅                                      |
| MakerNotes, RAW containers (CR2/DNG/…), PDF/video        | ❌ not started                          |

Value-level parity is enforced by `src/cli/exiftool-parity.test.ts`, which runs
the real `exiftool` binary on shared fixtures and fails on any undocumented
divergence. Remaining gaps are registered in `KNOWN_DIVERGENCES` inside that
file with reasons (file-date timezone offsets, makernote lens lookups, …).

## Install

**npm** (CLI + library, Node ≥ 18):

```bash
npm i -g @woss/exiftool
exiftool-ts photo.jpg
```

The package ships compiled JS with full `.d.ts` types and has **zero runtime
dependencies**.

**JSR** (for Deno consumers, runs from TypeScript source):

```bash
deno install -A -n exiftool-ts jsr:@woss/exiftool
```

## Library usage

The package ships `.d.ts` declarations, so consumers get full types and
autocomplete out of the box:

```ts
import { ExifTool } from "@woss/exiftool";

const tool = new ExifTool();

const info = await tool.read("photo.jpg");
info.tags.Make; // "Canon"        — typed as TagValue
info.tags.ExposureTime; // "1/200"        — formatted like exiftool
Object.keys(info.tags); // browse everything

// In-memory buffers work too:
const meta = await tool.readBytes(imageBuffer);

// Writing (creates photo.jpg_original unless suppressed):
await tool.write("photo.jpg", { Artist: "me", Copyright: "(c)" });
```

Exported surface: `ExifTool`, `TagDb`, `writeTags`, `UnsupportedFormatError`,
and the types `FileInfo`, `TagValue`, `WriteResult`, `ParseHints`, `ReadOptions`,
`TagEntry`, `TagGroups`.

## Plugins

Formats are plugins. By default `ExifTool` loads every built-in one, but you
can restrict an instance to a set — the bundler then ships only those parsers:

```ts
import { ExifTool } from "@woss/exiftool";
import { MODERN_PLUGINS } from "@woss/exiftool/plugins";

const tool = new ExifTool({ plugins: MODERN_PLUGINS }); // JPEG, PNG, WebP, AVIF only
```

`MODERN_PLUGINS` / `ALL_PLUGINS` cover the shipped formats; individual parsers
(`jpegParser`, `pngParser`, `webpParser`, `avifParser`) and fully custom plugins
(`{ format, extensions, canParse, parse, writeBytes? }`) come from the same
subpath. A plugin without `writeBytes` is read-only. The default — every
built-in — loads lazily, so `new ExifTool()` keeps working unchanged.

## Browser

The parser core is platform-free. The `browser` export condition resolves to a
bundle with no Node builtins; reads and writes work on in-memory buffers:

```ts
import { ExifTool, MODERN_PLUGINS } from "@woss/exiftool/browser";

const tool = new ExifTool({ plugins: MODERN_PLUGINS });
const { bytes, written } = await tool.writeBytes(imageBuffer, { Artist: "me" });
const info = await tool.readBytes(bytes);
```

Path-based `read`/`write` stay Node-only (main entry); browser consumers get
`readBytes`/`writeBytes`.

## CLI usage

```bash
exiftool-ts photo.jpg                           # default tabular dump
exiftool-ts -j photo.jpg                        # JSON
exiftool-ts -X photo.jpg > out.xml              # XML
exiftool-ts -csv *.jpg > out.csv                # CSV
exiftool-ts -r -ext jpg .                       # recurse a directory tree
exiftool-ts -if '$Make eq Canon' *.jpg          # condition filter
exiftool-ts -ee -j multi-picture.jpg            # embedded images as extra docs
exiftool-ts '-Artist=me' photo.jpg              # write a tag (_original backup)
exiftool-ts --overwrite-original '-Software=x' photo.jpg
printf -- '-j\nphoto.jpg\n-execute\n-stay_open\nFalse\n' \
  | exiftool-ts -stay_open True                 # persistent daemon
```

## Architecture

```
mod.ts               → JSR barrel (re-exports the public API)
src/
  cli.ts             → CLI entry point (arg normalization → main())
  exiftool.ts        → Node ExifTool class (path-based read / write via fs)
  exiftool-core.ts   → Platform-free core (readBytes / writeBytes / plugins)
  browser.ts         → Browser entry (platform-free bundle)
  plugins.ts         → Plugin presets (./plugins subpath)
  tag-db.ts          → Tag database (name/id/group lookups)
  types.ts           → Core types (FileInfo, TagEntry, TagValue, …)
  cli/
    args.ts          → ExifTool-style argument parser (normalizeArgs + parseCliArgs)
    filestat.ts      → File-stat tag overlay (FileSize, FileModifyDate, …)
    filter.ts        → -if condition evaluation
    glob.ts          → directory recursion / extension filters
    output.ts        → JSON / XML / CSV / tabular formatters
    stay-open.ts     → -stay_open daemon command loop
    verbosity.ts     → -v/-q rendering helpers
  format/
    mod.ts           → Plugin contract + detection (FormatParser, detectParser)
    all.ts           → Built-in plugin set (lazy default)
    jpeg.ts          → JPEG segment walk (EXIF/XMP/IPTC/ICC/MPF/Adobe)
    png.ts           → PNG chunk walk (eXIf/iTXt/zTXt/tEXt/iCCP…)
    webp.ts          → RIFF/VP8X chunk walk
    avif.ts          → ISOBMFF box walk (meta items, colr, pixi)
  exif/
    ifd.ts           → Bounds-checked IFD structure parser
    tiff.ts          → Shared TIFF engine (both endians, GPS/sub-IFDs)
    tiff-builder.ts  → TIFF serializer for the write path
    values.ts        → PrintConv value formatting
    composite.ts     → Composite tag derivation (35mm equiv, LightValue…)
    xmp.ts           → XMP/RDF extraction
    app13.ts         → Photoshop IRB + IPTC IIM extraction
    icc.ts           → ICC profile header/tag parsing
  write/
    pipeline.ts      → Safe-overwrite pipeline (temp swap + _original backup)
    writers.ts       → Per-container writers (JPEG APP1 / PNG eXIf / WebP / AVIF)
  utils/
    crc32.ts         → CRC-32 (PNG chunks)
    encoding.ts      → String encoding/escaping helpers
scripts/
  generate-tags.ts   → Generate tag DB from ExifTool Perl source
  test-harness.ts    → Compare output against real exiftool
  coverage-audit.ts  → Enforce 100% line/function coverage gate
.github/workflows/
  release.yml        → npm + JSR publish, dist tarball on tags
```

## Development

```bash
pnpm test                  # run the full test suite
pnpm check                 # typecheck
pnpm coverage-audit        # tests + enforce 100% line/function coverage
pnpm generate-tags         # regenerate tag DB (requires exiftool source)

# Parity vs real exiftool (needs `exiftool` on PATH):
npx vitest run src/cli/exiftool-parity.test.ts
```

## Project scope

Near term: deepen EXIF/XMP/IPTC writing, add maker-note decoding, extend the
container list toward the formats exiftool covers. The long-term target remains
parity with ExifTool's reading surface across its supported formats — tracked in
the parity matrix above.

## License

MIT
