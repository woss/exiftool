<p align="center">
  <img src="docs/static/img/logo.svg" alt="exiftool-ts logo" width="96">
</p>

# exiftool-ts

TypeScript rewrite of [ExifTool](https://exiftool.org) for Node.js. Read and write
metadata from JPEG, PNG, WebP, AVIF/HEIF, and TIFF-family images — with a fully
typed library API and a drop-in CLI.

## Why

ExifTool is the gold standard for metadata — but it's a 30k-line Perl program.
Every invocation pays a Perl startup cost, embedding it in a JS/TS service means
shelling out or managing sidecars, and there are no types.

exiftool exists to bring that capability natively into the TypeScript
ecosystem:

- **Typed end to end** — `read()` returns an inferred `FileInfo`; no parsing strings.
- **Embeddable** — a single runtime dependency (`fflate`, for PNG chunk
  compression); import the library directly or ship the CLI alongside your
  service. No child processes.
- **Trust ExifTool as ground truth** — our parity suite diffs our output against
  the real `exiftool` binary on every run; formatting bugs get caught, not shipped.
- **Auto-generated tag database** — tag definitions are parsed from the ExifTool
  Perl source at build time (~thousands of tags), not hand-maintained.

## Status & parity

Early development, moving fast. The full, maintained status matrix lives in the
[parity docs](https://woss.github.io/exiftool/parity) and the working register
in [`DIVERGENCES.md`](./DIVERGENCES.md).

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

The package ships compiled JS with full `.d.ts` types and a single runtime
dependency (`fflate`).

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

const tool = new ExifTool({ plugins: MODERN_PLUGINS }); // JPEG, PNG, GIF, WebP, AVIF — ~91% of web image traffic
```

Three presets ship from the plugins subpath: `MODERN_PLUGINS` (web formats,
per HTTP Archive's Web Almanac 2024), `MODERN_RAW_PLUGINS` (DNG/CR2/NEF/ARW/ORF/RW2
RAW containers plus `.xmp` sidecar support) and `ALL_PLUGINS` (every shipped
parser, in detection order). Individual parsers
(`jpegParser`, `pngParser`, `webpParser`, `avifParser`, `tiffRawParser`) and fully custom plugins
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

Near term: deepen XMP/IPTC writing, extend the container list toward the
formats exiftool covers. EXIF (IFD0/ExifIFD/GPS) writing and MakerNote
decoding for the core 6 vendors are shipped. The long-term target remains
parity with ExifTool's reading surface across its supported formats — tracked in
the [parity docs](https://woss.github.io/exiftool/parity).

## License

[MIT](LICENSE) — © woss (woss.io), covering this repository's TypeScript code only.

One exception, documented in [NOTICE](NOTICE) and
[src/tags/generated/LICENSE.md](src/tags/generated/LICENSE.md): the embedded
tag-database JSON (`src/tags/generated/`) is derived from Phil Harvey's
ExifTool (`exiftool -listx` tables and PrintConv values) and is subject to
ExifTool's own license — GPL-3.0-or-later **or** Artistic License 2.0 —
redistributed here under the Artistic License 2.0.

## Credits

**ExifTool was created by [Phil Harvey](https://exiftool.org), who maintains
it single-handedly since 2003.** This project exists because of his work and
would not be possible without it. The TypeScript code is an independent
implementation that uses his tool only as a behavioral reference for output
parity; the embedded tag-database tables are derived from ExifTool and
carried under his dual license (see License above). All credit for the
ExifTool concept, design, and decades of metadata expertise belongs to him.
Consider [supporting his work](https://exiftool.org/#pay).


---

Made with Human and AI effort — [woss.io](https://woss.io)
