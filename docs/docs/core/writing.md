---
sidebar_position: 2
slug: /core/writing
---

# Writing Metadata

exiftool supports writing metadata to all supported formats with full ExifTool compatibility.

## Basic Write

```typescript
import { ExifTool } from '@woss/exiftool';

const exiftool = new ExifTool();
await exiftool.write('input.jpg', 'output.jpg', {
  Title: 'My Photo',
  Artist: 'John Doe',
  Copyright: '© 2024 John Doe',
});
```

## Tag Groups

Tags are organized by group prefix:

```typescript
await exiftool.write('input.jpg', 'output.jpg', {
  // EXIF tags
  'EXIF:Title': 'Photo Title',
  'EXIF:Artist': 'Photographer',
  'EXIF:Copyright': '© 2024',

  // XMP tags
  'XMP:Title': 'Photo Title',
  'XMP:Creator': ['Photographer'],
  'XMP:Rights': '© 2024',

  // IPTC tags
  'IPTC:ObjectName': 'Photo Title',
  'IPTC:ByLine': 'Photographer',
  'IPTC:CopyrightNotice': '© 2024',

  // GPS tags
  'GPS:GPSLatitude': 37.7749,
  'GPS:GPSLongitude': -122.4194,
});
```

## Supported Types

| Type | Example | Notes |
|------|---------|-------|
| String | `'Hello'` | UTF-8 encoded |
| Number | `42` / `3.14` | Auto-converts to rational if needed |
| Date | `new Date()` | ISO 8601 format |
| Array | `['a', 'b']` | Seq/Bag/Alt by context |
| Buffer | `Buffer.from(...)` | Binary data |
| Rational | `{num: 1, den: 2}` | For GPS, exposure, etc. |

## Rational Numbers

```typescript
// GPS coordinates
'GPS:GPSLatitude': { num: 37, den: 1 },
'GPS:GPSLatitudeRef': 'N',

// Exposure
'EXIF:ExposureTime': { num: 1, den: 125 },
'EXIF:FNumber': { num: 28, den: 10 },  // f/2.8

// Focal length
'EXIF:FocalLength': { num: 50, den: 1 },  // 50mm
```

## Batch Writing

```typescript
const tags = {
  Title: 'Batch Photo',
  Artist: 'Batch Photographer',
  Copyright: '© 2024',
};

await exiftool.write('input1.jpg', 'output1.jpg', tags);
await exiftool.write('input2.jpg', 'output2.jpg', tags);
await exiftool.write('input3.jpg', 'output3.jpg', tags);
```

## In-Place Editing

```typescript
// Overwrite original (creates backup by default)
await exiftool.write('photo.jpg', 'photo.jpg', {
  Title: 'Updated Title',
});

// No backup
await exiftool.write('photo.jpg', 'photo.jpg', {
  Title: 'Updated Title',
}, { backup: false });
```

## Delete Tags

```typescript
// Delete specific tags
await exiftool.write('input.jpg', 'output.jpg', {
  'Title': null,
  'Artist': null,
});

// Delete all tags in group
await exiftool.write('input.jpg', 'output.jpg', {
  'EXIF:All': null,
  'XMP:All': null,
});

// Delete all metadata
await exiftool.write('input.jpg', 'output.jpg', {
  'All': null,
});
```

## Preserving Original Timestamps

```typescript
await exiftool.write('input.jpg', 'output.jpg', {
  Title: 'New Title',
}, {
  preserveTimestamps: true,
});
```

## Writing C2PA

```typescript
// Note: Full C2PA writing requires manifest creation
// Currently supports reading; writing API in development
const result = await exiftool.read('c2pa-image.jpg');
// C2PA tags are read-only in current version
```

## Validation

```typescript
const result = await exiftool.write('input.jpg', 'output.jpg', {
  Title: 'Test',
});

// result.success = true/false
// result.warnings = [] (non-fatal issues)
if (!result.success) {
  throw new Error(result.error);
}
```