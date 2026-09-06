import { chmodSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'tsdown';

/** Kept external in every bundle: node parses JSON natively, which is
 * cheaper than evaluating a multi-MB object literal inlined in JS. */
const TAGS_JSON = /tags\.json$/;
const outExtensions = () => ({ js: '.js', dts: '.d.ts' }) as const;

export default defineConfig([
  {
    // Library: per-module ESM + declarations. Unbundle keeps module
    // boundaries visible to consumer bundlers (the parser registry in
    // format/* is a deliberate side effect, so real tree-shaking is
    // limited either way -- see exiftool.ts's bare format imports).
    entry: ['src/mod.ts', 'src/plugins.ts'],
    platform: 'node',
    unbundle: true,
    dts: true,
    publint: true,
    attw: {
      profile: 'node16',
      // ESM-only package by design ("type": "module"); node16-cjs require()
      // is intentionally unsupported — CJS consumers must use dynamic
      // import(), which works fine against these exports.
      ignoreRules: ['cjs-resolves-to-esm'],
    },
    deps: { neverBundle: [TAGS_JSON] },
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
    dts: true,
    deps: { neverBundle: [TAGS_JSON] },
    codeSplitting: false,
    outExtensions,
    hooks: {
      'build:done': () => {
        // Bundlers never set the exec bit npm's bin shim needs.
        if (process.platform !== 'win32') chmodSync('dist/cli.js', 0o755);
      },
    },
  },
  {
    // Browser: platform-free core bundled as dist/browser.js. The JSON tag
    // DB is inlined (consumer bundlers inline it anyway); the build fails
    // if any Node builtin leaks into the bundle.
    entry: ['src/browser.ts'],
    format: 'esm',
    platform: 'browser',
    dts: true,
    outExtensions,
    hooks: {
      'build:done': () => {
        // Hashed chunks belong to this build; the lib build emits only
        // plain-named files and the CLI build is a single inline bundle.
        const files = readdirSync('dist').filter(
          (f) => f === 'browser.js' || /-[A-Za-z0-9_-]{8}\.js$/.test(f),
        );
        for (const f of files) {
          if (/\bfrom\s+["']node:/.test(readFileSync(join('dist', f), 'utf8'))) {
            throw new Error(`browser bundle leaked a node: import: ${f}`);
          }
        }
      },
    },
  },
 ]);
