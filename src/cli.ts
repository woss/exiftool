#!/usr/bin/env node
import { applyFileStat } from './cli/filestat.js';
import { lstat, mkdir, readFile, link, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { basename, dirname, extname, join, sep } from 'node:path';
import { normalizeArgs, parseCliArgs, type CliOptions } from './cli/args.js';
import { ExifTool } from './exiftool.js';
import { BUILTIN_PLUGINS } from './format/all.js';
import { formatJSON, formatCSV, formatTabular, formatXML } from './cli/output.js';
import type { FormatOptions } from './cli/output.js';
import { evalCondition } from './cli/filter.js';
import { verboseLines } from './cli/verbosity.js';
import { expandInputs } from './cli/glob.js';
import { readLines, stayOpenLoop } from './cli/stay-open.js';
import { extractEmbeddedJpegs } from './format/jpeg.js';
import { parseAPP13 } from './exif/app13.js';
import { parseJpegSegments } from './write/jpeg-merge.js';

export { normalizeArgs, parseCliArgs } from './cli/args.js';
export type { CliOptions } from './cli/args.js';

/**
 * Pre-wired ExifTool instance with all built-in plugins for CLI use.
 */
const tool = new ExifTool({ plugins: BUILTIN_PLUGINS });
const WRITE_ASSIGNMENT = /^-?([A-Za-z][A-Za-z0-9_-]*?(?::[A-Za-z][A-Za-z0-9_-]*?)?)([+-]?)=(.*)$/;
const IPTC_KEYWORDS_KEY = /^iptc:keywords$/i;
const OUTPUT_FORMAT_BY_EXTENSION: Record<string, string> = {
  avif: 'avif',
  gif: 'gif',
  heif: 'heif',
  heic: 'heif',
  jpeg: 'jpeg',
  jpe: 'jpeg',
  jpg: 'jpeg',
  pbm: 'pbm',
  pgm: 'pgm',
  png: 'png',
  ppm: 'ppm',
  tif: 'tiff',
  tiff: 'tiff',
  webp: 'webp',
  xmp: 'xmp',
};

function xmpListAppendGroup(key: string):
  | 'subject'
  | 'creator'
  | 'contributor'
  | 'publisher'
  | 'language'
  | 'relation'
  | 'type'
  | 'identifier'
  | 'date'
  | undefined {
  if (IPTC_KEYWORDS_KEY.test(key)) return undefined;
  const name = key.toLowerCase().split(':').at(-1);
  if (name === 'subject' || name === 'keywords') return 'subject';
  if (name === 'creator') return 'creator';
  if (name === 'contributor') return 'contributor';
  if (name === 'publisher') return 'publisher';
  if (name === 'language') return 'language';
  if (name === 'relation') return 'relation';
  if (name === 'type') return 'type';
  if (name === 'identifier') return 'identifier';
  if (name === 'date') return 'date';
  return undefined;
}

function outputFormatForPath(path: string): string | undefined {
  const extension = extname(path).slice(1).toLowerCase();
  return OUTPUT_FORMAT_BY_EXTENSION[extension];
}

function selectCopiedTags(
  tags: Record<string, import('./types.js').TagValue>,
  selectors: string[],
): Record<string, import('./types.js').TagValue> {
  if (selectors.length === 0) return tags;
  const parsed = selectors.flatMap((selector) => {
    const match = selector.match(/^(-{1,2})(.+)$/);
    if (!match) return [];
    const requestedName = match[2]!.toLowerCase();
    return [{ name: requestedName === 'all' ? '*' : requestedName, exclude: match[1] === '--' }];
  });
  const includes = parsed.filter((selector) => !selector.exclude);
  const excludes = parsed.filter((selector) => selector.exclude);
  const matches = (key: string, name: string) => {
    const lowerKey = key.toLowerCase();
    const lowerName = name.toLowerCase();
    const candidate = lowerName.includes(':') ? lowerKey : lowerKey.split(':').at(-1)!;
    const pattern = lowerName.replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replaceAll('*', '.*')
      .replaceAll('?', '.');
    return new RegExp(`^${pattern}$`).test(candidate);
  };
  return Object.fromEntries(Object.entries(tags).filter(([key]) => {
    return (includes.length === 0 || includes.some(({ name }) => matches(key, name))) &&
      !excludes.some(({ name }) => matches(key, name));
  }));
}

function findCopiedTagValue(
  tags: Record<string, import('./types.js').TagValue>,
  name: string,
): import('./types.js').TagValue | undefined {
  const normalized = name.toLowerCase();
  const key = Object.keys(tags).find((candidate) => {
    const lower = candidate.toLowerCase();
    return normalized.includes(':')
      ? lower === normalized
      : lower.split(':').at(-1) === normalized;
  });
  return key === undefined ? undefined : tags[key];
}

function expandWriteOutputTemplate(template: string, input: string): string {
  const filename = basename(input);
  const extension = extname(filename);
  const stem = extension ? filename.slice(0, -extension.length) : filename;
  const sourceDir = dirname(input);
  const directory = sourceDir === '.' ? '' : sourceDir.replace(/[\\/]+$/, '');
  const directoryWithSeparator = directory
    ? `${directory}${sep}`
    : sourceDir === sep
      ? sep
      : '';
  const values: Record<string, string> = {
    d: directoryWithSeparator,
    D: directory,
    f: stem,
    F: filename,
    e: extension.startsWith('.') ? extension.slice(1) : extension,
    E: extension,
  };
  return template.replace(/%([dDfFeE])/g, (_, token: string) => values[token]!);
}

async function resolveWriteOutputPath(template: string, input: string): Promise<string> {
  const expanded = expandWriteOutputTemplate(template, input);
  const lowerCounterToken = /%([-+]?)(\d*)c/g;
  const upperCounterToken = /%(\d*)C/g;
  if (!/%([-+]?)(\d*)c|%(\d*)C/.test(template)) return expanded;
  for (let counter = 0; ; counter++) {
    lowerCounterToken.lastIndex = 0;
    upperCounterToken.lastIndex = 0;
    const lowerExpanded = expanded.replace(lowerCounterToken, (_token, sign: string, widthText: string) => {
      if (counter === 0) return '';
      const separator = sign === '+' ? '_' : sign === '-' ? '-' : '';
      const width = Number(widthText);
      const number = width > 0 ? String(counter).padStart(width, '0') : String(counter);
      return `${separator}${number}`;
    });
    const candidate = lowerExpanded.replace(upperCounterToken, (_token, widthText: string) =>
      String(counter).padStart(Number(widthText) || 0, '0'));
    try {
      await lstat(candidate);
    } catch {
      return candidate;
    }
  }
}

async function readIptcKeywords(file: string): Promise<string[]> {
  const bytes = new Uint8Array(await readFile(file));
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return [];
  const values: string[] = [];
  for (const segment of parseJpegSegments(bytes)) {
    if (segment.marker !== 0xed) continue;
    const payload = bytes.subarray(segment.payloadStart, segment.payloadEnd);
    if (new TextDecoder().decode(payload.subarray(0, 14)) !== 'Photoshop 3.0\0') continue;
    const keywords = parseAPP13(payload.subarray(14)).Keywords;
    if (typeof keywords === 'string') values.push(keywords);
    else if (Array.isArray(keywords)) {
      values.push(...keywords.filter((keyword): keyword is string => typeof keyword === 'string'));
    }
  }
  return values;
}


/**
 * Runs a single CLI action (read or write) with the given options and files.
 * This is the core logic used by both `main()` and the `-stay_open` daemon.
 *
 * @param options - Parsed CLI options
 * @param files - File paths or tag assignments (TAG=VALUE)
 * @returns Exit code (0 = success, 1 = failure)
 */
export async function runAction(options: CliOptions, ...files: string[]): Promise<number> {
  const quietCount: number = options.quiet?.length ?? 0;
  const verboseCount: number = options.verbose?.length ?? 0;
  const coordFormat: string | undefined = options.coordFormat;
  const failures: string[] = [];

  // Write mode: any TAG=VALUE or supported TAG+=VALUE operand is an update.
  const assignments = files.flatMap((operand) => {
    const match = WRITE_ASSIGNMENT.exec(operand);
    return match
      ? [{
        operand,
        key: match[1]!,
        append: match[2] === '+',
        remove: match[2] === '-',
        value: match[3]!,
      }]
      : [];
  });
  if (assignments.length > 0 || options.tagsFromFile !== undefined) {
    const sourceRequests = options.tagsFromFile === undefined
      ? []
      : options.tagsFromFileRequests ??
        (Array.isArray(options.tagsFromFile)
          ? options.tagsFromFile.map((source) => ({ source, selectors: [], mappings: [] }))
          : [{ source: options.tagsFromFile, selectors: [], mappings: [] }]);
    const selectRequestTags = (
      parsedTags: Record<string, import('./types.js').TagValue>,
      request: (typeof sourceRequests)[number],
    ) => {
      const selectors = request.selectors.length > 0
        ? request.selectors
        : options.tagsFromFileRequests === undefined
          ? copySelectors.map(({ name, exclude }) => `${exclude ? '--' : '-'}${name}`)
          : [];
      const selectedTags = selectors.length > 0
        ? selectCopiedTags(parsedTags, selectors)
        : request.mappings.length > 0
          ? {}
          : parsedTags;
      const mappedTags = { ...selectedTags };
      for (const mapping of request.mappings) {
        const value = findCopiedTagValue(parsedTags, mapping.source);
        if (value !== undefined) mappedTags[mapping.destination] = value;
      }
      return mappedTags;
    };
    const sourceTagSets: {
      request: (typeof sourceRequests)[number];
      tags?: Record<string, import('./types.js').TagValue>;
    }[] = [];
    const copySelectors = options.tagsFromFile === undefined
      ? []
      : files.flatMap((operand) => {
        if (assignments.some((assignment) => assignment.operand === operand)) return [];
        const match = operand.match(/^(-{1,2})([A-Za-z][A-Za-z0-9_-]*(?::[A-Za-z][A-Za-z0-9_-]*)?)$/);
        return match ? [{ operand, name: match[2]!, exclude: match[1] === '--' }] : [];
      });
    if (options.tagsFromFile !== undefined) {
      for (const request of sourceRequests) {
        const { source: sourceFile } = request;
        if (sourceFile === '@') {
          sourceTagSets.push({ request });
          continue;
        }
        try {
          const parsedTags = (await tool.read(sourceFile)).tags;
          sourceTagSets.push({ request, tags: selectRequestTags(parsedTags, request) });
        } catch (e) {
          console.error(`Error reading tags from ${sourceFile}: ${(e as Error).message}`);
          return 1;
        }
      }
    }
    const sourceOperands = new Set(copySelectors.map(({ operand }) => operand));
    const paths = files.filter((file) =>
      !assignments.some((assignment) => assignment.operand === file) && !sourceOperands.has(file));
    const explicitNames = new Set(assignments.map((assignment) => {
      const parts = assignment.key.split(':');
      return parts[parts.length - 1]!.toLowerCase();
    }));
    const expandedWrite = await expandInputs(paths, {
      recurse: options.recurse === true,
      extensions: options.extension ?? [],
      ignoreDirs: options.ignore ?? [],
    });
    let outputIsDirectory = false;
    if (options.output !== undefined && options.output !== '-') {
      outputIsDirectory = /[\\/]$/.test(options.output);
      try {
        outputIsDirectory ||= (await stat(options.output)).isDirectory();
      } catch {
        // A non-existent output path is treated as a file destination.
      }
    }
    const outputUsesTemplate = options.output !== undefined &&
      (/%[dDfFeE]/.test(options.output) || /%[-+]?\d*[cC]/.test(options.output));
    if (
      options.output !== undefined && options.output !== '-' && !outputIsDirectory &&
      !outputUsesTemplate && expandedWrite.length > 1
    ) {
      console.error('-o currently supports one input file for metadata writes');
      return 1;
    }
    let updated = 0;
    let failedCondition = 0;
    for (const file of expandedWrite) {
      try {
        let targetTags: Record<string, import('./types.js').TagValue> | undefined;
        let targetFormat: string | undefined;
        const hasSelfSource = sourceTagSets.some(({ request }) => request.source === '@');
        if (
          assignments.some((assignment) => assignment.append || assignment.remove) || options.if !== undefined ||
          hasSelfSource
        ) {
          const targetInfo = await tool.read(file);
          targetTags = targetInfo.tags;
          targetFormat = targetInfo.format;
        }
        const tags: Record<string, import('./types.js').TagValue> = {};
        for (const sourceTagSet of sourceTagSets) {
          Object.assign(
            tags,
            sourceTagSet.tags ?? selectRequestTags(targetTags ?? {}, sourceTagSet.request),
          );
        }
        if (options.if !== undefined && !options.if.every((condition) => evalCondition(condition, targetTags ?? {}))) {
          failedCondition++;
          continue;
        }
        for (const assignment of assignments) {
          const value = assignment.value.length === 0 ? null : assignment.value;
          if (!assignment.append && !assignment.remove) {
            tags[assignment.key] = value;
            continue;
          }
          if (typeof value !== 'string') {
            throw new Error(`${assignment.remove ? '-=' : '+='} requires a string value for ${assignment.key}`);
          }
          const xmpListGroup = xmpListAppendGroup(assignment.key);
          if (xmpListGroup) {
            const belongsToList = (key: string) => xmpListAppendGroup(key) === xmpListGroup;
            const existing = Object.entries(tags).find(([key]) => belongsToList(key))?.[1] ??
              Object.entries(targetTags ?? {}).find(([key]) => belongsToList(key))?.[1];
            const values = typeof existing === 'string'
              ? [existing]
              : Array.isArray(existing)
                ? existing.filter((item): item is string => typeof item === 'string')
                : [];
            if (assignment.remove) {
              const index = values.indexOf(value);
              if (index === -1) continue;
              values.splice(index, 1);
              tags[assignment.key] = values.length > 0 ? values : null;
              continue;
            }
            for (const key of Object.keys(tags)) {
              if (belongsToList(key)) delete tags[key];
            }
            tags[assignment.key] = [...values, value];
            continue;
          }
          if (IPTC_KEYWORDS_KEY.test(assignment.key)) {
            if (assignment.remove) continue;
            const existing = Object.entries(tags).find(([key]) => IPTC_KEYWORDS_KEY.test(key))?.[1] ??
              await readIptcKeywords(file);
            const values = typeof existing === 'string'
              ? [existing]
              : Array.isArray(existing)
                ? existing.filter((item): item is string => typeof item === 'string')
                : [];
            tags[assignment.key] = [...values, value];
            continue;
          }
          throw new Error(
            `${assignment.remove ? '-=' : '+='} is currently supported only for XMP list properties and JPEG IPTC:Keywords, not ${assignment.key}`,
          );
        }
        if (Object.keys(tags).length === 0) continue;
        let tempOutput: string | undefined;
        let result;
        try {
          if (options.output === undefined) {
            result = await tool.write(file, tags, {
              overwriteOriginal: options.overwriteOriginal === true,
              preserveTime: options.preserveTime === true,
              compress: options.compress === true,
              writeMode: options.writeMode,
            });
          } else {
            if (outputIsDirectory) await mkdir(options.output, { recursive: true });
            const stdoutOutput = options.output === '-';
            const destination = stdoutOutput
              ? file
              : outputIsDirectory
              ? join(options.output, basename(file))
              : outputUsesTemplate
                ? await resolveWriteOutputPath(options.output, file)
                : options.output;
            const destinationFormat = outputFormatForPath(destination);
            if (destinationFormat !== undefined) {
              targetFormat ??= (await tool.read(file)).format;
              if (targetFormat.toLowerCase() !== destinationFormat) {
                throw new Error(`cannot convert ${targetFormat} to ${destinationFormat.toUpperCase()} with -o`);
              }
            }
            if (!stdoutOutput) await mkdir(dirname(destination), { recursive: true });
            const sourceStat = options.preserveTime ? await stat(file) : undefined;
            tempOutput = `${destination}.tmp-${randomUUID()}`;
            await writeFile(tempOutput, await readFile(file), { flag: 'wx' });
            if (sourceStat) await utimes(tempOutput, sourceStat.atime, sourceStat.mtime);
            result = await tool.write(tempOutput, tags, {
              overwriteOriginal: true,
              preserveTime: options.preserveTime === true,
              compress: options.compress === true,
              writeMode: options.writeMode,
            });
            const completedOutput = tempOutput;
            if (stdoutOutput) {
              const outputBytes = await readFile(completedOutput);
              await new Promise<void>((resolve, reject) => {
                process.stdout.write(outputBytes, (error) => error ? reject(error) : resolve());
              });
            } else {
              await link(completedOutput, destination);
            }
            tempOutput = undefined;
            await rm(completedOutput, { force: true }).catch(() => {});
          }
        } finally {
          if (tempOutput !== undefined) await rm(tempOutput, { force: true });
        }
        const rejected = result.skipped.filter((key) =>
          explicitNames.has(key.split(':').at(-1)!.toLowerCase()));
        if (rejected.length > 0) {
          failures.push(`Error writing ${file}: unsupported tag(s): ${rejected.join(', ')}`);
        }
        if (result.written.length > 0) updated++;
      } catch (e) {
        failures.push(`Error writing ${file}: ${(e as Error).message}`);
      }
    }
    if (updated > 0 && quietCount < 1 && options.output !== '-') console.log(`${updated} image files updated`);
    if (failedCondition > 0 && quietCount < 1) console.error(`${failedCondition} files failed condition`);
    if (quietCount < 1) {
      for (const line of failures) console.error(line);
    }
    return failures.length > 0 ? 1 : 0;
  }

  const readSelectors = files.filter((operand) =>
    /^-{1,2}[A-Za-z][A-Za-z0-9_*-]*(?:\?[A-Za-z0-9_*-]*)?(?::[A-Za-z][A-Za-z0-9_*-]*(?:\?[A-Za-z0-9_*-]*)?)?$/.test(operand));
  const selectorOperands = new Set(readSelectors);
  const expanded = await expandInputs(files.filter((file) => !selectorOperands.has(file)), {
    recurse: options.recurse === true,
    extensions: options.extension ?? [],
    ignoreDirs: options.ignore ?? [],
  });

  const results = [];
  for (const file of expanded) {
    try {
      const info = await tool.read(file, coordFormat ? { coordFormat } : undefined);
      await applyFileStat(info.tags, file);
      results.push(info);
      if (options.extractEmbedded === true && info.format === 'JPEG') {
        // The file was just read successfully; a re-read failure here is
        // handled by the same per-file catch below.
        const bytes = await readFile(file);
        for (const doc of extractEmbeddedJpegs(bytes)) {
          // info.format === 'JPEG' implies the JPEG plugin is in the resolved set.
          results.push(await tool.getParser('JPEG')!.parse(doc, file, tool.tagDb));
        }
      }
    } catch (e) {
      failures.push(`Error reading ${file}: ${(e as Error).message}`);
    }
  }

  let kept = results;
  if (options.if !== undefined) {
    const exprs: string[] = options.if;
    kept = results.filter((info) => exprs.every((expr) => evalCondition(expr, info.tags)));
    const failed = results.length - kept.length;
    if (failed > 0 && quietCount < 1) {
      console.error(`${failed} files failed condition`);
    }
  }
  if (readSelectors.length > 0) {
    kept = kept.map((info) => ({
      ...info,
      tags: selectCopiedTags(info.tags, readSelectors),
    }));
  }

  const reportFailures = () => {
    if (quietCount < 1) {
      for (const line of failures) console.error(line);
    }
  };

  if (verboseCount >= 1 && quietCount < 1) {
    for (const info of kept) {
      for (const line of verboseLines(info, verboseCount)) {
        console.error(line);
      }
    }
  }

  const fmtOpts: FormatOptions = {};
  if (options.groupHeadings) {
    fmtOpts.groupHeadings = options.groupHeadings as string;
    fmtOpts.tagDb = tool.tagDb;
  }
  if (options.groupPrefix) {
    fmtOpts.groupPrefix = options.groupPrefix as string;
    fmtOpts.tagDb = tool.tagDb;
  }
  if (options.dateFormat) {
    fmtOpts.dateFormat = options.dateFormat as string;
  }

  if (options.binary && !options.json) {
    // Known limitation: with multiple files/tags, all Uint8Array values are
    // concatenated to stdout without separators and without per-tag selection.
    let foundBinary = false;
    for (const file of kept) {
      for (const value of Object.values(file.tags)) {
        if (value instanceof Uint8Array && value.length > 0) {
          process.stdout.write(value);
          foundBinary = true;
        }
      }
    }
    reportFailures();
    if (!foundBinary) {
      console.error('No binary tags found.');
      return 1;
    }
    return failures.length > 0 ? 1 : 0;
  }
  if (options.binary && options.json) {
    // JSON output with binary data: hand Uint8Array values to the JSON formatter.
    fmtOpts.binary = true;
  }

  let text: string;
  if (options.json) {
    text = formatJSON(kept, fmtOpts);
  } else if (options.xml) {
    text = formatXML(kept, fmtOpts);
  } else if (options.csv) {
    text = formatCSV(kept, fmtOpts);
  } else {
    text = formatTabular(kept, fmtOpts);
  }
  if (options.output !== undefined) {
    if (options.output === '-') {
      console.log(text);
    } else {
      try {
        await writeFile(options.output, text);
      } catch (e) {
        console.error(`Error writing ${options.output}: ${(e as Error).message}`);
        return 1;
      }
    }
  } else {
    console.log(text);
  }
  reportFailures();
  return failures.length > 0 ? 1 : 0;
}

/**
 * Process entry: routes to the `-stay_open` daemon or a one-shot run and
 * yields the process exit code. `input` is injectable for tests.
 */
export async function main(
  options: CliOptions,
  files: string[],
  input: AsyncIterable<Uint8Array> = process.stdin,
): Promise<number> {
  if (options.help) {
    tool.printHelp();
    return 0;
  }
  if (options.version) {
    console.log('0.1.0');
    return 0;
  }
  const wantsDaemon = options.stayOpen !== undefined &&
    options.stayOpen !== false &&
    options.stayOpen !== 'False';
  if (!wantsDaemon) return runAction(options, ...files);

  let lastCode = 0;
  const loop = await stayOpenLoop(
    readLines(input),
    async (args) => {
      lastCode = await runAction(options, ...args);
      return lastCode;
    },
    (text) => console.log(text),
  );
  return loop.shutdownRequested ? lastCode : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const { options, files } = parseCliArgs(normalizeArgs(process.argv.slice(2)));
    const code = await main(options, files);
    if (code !== 0) process.exitCode = code;
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  }
}
