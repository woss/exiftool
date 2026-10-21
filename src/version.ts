import { createRequire } from 'node:module';

const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

/** Package version, sourced from package.json (single source of truth). */
export const VERSION: string = pkg.version;
