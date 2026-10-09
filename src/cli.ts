#!/usr/bin/env node
import { applyFileStat } from './cli/filestat.js';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
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
const WRITE_ASSIGNMENT = /^-?([A-Za-z][A-Za-z0-9_-]*(?::[A-Za-z][A-Za-z0-9_-]*)?)(\+?)=(.*)$/;
const IPTC_KEYWORDS_KEY = /^iptc:keywords$/i;

function xmpListAppendGroup(key: string): 'subject' | 'creator' | undefined {
  const name = key.toLowerCase().split(':').at(-1);
  if (name === 'subject' || name === 'keywords') return 'subject';
  if (name === 'creator') return 'creator';
  return undefined;
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
      ? [{ operand, key: match[1]!, append: match[2] === '+', value: match[3]! }]
      : [];
  });
  if (assignments.length > 0 || options.tagsFromFile !== undefined) {
    const sourceTags: Record<string, import('./types.js').TagValue> = {};
    if (options.tagsFromFile !== undefined) {
      try {
        Object.assign(sourceTags, (await tool.read(options.tagsFromFile)).tags);
      } catch (e) {
        console.error(`Error reading tags from ${options.tagsFromFile}: ${(e as Error).message}`);
        return 1;
      }
    }
    const paths = files.filter((file) => !assignments.some((assignment) => assignment.operand === file));
    const explicitNames = new Set(assignments.map((assignment) => {
      const parts = assignment.key.split(':');
      return parts[parts.length - 1]!.toLowerCase();
    }));
    const expandedWrite = await expandInputs(paths, {
      recurse: options.recurse === true,
      extensions: options.extension ?? [],
      ignoreDirs: options.ignore ?? [],
    });
    let updated = 0;
    let failedCondition = 0;
    for (const file of expandedWrite) {
      try {
        const tags: Record<string, import('./types.js').TagValue> = { ...sourceTags };
        let targetTags: Record<string, import('./types.js').TagValue> | undefined;
        if (assignments.some((assignment) => assignment.append) || options.if !== undefined) {
          targetTags = (await tool.read(file)).tags;
        }
        if (options.if !== undefined && !options.if.every((condition) => evalCondition(condition, targetTags ?? {}))) {
          failedCondition++;
          continue;
        }
        for (const assignment of assignments) {
          const value = assignment.value.length === 0 ? null : assignment.value;
          if (!assignment.append) {
            tags[assignment.key] = value;
            continue;
          }
          if (typeof value !== 'string') {
            throw new Error(`+= requires a string value for ${assignment.key}`);
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
            for (const key of Object.keys(tags)) {
              if (belongsToList(key)) delete tags[key];
            }
            tags[assignment.key] = [...values, value];
            continue;
          }
          if (IPTC_KEYWORDS_KEY.test(assignment.key)) {
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
            `+= is currently supported only for XMP Subject/Keywords/Creator and JPEG IPTC:Keywords, not ${assignment.key}`,
          );
        }
        const result = await tool.write(file, tags, {
          overwriteOriginal: options.overwriteOriginal === true,
          preserveTime: options.preserveTime === true,
          compress: options.compress === true,
          writeMode: options.writeMode,
        });
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
    if (updated > 0 && quietCount < 1) console.log(`${updated} image files updated`);
    if (failedCondition > 0 && quietCount < 1) console.error(`${failedCondition} files failed condition`);
    for (const line of failures) console.error(line);
    return failures.length > 0 ? 1 : 0;
  }

  const expanded = await expandInputs(files, {
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
    try {
      await writeFile(options.output, text);
    } catch (e) {
      console.error(`Error writing ${options.output}: ${(e as Error).message}`);
      return 1;
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
