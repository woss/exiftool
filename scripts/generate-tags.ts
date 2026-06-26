interface TagDef {
  id: string;
  name: string;
  type: string;
  writable: boolean;
  description?: string;
  g2?: string;
  values?: Record<string, string>;
}

interface TableDef {
  perlName: string;
  groups: { g0?: string; g1?: string; g2?: string };
  description: string;
  tags: TagDef[];
}

const ROOT = `${import.meta.dirname}/..`;
const OUTPUT_JSON = `${ROOT}/src/tags/generated/tags.json`;

function parseExifToolXml(xml: string): TableDef[] {
  const tables: TableDef[] = [];
  let currentTable: TableDef | null = null;
  let currentTag: TagDef | null = null;
  let currentValues: Record<string, string> | null = null;
  let currentKeyId: string | null = null;
  let textBuf = '';

  for (const line of xml.split('\n')) {
    const trimmed = line.trim();

    if (trimmed.startsWith('<table ')) {
      currentTable = {
        perlName: extractAttr(trimmed, 'name') ?? '',
        groups: {
          g0: extractAttr(trimmed, 'g0'),
          g1: extractAttr(trimmed, 'g1'),
          g2: extractAttr(trimmed, 'g2'),
        },
        description: '',
        tags: [],
      };
      continue;
    }
    if (trimmed === '</table>' && currentTable) {
      tables.push(currentTable);
      currentTable = null;
      continue;
    }
    if (!currentTable) continue;

    if (trimmed.startsWith('<desc ')) {
      const lang = extractAttr(trimmed, 'lang');
      if (lang === 'en' || !lang) {
        if (currentTag) currentTag.description = extractText(trimmed);
        else currentTable.description = extractText(trimmed);
      }
      continue;
    }
    if (trimmed.startsWith('<tag ')) {
      currentTag = {
        id: extractAttr(trimmed, 'id') ?? '?',
        name: extractAttr(trimmed, 'name') ?? '?',
        type: extractAttr(trimmed, 'type') ?? '?',
        writable: (extractAttr(trimmed, 'writable') ?? 'false') === 'true',
        g2: extractAttr(trimmed, 'g2'),
      };
      currentValues = null;
      continue;
    }
    if (trimmed === '</tag>' && currentTag && currentTable) {
      if (currentValues && Object.keys(currentValues).length > 0) {
        currentTag.values = currentValues;
      }
      currentTable.tags.push(currentTag);
      currentTag = null;
      currentValues = null;
      continue;
    }
    if (trimmed.startsWith('<values>')) {
      currentValues = {};
      continue;
    }
    if (trimmed === '</values>') {
      currentValues = null;
      continue;
    }
    if (trimmed.startsWith('<key ')) {
      currentKeyId = extractAttr(trimmed, 'id');
      textBuf = '';
      continue;
    }
    if (trimmed.startsWith('<val ')) {
      const lang = extractAttr(trimmed, 'lang');
      if (lang === 'en' || !lang) textBuf = extractText(trimmed);
      continue;
    }
    if (trimmed === '</key>' && currentValues && currentKeyId !== null && textBuf) {
      currentValues[currentKeyId] = textBuf;
      currentKeyId = null;
      textBuf = '';
      continue;
    }
  }

  return tables;
}

function extractAttr(line: string, attr: string): string | undefined {
  const m = line.match(new RegExp(`${attr}='([^']*)'`));
  return m?.[1];
}

function extractText(line: string): string {
  const m = line.match(/>(.*)</);
  return m?.[1] ?? '';
}

async function generate() {
  console.error('Spawning exiftool -listx...');
  const cmd = new Deno.Command('exiftool', { args: ['-listx'], stdout: 'piped', stderr: 'piped' });
  const output = await cmd.output();
  if (!output.success) {
    console.error('exiftool failed:', new TextDecoder().decode(output.stderr));
    Deno.exit(1);
  }

  const xml = new TextDecoder().decode(output.stdout);
  console.error(`Parsing ${(xml.length / 1024 / 1024).toFixed(1)}MB of XML...`);
  const tables = parseExifToolXml(xml);

  const totalTags = tables.reduce((s, t) => s + t.tags.length, 0);
  console.error(`Found ${tables.length} tables with ${totalTags} tags`);

  await Deno.mkdir(`${ROOT}/src/tags/generated`, { recursive: true });

  const json = JSON.stringify(tables);
  await Deno.writeTextFile(OUTPUT_JSON, json);
  console.error(`Wrote ${OUTPUT_JSON} (${(json.length / 1024 / 1024).toFixed(1)}MB)`);
}

if (import.meta.main) {
  generate();
}
