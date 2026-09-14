---
sidebar_position: 1
slug: /core/parsing
---

# Core Parsing Architecture

exiftool uses a **streaming, zero-copy** parsing architecture designed for performance and memory efficiency.

## Pipeline Architecture

```
Input (File/Stream/Buffer)
         │
         ▼
Format Detection (Magic Bytes)
         │
         ▼
Format Parser (JPEG/PNG/WebP/AVIF-HEIF/TIFF-family RAW)
         │
         ▼
├── EXIF/TIFF Parser ──────► IFD Walking
├── XMP Parser ───────────► XML + RDF Parsing
├── IPTC Parser ──────────► Application Record Parsing
├── ICC Profile Parser ───► Tag Decoding
├── JUMBF Parser ──────────► Box Walking + CBOR
└── MakerNote Markers ───► "[MakerNote: N bytes]" placeholders (not decoded)
         │
         ▼
Composite Tag Computation
         │
         ▼
Output Normalization (JSON/CSV/Tabular)
```

## Memory Design

- **Zero-copy**: tag values are `Uint8Array` views into the source buffer where possible — copy out before retaining
- **Whole-buffer reads**: files are read fully into memory; there is no streaming or partial-load mode
- **No subprocesses**: parsing happens in-process, one `read()` per file, no `exiftool` binary involved

## Format Parsers

Each format has a dedicated parser plugin in `src/format/`:

| Format | Parser | Key Features |
|--------|--------|--------------|
| JPEG | `jpeg.ts` | APP1 EXIF/XMP, APP13 IPTC, APP11 JUMBF, JFIF, MPF |
| PNG | `png.ts` | iTXt/tEXt/zTXt, eXIf, caBX (JUMBF) |
| WebP | `webp.ts` | VP8/VP8L, EXIF/XMP in VP8X |
| AVIF/HEIF | `avif.ts` | ISOBMFF boxes, Exif/XMP/ICC in meta |
| TIFF-family RAW | `tiff-raw.ts` | TIFF, DNG, CR2, NEF, ARW, ORF, RW2, PEF, ERF, DCR, SRW (read-only) |

## IFD Walking (TIFF/EXIF)

```
TIFF Header (8 bytes)
         │
         ▼
First IFD Offset ──────► IFD Entry Count (2 bytes)
                              │
                              ▼
                      IFD Entries (12 bytes each)
                              │
                              ├─► Tag ID (2 bytes)
                              ├─► Type (2 bytes)
                              ├─► Count (4 bytes)
                              └─► Value/Offset (4 bytes)
                              │
                              ▼
                      Next IFD Offset (4 bytes)
```

## Coordinate Format

GPS coordinates use rational numbers (num/denom):

```typescript
// Internal representation
GPSLatitude: [
  { num: 37, den: 1 },     // degrees
  { num: 45, den: 1 },     // minutes
  { num: 3025, den: 100 }  // seconds (30.25")
]

// Output formats
// DMS: "37° 45' 30.25" N"
// Decimal: 37.758403
```

## Performance Characteristics

Measured on an M2 Max against the reference ExifTool 13.55 binary, 218 real-world JPEGs (~3.1 GB) read by a single process:

| Metric | exiftool-ts | Reference exiftool |
|--------|-------------|--------------------|
| Batch read, one process | 2.1 s (~10 ms/file) | 3.9 s (~18 ms/file) |
| Cold CLI call, single file | ~150 ms (node) / ~125 ms (bun) | ~150 ms |
| Peak memory, same batch | ~0.6–0.8 GB (V8 high-water, bounded) | ~34 MB |

The in-process win comes from having no subprocess and no interpreter startup per file; the memory cost comes from the JavaScript runtime's heap management.