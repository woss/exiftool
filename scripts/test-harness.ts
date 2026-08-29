import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const run = promisify(execFile);

const EXIFTOOL_CMD = 'exiftool';

interface CompareResult {
  file: string;
  matches: boolean;
  tsOnly: string[];
  etOnly: string[];
  diff: Array<{ tag: string; ts: string; et: string }>;
}

async function runExifTool(filePath: string): Promise<Record<string, string>> {
  const { stdout } = await run(EXIFTOOL_CMD, ['-json', '-n', '--', filePath], {
    encoding: 'utf8',
  });
  const parsed = JSON.parse(stdout);
  return parsed[0] ?? {};
}

function runTsTool(filePath: string): Record<string, string> {
  return {};
}

function compareResults(
  ts: Record<string, string>,
  et: Record<string, string>,
  file: string,
): CompareResult {
  const tsKeys = new Set(Object.keys(ts));
  const etKeys = new Set(Object.keys(et));

  const both = [...tsKeys].filter((k) => etKeys.has(k));
  const tsOnly = [...tsKeys].filter((k) => !etKeys.has(k));
  const etOnly = [...etKeys].filter((k) => !tsKeys.has(k));

  const diff: CompareResult['diff'] = [];
  for (const tag of both) {
    if (String(ts[tag]) !== String(et[tag])) {
      diff.push({ tag, ts: String(ts[tag]), et: String(et[tag]) });
    }
  }

  return {
    file,
    matches: tsOnly.length === 0 && etOnly.length === 0 && diff.length === 0,
    tsOnly,
    etOnly,
    diff,
  };
}

async function main() {
  const testFiles = process.argv.slice(2);
  if (testFiles.length === 0) {
    console.error('Usage: tsx scripts/test-harness.ts <files...>');
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  for (const file of testFiles) {
    const et = await runExifTool(file);
    const ts = await runTsTool(file);
    const result = compareResults(ts, et, file);

    if (result.matches) {
      passed++;
    } else {
      failed++;
      console.error(`\nMISMATCH: ${file}`);
      if (result.tsOnly.length) console.error('  Only in ts-tool:', result.tsOnly.join(', '));
      if (result.etOnly.length) console.error('  Only in exiftool:', result.etOnly.join(', '));
      for (const d of result.diff) {
        console.error(`  ${d.tag}: ts="${d.ts}" vs et="${d.et}"`);
      }
    }
  }

  console.error(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
