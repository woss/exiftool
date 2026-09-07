---
sidebar_position: 1
slug: /getting-started
---

# Getting Started

exiftool-ts is a TypeScript implementation of ExifTool for reading and writing metadata in image files. It provides typed, dependency-free parsing with output verified against the real ExifTool binary; see the [parity page](/parity) for exactly what matches and what doesn't.

## Installation

```bash
# npm
npm install exiftool-ts

# pnpm
pnpm add exiftool-ts

# yarn
yarn add exiftool-ts
```

## Quick Start

### Reading Metadata

```typescript
import { ExifTool } from '@woss/exiftool';

const exiftool = new ExifTool();
const result = await exiftool.read('photo.jpg');

console.log(result.tags.Make);      // "Canon"
console.log(result.tags.Model);     // "EOS R5"
console.log(result.tags.DateTimeOriginal); // "2024:01:15 14:30:22"
```

### Writing Metadata

```typescript
import { ExifTool } from '@woss/exiftool';

const exiftool = new ExifTool();
await exiftool.write('input.jpg', 'output.jpg', {
  Title: 'My Photo',
  Artist: 'John Doe',
  Copyright: '© 2024 John Doe',
});
```

### C2PA Content Credentials

```typescript
import { ExifTool } from '@woss/exiftool';

const exiftool = new ExifTool();
const result = await exiftool.read('c2pa-image.jpg');

console.log(result.tags.Claim_generator);           // "Adobe Photoshop/25.5.1..."
console.log(result.tags.ActionsAction);             // "c2pa.edited"
console.log(result.tags.Claim_Generator_InfoName);  // "Adobe Photoshop"
console.log(result.tags.ActionsSoftwareAgent);      // "Adobe Firefly"
```

## CLI Usage

```bash
# Basic usage
npx exiftool-ts image.jpg

# JSON output (ExifTool compatible)
npx exiftool-ts -j image.jpg

# Specific tags
npx exiftool-ts -Title -Artist -Copyright image.jpg

# C2PA specific
npx exiftool-ts -C2PA image.jpg
```

## Next Steps

- [Installation Guide](/installation) - Detailed installation options
- [Core Concepts](/core/parsing) - Understanding the parsing architecture
- [C2PA Guide](/c2pa/overview) - Working with Content Credentials
- [CLI Reference](/cli/usage) - Complete CLI documentation