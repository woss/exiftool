const EXIFTOOL_LIB = '/Users/woss/projects/woss/exiftool-action/exiftool/lib';

interface ParsedTag {
  name: string;
  tagId: string;
  format?: string;
  writable: boolean;
  groups: Record<string, string>;
  description?: string;
}

async function parsePerlTagModule(filePath: string): Promise<ParsedTag[]> {
  const text = await Deno.readTextFile(filePath);
  const tags: ParsedTag[] = [];

  const moduleMatch = text.match(/package\s+Image::ExifTool::(\w+)/);
  const moduleName = moduleMatch?.[1] ?? 'Unknown';

  const groupMatch = text.match(/%Image::ExifTool::(\w+)::(\w+)/);
  const groupName = groupMatch?.[2] ?? moduleName;

  const tagEntries = text.matchAll(
    /(\w+)\s*=>\s*{([^}]+)}/g,
  );

  for (const match of tagEntries) {
    const name = match[1];
    const props = match[2];

    const idMatch = props.match(/(\d+)/);
    const writable = !props.includes('Writable => 0') && !props.includes('Protect');
    const formatMatch = props.match(/Writable\s*=>\s*['"](\w+)['"]/);

    tags.push({
      name,
      tagId: idMatch?.[1] ?? '0',
      format: formatMatch?.[1],
      writable,
      groups: { family0: 'Image', family1: groupName },
    });
  }

  return tags;
}

async function main() {
  console.error('Scanning', EXIFTOOL_LIB, 'for tag definitions...');

  const files: string[] = [];
  for await (const entry of Deno.readDir(EXIFTOOL_LIB)) {
    if (entry.isFile && entry.name.endsWith('.pm')) {
      files.push(entry.name);
    }
  }

  let totalTags = 0;
  for (const file of files.slice(0, 5)) {
    const filePath = `${EXIFTOOL_LIB}/${file}`;
    const tags = await parsePerlTagModule(filePath);
    totalTags += tags.length;
    console.error(`  ${file}: ${tags.length} tags`);
  }

  console.error(`\nTotal tags parsed: ${totalTags}`);
  console.error('Generation complete (stub). Full pipeline TBD.');
}

if (import.meta.main) {
  main();
}
