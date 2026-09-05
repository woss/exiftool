---
sidebar_position: 3
slug: /core/metadata-model
---

# Metadata Model

exiftool-ts uses a unified metadata model that normalizes tags across all formats and standards.

## Tag Structure

```typescript
interface Tag {
  id: string;           // Unique tag identifier (e.g., "EXIF:ExposureTime")
  group: string;        // Group name (EXIF, XMP, IPTC, GPS, etc.)
  name: string;         // Human-readable name (e.g., "ExposureTime")
  value: unknown;       // Normalized value
  type: string;         // Value type (string, number, rational, date, etc.)
  raw?: unknown;        // Original raw value before normalization
}
```

## Tag Groups

| Group | Standards | Description |
|-------|-----------|-------------|
| `EXIF` | Exif 2.3+, TIFF/EP | Camera settings, image properties |
| `GPS` | GPS IFD | Geolocation data |
| `XMP` | XMP Core, IPTC Core, Dublin Core | Extensible metadata |
| `IPTC` | IIM, IPTC Core | News/photo agency metadata |
| `ICC` | ICC Profile | Color management |
| `JFIF` | JPEG File Interchange Format | JPEG metadata |
| `C2PA` | C2PA 2.x | Content credentials |
| `MakerNotes` | Vendor-specific | Camera maker proprietary data |
| `File` | File system | File properties |
| `Composite` | Computed | Derived tags |

## Normalization Rules

### Dates/Times
```typescript
// Input: "2024:01:15 14:30:22"
// Output: Date object
// Display: "2024-01-15T14:30:22.000Z" (ISO 8601)
```

### GPS Coordinates
```typescript
// Input: Rational degrees/minutes/seconds + Ref
// Output: Decimal degrees (number)
GPSLatitude: 37.758403
GPSLongitude: -122.4194
```

### Rational Numbers
```typescript
// Input: {num: 1, den: 125}
// Output: 0.008 (number) or rational object based on context
```

### Arrays/Sequences
```typescript
// XMP Seq → Array
Keywords: ["nature", "landscape", "mountains"]

// XMP Alt → Object with lang
Description: { "x-default": "A beautiful landscape" }
```

### Binary Data
```typescript
// Input: Uint8Array
// Output: Buffer (base64 in JSON)
ThumbnailImage: <Buffer ff d8 ff e0 ...>
```

## Composite Tags

Computed from multiple source tags:

| Composite Tag | Sources |
|---------------|---------|
| `Aperture` | EXIF:FNumber |
| `FOV` | EXIF:FocalLength, EXIF:FocalLengthIn35mmFormat |
| `HyperfocalDistance` | EXIF:FNumber, EXIF:FocalLength |
| `LightValue` | EXIF:ExposureTime, EXIF:FNumber, EXIF:ISO |
| `GPSPosition` | GPS:GPSLatitude, GPS:GPSLongitude |
| `Megapixels` | EXIF:ImageWidth, EXIF:ImageHeight |

## Tag ID Format

```
[Group:]TagName
```

Examples:
- `EXIF:ExposureTime`
- `XMP:Title`
- `IPTC:ObjectName`
- `GPS:GPSLatitude`
- `C2PA:ActionsAction`
- `Composite:Aperture`

## Value Types

| Type | Examples |
|------|----------|
| `string` | "Canon", "EOS R5" |
| `number` | 125, 2.8, 100 |
| `rational` | `\{num: 1, den: 125\}` |
| `date` | Date object |
| `array` | `["tag1", "tag2"]` |
| `buffer` | Buffer/Uint8Array |
| `object` | `\{lang: "en", value: "..."\}` |
## Accessing Tags

```typescript
const result = await exiftool.read('photo.jpg');

// All tags (flat object)
console.log(result.tags);

// Specific tag
console.log(result.tags['EXIF:ExposureTime']);

// By group
console.log(result.groups.EXIF);
console.log(result.groups.GPS);
console.log(result.groups.C2PA);

// Raw values (before normalization)
console.log(result.rawTags);
```