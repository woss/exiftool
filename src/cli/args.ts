export interface CliOptions {
  files: string[];
  json: boolean;
  xml: boolean;
  html: boolean;
  csv: boolean;
  binary: boolean;
  verbose: number;
  quiet: number;
  dateFormat?: string;
  coordFormat?: string;
  groupHeadings?: string;
  charset?: string;
  lang?: string;
  exclude: string[];
  extensions: string[];
  ignoreDirs: string[];
  recurse: boolean;
  outputFile?: string;
  overwriteOriginal: boolean;
  preserveFileDate: boolean;
  tagsFromFile?: string;
  conditions: string[];
  extractEmbedded: boolean;
  duplicates: boolean;
  missingTagValue?: string;
  listTags?: string;
  listFileTypes: boolean;
  listWritable: boolean;
  listGroups?: number;
  listRecognized: boolean;
  listDeletable: boolean;
  help: boolean;
  version: boolean;
  stayOpen: boolean;
  argfile?: string;
}

export function parseCliArgs(args: string[]): CliOptions {
  const opts: CliOptions = {
    files: [],
    json: false,
    xml: false,
    html: false,
    csv: false,
    binary: false,
    verbose: 0,
    quiet: 0,
    exclude: [],
    extensions: [],
    ignoreDirs: [],
    recurse: false,
    overwriteOriginal: false,
    preserveFileDate: false,
    conditions: [],
    extractEmbedded: false,
    duplicates: false,
    listFileTypes: false,
    listWritable: false,
    listRecognized: false,
    listDeletable: false,
    help: false,
    version: false,
    stayOpen: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (!arg.startsWith('-')) {
      opts.files.push(arg);
      i++;
      continue;
    }

    const lower = arg.toLowerCase();

    if (lower === '--' || lower === '\u2212\u2212') {
      opts.files.push(...args.slice(i + 1));
      break;
    }

    if (lower === '-h' || lower === '-help') {
      opts.help = true;
      i++;
      continue;
    }
    if (lower === '-ver' || lower === '-version') {
      opts.version = true;
      i++;
      continue;
    }
    if (lower === '-json' || lower === '-j') {
      opts.json = true;
      i++;
      continue;
    }
    if (lower === '-xml' || lower === '-x') {
      opts.xml = true;
      i++;
      continue;
    }
    if (lower === '-html' || lower === '-h') {
      opts.html = true;
      i++;
      continue;
    }
    if (lower === '-csv') {
      opts.csv = true;
      i++;
      continue;
    }
    if (lower === '-b' || lower === '-binary') {
      opts.binary = true;
      i++;
      continue;
    }
    if (lower === '-n') {
      opts.json = true;
      i++;
      continue;
    }
    if (lower === '-r' || lower === '-recurse') {
      opts.recurse = true;
      i++;
      continue;
    }
    if (lower === '-v') {
      opts.verbose++;
      i++;
      continue;
    }
    if (lower === '-q') {
      opts.quiet++;
      i++;
      continue;
    }
    if (lower === '-duplicates' || lower === '-a') {
      opts.duplicates = true;
      i++;
      continue;
    }
    if (lower === '-ee' || lower === '-extractembedded') {
      opts.extractEmbedded = true;
      i++;
      continue;
    }
    if (lower === '-overwrite_original') {
      opts.overwriteOriginal = true;
      i++;
      continue;
    }

    if (lower === '-d' || lower === '-dateformat') {
      opts.dateFormat = args[i + 1];
      i += 2;
      continue;
    }
    if (lower === '-c' || lower === '-coordformat') {
      opts.coordFormat = args[i + 1];
      i += 2;
      continue;
    }
    if (lower === '-charset') {
      opts.charset = args[i + 1];
      i += 2;
      continue;
    }
    if (lower === '-lang') {
      opts.lang = args[i + 1];
      i += 2;
      continue;
    }
    if (lower === '-o' || lower === '-out') {
      opts.outputFile = args[i + 1];
      i += 2;
      continue;
    }
    if (lower === '-if') {
      opts.conditions.push(args[i + 1]);
      i += 2;
      continue;
    }
    if (lower === '-tagsfromfile') {
      opts.tagsFromFile = args[i + 1];
      i += 2;
      continue;
    }

    if (lower.startsWith('-ext') || lower.startsWith('-extension')) {
      opts.extensions.push(args[i + 1]);
      i += 2;
      continue;
    }
    if (lower === '-i' || lower === '-ignore') {
      opts.ignoreDirs.push(args[i + 1]);
      i += 2;
      continue;
    }
    if (lower === '-x' || lower === '-exclude') {
      opts.exclude.push(args[i + 1]);
      i += 2;
      continue;
    }

    const listMatch = arg.match(/^-list([wfrdxg]?\d*)$/i);
    if (listMatch) {
      const type = listMatch[1]?.toLowerCase() ?? '';
      if (type === 'f') opts.listFileTypes = true;
      else if (type === 'w') opts.listWritable = true;
      else if (type === 'r') opts.listRecognized = true;
      else if (type === 'd') opts.listDeletable = true;
      else if (type.startsWith('g')) opts.listGroups = parseInt(type.slice(1)) || 0;
      else opts.listTags = type;
      i++;
      continue;
    }

    const gMatch = arg.match(/^-g(roupnames)?(?:(\d+))?$/i);
    if (gMatch) {
      opts.groupHeadings = gMatch[2] || '0';
      i++;
      continue;
    }

    if (lower === '-@') {
      opts.argfile = args[i + 1];
      i += 2;
      continue;
    }
    if (lower === '-stay_open') {
      opts.stayOpen = args[i + 1] === 'true';
      i += 2;
      continue;
    }
    if (lower === '-common_args') {
      i++;
      continue;
    }
    if (lower === '-execute') {
      i++;
      continue;
    }

    opts.files.push(arg);
    i++;
  }

  return opts;
}
