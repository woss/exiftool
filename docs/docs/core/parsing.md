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
Format Parser (JPEG/PNG/TIFF/HEIF/QuickTime/WebP)
         │
         ▼
├── EXIF/TIFF Parser ──────► IFD Walking
├── XMP Parser ───────────► XML + RDF Parsing
├── IPTC Parser ──────────► Application Record Parsing
├── ICC Profile Parser ───► Tag Decoding
├── JUMBF/C2PA Parser ────► Box Walking + CBOR
└── MakerNotes ───────────► Vendor-specific Decoding
         │
         ▼
Composite Tag Computation
         │
         ▼
Output Normalization (JSON/CSV/Tabular)
```

## Streaming Design

- **Zero-copy**: Operates on `Uint8Array` views without copying
- **Incremental**: Parses as data arrives (no full file load required)
- **Lazy evaluation**: Only parses requested tag groups
- **Memory bounded**: Max memory = largest IFD/box + buffer

## Format Parsers

Each format has a dedicated parser in `src/format/`:

| Format | Parser | Key Features |
|--------|--------|--------------|
| JPEG | `jpeg.ts` | APP1/APP13/APP11 segments, JFIF, MPF |
| PNG | `png.ts` | iTXt/tEXt/zTXt, caBX for C2PA |
| TIFF | `tiff.ts` | BigTIFF, multi-IFD, sub-IFDs |
| HEIF | `heif.ts` | ISOBMFF boxes, Exif/TIFF in meta |
| WebP | `webp.ts` | VP8/VP8L, EXIF/XMP in VP8X |
| QuickTime | `quicktime.ts` | ISOBMFF atoms, meta box |
| PDF | `pdf.ts` | XMP streams, Info dict |

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