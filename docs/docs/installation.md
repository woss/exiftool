---
sidebar_position: 2
slug: /installation
---

# Installation

## Package Managers

### npm
```bash
npm install exiftool-ts
```

### pnpm
```bash
pnpm add exiftool-ts
```

### Yarn
```bash
yarn add exiftool-ts
```

### Bun
```bash
bun add exiftool-ts
```

## Requirements

- **Node.js 18+** (required for native fetch, crypto, and streams)
- TypeScript 5.6+ (for type definitions)
- No native dependencies or external binaries required

## Optional Dependencies

For browser usage, you may need to polyfill:
- `crypto` (Web Crypto API available in modern browsers)
- `stream` (available via `stream-browserify` if needed)

## Verifying Installation

```bash
# Check version
npx exiftool-ts --version

# Test with sample file
npx exiftool-ts -j sample.jpg
```

## Development Installation

```bash
# Clone and install
git clone https://github.com/woss/exiftool-ts.git
cd exiftool-ts
pnpm install

# Run tests
pnpm test

# Build
pnpm build
```