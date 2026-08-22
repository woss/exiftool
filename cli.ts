import { Command } from '@cliffy/command';
import { ExifTool } from './src/exiftool.ts';
import { formatJSON, formatCSV, formatTabular } from './src/cli/output.ts';
import type { FormatOptions } from './src/cli/output.ts';

function normalizeArgs(args: string[]): string[] {
  return args.flatMap((a) => {
    if (a.startsWith('-') && !a.startsWith('--') && a.length > 2) {
      if (a === '-ver') return ['--version'];
      // -g1 → -g 1, -G2 → -G 2 (short form with attached value)
      if (/^-[gG]\d$/.test(a)) return [a.slice(0, 2), a.slice(2)];
      return ['--' + a.slice(1)];
    }
    if (a === '-g') return ['--group-headings', '0'];
    if (a === '-G') return ['--group-prefix', '1'];
    return [a];
  });
}

const tool = new ExifTool();

const cmd = new Command()
  .name('exiftool-ts')
  .version('0.1.0')
  .description('Read/write metadata across 140+ file formats')
  .option('--json', 'Output in JSON format')
  .option('--csv', 'Output in CSV format')
  .option('-b, --binary', 'Output binary data for binary-valued tags')
  .option('-d, --date-format <format:string>', 'Date format string (%Y %m %d %H %M %S %f)')
  .option('-g, --group-headings <family:string>', 'Show group headings (tabular only, -g[NUM])')
  .option('-G, --group-prefix <family:string>', 'Show group name prefix (-G[NUM])')
  .option('-v, --verbose', 'Verbose output', { collect: true })
  .option('-q, --quiet', 'Quiet output', { collect: true })
  .arguments('<files...:string>')
  .action(async (options, ...files: string[]) => {
    const results = [];
    for (const file of files) {
      try {
        const info = await tool.read(file);
        results.push(info);
      } catch (e) {
        console.error(`Error reading ${file}: ${(e as Error).message}`);
        Deno.exit(1);
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

    if (options.binary) {
      let foundBinary = false;
      for (const file of results) {
        for (const value of Object.values(file.tags)) {
          if (value instanceof Uint8Array) {
            await Deno.stdout.write(value);
            foundBinary = true;
          }
        }
      }
      if (!foundBinary) {
        console.error('No binary tags found.');
        Deno.exit(1);
      }
      return;
    }

    if (options.json) {
      console.log(formatJSON(results, fmtOpts));
    } else if (options.csv) {
      console.log(formatCSV(results, fmtOpts));
    } else {
      console.log(formatTabular(results, fmtOpts));
    }
  });

await cmd.parse(normalizeArgs(Deno.args));
