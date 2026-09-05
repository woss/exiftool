---
sidebar_position: 1
slug: /cli/usage
---

# CLI Reference

exiftool-ts CLI is designed for **ExifTool compatibility** with additional features for C2PA and modern workflows.

## Basic Usage

```bash
# Basic usage
exiftool-ts image.jpg

# Multiple files
exiftool-ts image1.jpg image2.png

# All supported files in directory
exiftool-ts -r /path/to/photos
```

## Output Formats

### JSON (ExifTool Compatible)
```bash
# Pretty JSON
exiftool-ts -j image.jpg

# Compact JSON
exiftool-ts -j -c image.jpg

# Specific tags as JSON
exiftool-ts -j -Title -Artist -Copyright image.jpg
```

### CSV
```bash
exiftool-ts -csv image.jpg
exiftool-ts -csv -r -Title -Artist /photos
```

### Tabular (Default)
```bash
exiftool-ts image.jpg
# Output:
# ExifToolVersion         : 13.55
# FileName                : image.jpg
# ImageWidth              : 4096
# ImageHeight             : 2160
# ...
```

### XML
```bash
exiftool-ts -X image.jpg
```

## Tag Selection

### Include Tags
```bash
# Single tag
exiftool-ts -Title image.jpg

# Multiple tags
exiftool-ts -Title -Artist -Copyright image.jpg

# All tags in group
exiftool-ts -EXIF:All image.jpg
exiftool-ts -XMP:All image.jpg
exiftool-ts -IPTC:All image.jpg
```

### Exclude Tags
```bash
# Exclude specific tags
exiftool-ts --Title --Artist image.jpg

# Exclude group
exiftool-ts --EXIF:All image.jpg
```

### Wildcards
```bash
# Prefix match
exiftool-ts -GPS* image.jpg
exiftool-ts -EXIF:GPS* image.jpg
```

## C2PA Specific Flags

```bash
# All C2PA tags
exiftool-ts -C2PA image.jpg

# Specific C2PA tags
exiftool-ts -Claim_generator -ActionsAction image.jpg

# Combined with other groups
exiftool-ts -EXIF:All -C2PA image.jpg
```

## Output Options

| Flag | Description |
|------|-------------|
| `-j` | JSON output (ExifTool compatible) |
| `-c` | Compact JSON (no whitespace) |
| `-X` | XML output |
| `-csv` | CSV output |
| `-t` | Tabular (default) |
| `-csv` | CSV format |
| `-g[n]` | Group names (0=none, 1=full, 2=short) |
| `-G[n]` | Group names prefix (0=none, 1=full, 2=short) |

## Date/Time Formatting

```bash
# Default: "2024:01:15 14:30:22"
exiftool-ts -DateTimeOriginal image.jpg

# Custom format
exiftool-ts -d "%Y-%m-%d %H:%M:%S" -DateTimeOriginal image.jpg

# ISO 8601
exiftool-ts -d "%Y-%m-%dT%H:%M:%S%z" -DateTimeOriginal image.jpg
```

## Filtering

```bash
# Only files with GPS
exiftool-ts -if "$GPSLatitude" -r /photos

# Only images with C2PA
exiftool-ts -if "$Claim_generator" -r /photos

# Complex conditions
exiftool-ts -if '$Make eq "Canon" and $ISO gt 400' -r /photos
```

## File Processing

```bash
# Recursive
exiftool-ts -r /photos

# Follow symlinks
exiftool-ts -r -follow /photos

# Preserve timestamps
exiftool-ts -P image.jpg

# Overwrite original
exiftool-ts -overwrite_original image.jpg

# Dry run
exiftool-ts -n image.jpg
```

## Configuration File

Create `.exiftool-ts.json` in project root or home:

```json
{
  "dateFormat": "%Y-%m-%d %H:%M:%S",
  "groupPrefix": 1,
  "dateFormat": "%Y-%m-%d %H:%M:%S%z",
  "binary": "base64",
  "dateFormat": "%Y-%m-%d %H:%M:%S",
  "groupPrefix": 1,
  "coordFormat": "%.6f",
  "escapeHTML": false
}
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | File not found |
| 3 | Invalid arguments |
| 4 | Parse error |
| 5 | Write error |

## Examples

### Extract All Metadata
```bash
exiftool-ts -j -G1 -a image.jpg
```

### Batch Rename by Date
```bash
exiftool-ts '-FileName<DateTimeOriginal' -d "%Y%m%d_%H%M%S%%-c.%%e" -r /photos
```

### Remove All Metadata
```bash
exiftool-ts -all= image.jpg
```

### Export Thumbnail
```bash
exiftool-ts -b -ThumbnailImage -w thumbnail_%f.jpg image.jpg
```

### C2PA Validation
```bash
exiftool-ts -j -C2PA -if '$Claim_generator' image.jpg
```