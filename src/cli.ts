#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { normalizeArgs, parseCliArgs, type CliOptions } from './cli/args.js';
import { ExifTool } from './exiftool.js';
import { formatJSON, formatCSV, formatTabular, formatXML } from './cli/output.js';
import type { FormatOptions } from './cli/output.js';
import { evalCondition } from './cli/filter.js';
import { verboseLines } from './cli/verbosity.js';
import { expandInputs } from './cli/glob.js';
import { readLines, stayOpenLoop } from './cli/stay-open.js';
import { extractEmbeddedJpegs, jpegParser } from './format/jpeg.js';

export { normalizeArgs, parseCliArgs } from './cli/args.js';
export type { CliOptions } from './cli/args.js';

const tool = new ExifTool();


export async function runAction(options: CliOptions, ...files: string[]): Promise<number> {
  const quietCount: number = options.quiet?.length ?? 0;
  const verboseCount: number = options.verbose?.length ?? 0;
  const coordFormat: string | undefined = options.coordFormat;
  const failures: string[] = [];

  // Write mode: any TAG=VALUE operands turn the invocation into an update.
  const assignments = files.filter((f) => /^-?[A-Za-z][A-Za-z0-9_]*=/.test(f));
  if (assignments.length > 0) {
    const tags: Record<string, string> = {};
    for (const a of assignments) {
      const eq = a.indexOf('=');
      tags[a.slice(0, eq).replace(/^-/, '')] = a.slice(eq + 1);
    }
    const paths = files.filter((f) => !assignments.includes(f));
    const expandedWrite = await expandInputs(paths, {
      recurse: options.recurse === true,
      extensions: options.extension ?? [],
      ignoreDirs: options.ignore ?? [],
    });
    let updated = 0;
    for (const file of expandedWrite) {
      try {
        await tool.write(file, tags, {
          overwriteOriginal: options.overwriteOriginal === true,
        });
        updated++;
      } catch (e) {
        failures.push(`Error writing ${file}: ${(e as Error).message}`);
      }
    }
    if (updated > 0 && quietCount < 1) console.log(`${updated} image files updated`);
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
      results.push(info);
      if (options.extractEmbedded === true && info.format === 'JPEG') {
        // The file was just read successfully; a re-read failure here is
        // handled by the same per-file catch below.
        const bytes = await readFile(file);
        for (const doc of extractEmbeddedJpegs(bytes)) {
          results.push(await jpegParser.parse(doc, file, tool.tagDb));
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
