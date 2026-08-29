import { chmodSync } from 'node:fs';
import { defineConfig } from 'tsdown';

/** The generated tag DB stays a real JSON asset: node parses JSON natively,
 * which is cheaper than evaluating a multi-MB object literal inlined in JS. */
const TAGS_JSON = './tags/generated/tags.json';

const outExtensions = () => ({ js: '.js', dts: '.d.ts' }) as const;

export default defineConfig([
  {
    // Library: bundled ESM + bundled public-API declarations.
    entry: ['src/mod.ts'],
    format: 'esm',
    dts: true,
    publint: true,
    attw: { profile: 'node16' },
    external: [TAGS_JSON],
    outExtensions,
    copy: {
      from: 'src/tags/generated/tags.json',
      to: 'dist/tags/generated',
      flatten: true,
    },
  },
  {
    // CLI: single bundled file; the shebang in cli.ts is preserved.
    entry: ['src/cli.ts'],
    format: 'esm',
    platform: 'node',
    dts: false,
    outExtensions,
    external: [TAGS_JSON],
    hooks: {
      'build:done': () => {
        // Bundlers never set the exec bit npm's bin shim needs.
        if (process.platform !== 'win32') chmodSync('dist/cli.js', 0o755);
      },
    },
  },
]);
