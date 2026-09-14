---
sidebar_position: 3
slug: /core/metadata-model
---

# Metadata Model

exiftool-ts normalizes tags across all formats into one flat record of
`TagValue`s, matching ExifTool's tag names and printed representations.

## Tag Record

`read()` returns a `FileInfo`:

```typescript
interface FileInfo {
  path: string;                     // Source path
  format: string;                   // Detected format ("JPEG", "DNG", …)
  tags: Record<string, TagValue>;   // Flat tag map, ExifTool naming
  errors?: string[];
  warnings?: string[];
}

type TagValue = string | number | boolean | Uint8Array | null | TagValue[];
```

There is no nested tag object and no `raw`/`groups` fields — one key per
tag, ExifTool's name (e.g. `ExposureTime`, `GPSLatitude`, `ImageSize`).

## Tag Groups

Groups exist for output formatting (CLI `-G[NUM]`, `-g[NUM]`) and are
resolved from the tag database's group families:

| Group | Standards | Description |
|-------|-----------|-------------|
| `EXIF` (IFD0, ExifIFD) | Exif 2.3+, TIFF/EP | Camera settings, image properties |
| `GPS` | GPS IFD | Geolocation data |
| `XMP` | XMP Core, IPTC Core, Dublin Core | Extensible metadata |
| `IPTC` | IIM, IPTC Core | News/photo agency metadata |
| `ICC` | ICC Profile | Color management |
| `JFIF` | JPEG File Interchange Format | JPEG stream header |
| `Composite` | Computed | Derived tags |
| `File` | File system | File properties |
| `MakerNotes` | Vendor-specific | Core 6 vendors decoded (Canon, Nikon, Sony, Olympus, Panasonic, Pentax); others keep markers |

With `-G1` the CLI prefixes tags (`EXIF:ExposureTime`, `Composite:Aperture`).
The library API returns unprefixed names.

## Value Representations

Values mirror what ExifTool prints — exiftool is the ground truth:

| Kind | Representation | Example |
|------|----------------|---------|
| Strings | plain `string` | `Make: "Canon"` |
| Numbers | `number` where ExifTool prints one | `FNumber: 2.8` |
| PrintConv'd enums | `string` | `Orientation: "Horizontal (normal)"` |
| Rationals/fractions | `string` | `ExposureTime: "1/125"` |
| Dates | ExifTool date `string` (`YYYY:MM:DD HH:MM:SS±HH:MM`) | `ModifyDate: "2024:09:17 21:46:07+02:00"` |
| GPS coordinates | DMS `string`, or decimal with `-c %.6f` | `45 deg 11' 15.24" N` |
| Arrays | `TagValue[]` | `Keywords: ["nature", "landscape"]` |
| Binary | `Uint8Array` (placeholder string in JSON unless `-b`) | `ThumbnailImage` |

## Composite Tags

Computed from multiple source tags (`computeCompositeTags`), same names
and values as ExifTool:

| Composite Tag | Sources |
|---------------|---------|
| `Aperture` | FNumber |
| `ShutterSpeed` | ExposureTime |
| `ImageSize` | ImageWidth, ImageLength/Height |
| `Megapixels` | ImageWidth, ImageHeight |
| `GPSPosition` | GPSLatitude, GPSLongitude |
| `LensID` / `Lens` | LensModel / makernote lookups (partial vendor coverage) |
| `SubSecCreateDate` | ModifyDate/OffsetTime/SubSecTime |
| `LightValue`, `DOF`, `HyperfocalDistance`, `FocalLength35efl` | exposure + focal geometry |

## Accessing Tags

```typescript
const result = await exiftool.read('photo.jpg');

result.format;                    // "JPEG"
result.tags['Make'];              // "Canon"
result.tags['ExposureTime'];      // "1/125"
result.tags['ImageSize'];         // "8256x5504"
Object.keys(result.tags);         // every tag name
```

Group-prefixed views are a CLI/output concern (`-G1 -j`), not part of
`FileInfo`.
