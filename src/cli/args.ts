/**
 * ExifTool-style command-line parsing.
 *
 * `parseCliArgs` consumes tokens already normalized by `normalizeArgs`
 * (ExifTool single-dash long forms mapped onto `--long`). Unknown dash-tokens
 * fall through as operands so `-TAG=VALUE` write assignments reach runAction
 * untouched, mirroring the real ExifTool CLI.
 */

export interface CliOptions {
  json?: boolean;
  csv?: boolean;
  xml?: boolean;
  binary?: boolean;
  dateFormat?: string;
  groupHeadings?: string | boolean;
  groupPrefix?: string | boolean;
  coordFormat?: string;
  if?: string[];
  verbose?: unknown[];
  quiet?: unknown[];
  recurse?: boolean;
  extension?: string[];
  ignore?: string[];
  output?: string;
  extractEmbedded?: boolean;
  overwriteOriginal?: boolean;
  stayOpen?: string | boolean;
  version?: boolean;
}

/** How many values an option consumes; `collect` repeats into an array. */
interface OptionSpec {
  arity: 'flag' | 'value' | 'optional';
  collect?: boolean;
}

const SPECS: Record<string, OptionSpec> = {
  json: { arity: 'flag' },
  csv: { arity: 'flag' },
  binary: { arity: 'flag' },
  'date-format': { arity: 'value' },
  'group-headings': { arity: 'value' },
  'group-prefix': { arity: 'value' },
  'coord-format': { arity: 'value' },
  if: { arity: 'value', collect: true },
  verbose: { arity: 'flag', collect: true },
  quiet: { arity: 'flag', collect: true },
  xml: { arity: 'flag' },
  output: { arity: 'value' },
  recurse: { arity: 'flag' },
  extension: { arity: 'value', collect: true },
  ignore: { arity: 'value', collect: true },
  'extract-embedded': { arity: 'flag' },
  'overwrite-original': { arity: 'flag' },
  'stay-open': { arity: 'optional' },
  version: { arity: 'flag' },
};

/** Single-character short flags (multi-char shorts are pre-normalized). */
const SHORTS: Record<string, string> = {
  b: 'binary',
  d: 'date-format',
  g: 'group-headings',
  G: 'group-prefix',
  c: 'coord-format',
  j: 'json',
  v: 'verbose',
  q: 'quiet',
  X: 'xml',
  o: 'output',
  r: 'recurse',
  i: 'ignore',
};

function camelize(name: string): string {
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function parseCliArgs(argv: string[]): { options: CliOptions; files: string[] } {
  const options: CliOptions = {};
  const files: string[] = [];
  const set = (name: string, value: unknown) => {
    const key = camelize(name);
    if (SPECS[name]!.collect) {
      const bucket = (options as Record<string, unknown[]>)[key] ?? [];
      bucket.push(value);
      (options as Record<string, unknown[]>)[key] = bucket;
    } else {
      (options as Record<string, unknown>)[key] = value;
    }
  };
  const long = (token: string): string | undefined => {
    if (!token.startsWith('--')) return undefined;
    const name = token.slice(2).split('=', 1)[0]!;
    return name in SPECS ? name : undefined;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--') {
      files.push(...argv.slice(i + 1));
      break;
    }
    const name = !arg.startsWith('-')
      ? undefined // plain operands (file paths, TAG=VALUE) are never options
      : arg.startsWith('--')
        ? long(arg)
        : SHORTS[arg.slice(1, 2)];
    if (!name) {
      // Unknown dash-token: operand (e.g. -TAG=VALUE write assignments).
      files.push(arg);
      continue;
    }
    const spec = SPECS[name]!;
    const inline = arg.startsWith('--') && arg.includes('=') ? arg.split('=', 2)[1] : undefined;
    if (spec.arity === 'flag') {
      if (inline !== undefined) throw new Error(`Option --${name} does not take a value`);
      set(name, true);
      continue;
    }
    let value: string | undefined = inline;
    if (value === undefined) {
      const next = argv[i + 1];
      if (spec.arity === 'value') {
        if (next === undefined) throw new Error(`Option --${name} requires a value`);
        value = next;
        i++;
      } else if (next !== undefined && !next.startsWith('-')) {
        value = next;
        i++;
      } else {
        value = undefined;
      }
    }
    set(name, spec.arity === 'optional' && value === undefined ? true : value);
  }
  return { options, files };
}

export function normalizeArgs(args: string[]): string[] {
  return args.flatMap((a) => {
    // TAG=VALUE write assignments pass through as operands
    if (/^-?[A-Za-z][A-Za-z0-9_]*=/.test(a)) return [a];
    if (a === '-overwrite_original' || a === '--overwrite_original') {
      return ['--overwrite-original'];
    }
    if (a === '--ee') return ['--extract-embedded'];
    if (a.startsWith('-') && !a.startsWith('--') && a.length > 2) {
      if (a === '-ver') return ['--version'];
      if (a === '-stay_open' || a === '--stay_open') return ['--stay-open'];
      // -ext maps to the long-only --extension option
      if (a === '-ext') return ['--extension'];
      // -ee maps to the long-only --extract-embedded option
      if (a === '-ee') return ['--extract-embedded'];
      if (/^-[gG]\d$/.test(a)) return [a.slice(0, 2), a.slice(2)];
      return ['--' + a.slice(1)];
    }
    if (a === '-g') return ['--group-headings', '0'];
    if (a === '-G') return ['--group-prefix', '1'];
    return [a];
  });
}
