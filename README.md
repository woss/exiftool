# exiftool-ts

TypeScript rewrite of ExifTool for Deno. Read/write metadata across 140+ file formats.

## Status

Early development. Tag database and format parsers are being built.

## Architecture

```
cli.ts             → CLI entry point
mod.ts             → Library exports
src/
  exiftool.ts      → Main ExifTool class
  tag-db.ts        → Tag database (name/id/group lookups)
  types.ts         → Core types (TagEntry, ExifToolOptions, etc.)
  cli/
    args.ts        → CLI argument parser
    output.ts      → Output formatters (JSON, XML, CSV, tabular)
  format/
    mod.ts         → Format parser registry
    jpeg.ts        → JPEG parser
  exif/
    types.ts       → EXIF IFD type definitions
    ifd.ts         → IFD structure parser
  utils/
    binary.ts      → Binary read helpers
    encoding.ts    → String encoding/escaping
scripts/
  generate-tags.ts → Generate tag DB from ExifTool Perl source
  test-harness.ts  → Compare output against real exiftool
```

## Design Principles

- **Trust ExifTool** — real exiftool output is the ground truth. Test harness compares results.
- **Auto-generated tag database** — tag definitions are parsed from ExifTool Perl source at build
  time, not hand-coded.
- **Modular format parsers** — each file format is a separate module registered with the format
  registry.
- **Single codebase** — targets Deno CLI, with WASM compilation via `deno compile`.

## Usage

```bash
# Run CLI
deno run -A cli.ts --help

# Run tests
deno test -A

# Generate tag definitions (requires exiftool source)
deno run -A scripts/generate-tags.ts

# Compare against real exiftool
deno run -A scripts/test-harness.ts image.jpg
```

## Project Scope

Parsing metadata for 140+ formats across EXIF, IPTC, XMP, GPS, ICC, and format-specific tags. Output
formats include JSON, XML, CSV, HTML, and structured tag dumps.

## License

MIT
