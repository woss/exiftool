import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXIFTOOL_DIR = join(ROOT, 'vendor/exiftool');
const EXIFTOOL_BIN = join(EXIFTOOL_DIR, 'exiftool');
const PINNED_EXIFTOOL_VERSION = '13.55';
const OUTPUT_JSON = `${ROOT}/src/tags/generated/tags.json`;
const OUTPUT_MANIFEST = `${ROOT}/src/tags/generated/manifest.json`;
const OUTPUT_XMP_NAMESPACES = `${ROOT}/src/tags/generated/xmp-namespaces.json`;
const OUTPUT_XMP_SHAPES = `${ROOT}/src/tags/generated/xmp-shapes.json`;
const OUTPUT_XMP_STRUCTS = `${ROOT}/src/tags/generated/xmp-structs.json`;
const OUTPUT_WRITE_METADATA = `${ROOT}/src/tags/generated/write-metadata.json`;
const CLASSIFIED_WRITABLE_TYPES = new Set([
  '?', 'GUID', 'Unicode', 'boolean', 'date', 'digits', 'double', 'fixed32s', 'fixed32u',
  'float', 'int8s', 'int8u', 'int16s', 'int16u', 'int16uRev', 'int32s', 'int32u',
  'int64s', 'int64u', 'integer', 'lang-alt', 'rational', 'rational32u', 'rational64s',
  'rational64u', 'real', 'resize', 'string', 'struct', 'undef', 'unicode', 'vt_filetime',
]);

const PERL_WRITE_METADATA = String.raw`
use JSON::PP;
use Scalar::Util qw(refaddr);
require Image::ExifTool::Exif;
require Image::ExifTool::GPS;
require Image::ExifTool::IPTC;
require Image::ExifTool::XMP;
do "./vendor/exiftool/lib/Image/ExifTool/XMP2.pl" or die $@ || $!;
my $et = Image::ExifTool->new;
my @records;
my @missing_tables;
my %table_control_keys = map { $_ => 1 } qw(
  AVOID CHECK_PROC GROUPS LANG_INFO NAMESPACE NOTES SHORT_NAME TABLE_DESC TABLE_NAME
  TABLE_TYPE TAG_PREFIX WRITABLE WRITE_PROC WRITE_GROUP SET_GROUP1 INIT_TABLE
  PRIORITY PROCESS_PROC PRINT_CONV VALUE_CONV
);
sub serialize_struct {
  my ($struct, $depth, $seen) = @_;
  return undef unless ref($struct) eq 'HASH';
  return { truncated => 1 } if $depth > 12;
  my $address = refaddr($struct);
  return { recursive => 1 } if $seen->{$address};
  local $seen->{$address} = 1;
  my @fields;
  for my $key (sort keys %$struct) {
    next if $key =~ /^(?:STRUCT_NAME|NAMESPACE|NOTES|GROUPS|Writable|List|FlatName|AutoSplit|Name|TagID)$/;
    my $field = $struct->{$key};
    next unless ref($field) eq 'HASH';
    my %enum_values;
    if (ref($field->{PrintConv}) eq 'HASH') {
      for my $code (sort keys %{$field->{PrintConv}}) {
        my $label = $field->{PrintConv}{$code};
        $enum_values{$code} = "$label" unless ref($label);
      }
    }
    push @fields, {
      key => $key,
      name => $field->{Name} // $field->{FlatName} // $key,
      namespace => $field->{Namespace} // $struct->{NAMESPACE},
      writableType => $field->{Writable},
      list => $field->{List},
      protected => !!$field->{Protected},
      conditional => !!$field->{Condition},
      hasValueConvInv => !!$field->{ValueConvInv},
      enumValues => %enum_values ? \%enum_values : undef,
      struct => ref($field->{Struct}) eq 'HASH'
        ? serialize_struct($field->{Struct}, $depth + 1, $seen)
        : undef,
    };
  }
  return {
    name => $struct->{STRUCT_NAME},
    namespace => $struct->{NAMESPACE},
    fields => \@fields,
  };
}
for my $table_name (@ARGV) {
  my $table = Image::ExifTool::GetTagTable("Image::ExifTool::$table_name");
  unless ($table) { push @missing_tables, $table_name; next; }
  my $groups = $table->{GROUPS} || {};
  for my $id (sort keys %$table) {
    next if $table_control_keys{$id};
    my @infos = Image::ExifTool::GetTagInfoList($table, $id);
    for my $info (@infos) {
      next unless ref($info) eq 'HASH' && defined($info->{Name});
      my $writable = defined($info->{Writable}) ? $info->{Writable} : $table->{WRITABLE};
      push @records, {
        table => $table_name,
        id => "$id",
        name => $info->{Name},
        tableGroups => {
          g0 => $groups->{0},
          g1 => $groups->{1},
          g2 => $groups->{2},
        },
        writable => defined($writable) ? "$writable" : undef,
        writeGroup => defined($info->{WriteGroup}) ? "$info->{WriteGroup}" : undef,
        protected => !!($info->{Protected} || $table->{PROTECTED}),
        conditional => !!$info->{Condition},
        hasPrintConv => !!$info->{PrintConv},
        hasPrintConvInv => !!$info->{PrintConvInv},
        hasValueConv => !!$info->{ValueConv},
        hasValueConvInv => !!$info->{ValueConvInv},
        list => defined($info->{List}) ? "$info->{List}" : undef,
        hasStruct => !!$info->{Struct},
        structSchema => ref($info->{Struct}) eq 'HASH'
          ? serialize_struct($info->{Struct}, 0, {})
          : undef,
      };
    }
  }
}
print JSON::PP->new->canonical->encode({ records => \@records, missingTables => \@missing_tables });
`;

export function assertPinnedExifToolVersion(version: string): void {
  if (version !== PINNED_EXIFTOOL_VERSION) {
    throw new Error(
      `Expected vendored ExifTool ${PINNED_EXIFTOOL_VERSION}, found ${version || '(empty version)'}`,
    );
  }
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function parseExifToolXml(xml: string): TableDef[] {
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
      if (currentTag && currentValues && Object.keys(currentValues).length > 0) {
        currentTag.values = currentValues;
      }
      currentValues = null;
      continue;
    }
    if (trimmed.startsWith('<key ')) {
      currentKeyId = extractAttr(trimmed, 'id') ?? null;
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

export function parseExifToolXmpNamespaces(source: string): Record<string, string> {
  const start = source.indexOf('%nsURI = (');
  if (start < 0) throw new Error('ExifTool XMP.pm has no %nsURI table');
  const end = source.indexOf('\n);', start);
  if (end < 0) throw new Error('ExifTool XMP.pm has an unterminated %nsURI table');
  const block = source.slice(start, end);
  const entries: Record<string, string> = {};
  const entryPattern = /^\s*(?:'([^']+)'|([A-Za-z_][\w-]*))\s*=>\s*'([^']*)'/gm;
  let match: RegExpExecArray | null;
  while ((match = entryPattern.exec(block)) !== null) {
    const prefix = match[1] ?? match[2]!;
    const uri = match[3]!;
    if (entries[prefix] !== undefined && entries[prefix] !== uri) {
      throw new Error(`Conflicting XMP namespace URI for ${prefix}`);
    }
    entries[prefix] = uri;
  }
  if (Object.keys(entries).length === 0) throw new Error('ExifTool XMP.pm %nsURI table is empty');
  return entries;
}

function resolveXmpTablePrefix(table: TableDef, namespaces: Record<string, string>): string | undefined {
  const aliases: Record<string, string> = {
    'XMP::GettyImages': 'GettyImagesGIFT',
    'XMP::iptcCore': 'Iptc4xmpCore',
    'XMP::iptcExt': 'Iptc4xmpExt',
  };
  const explicit = aliases[table.perlName];
  if (explicit) return explicit;
  const groupPrefix = table.groups.g1?.startsWith('XMP-')
    ? table.groups.g1.slice('XMP-'.length)
    : table.perlName.slice('XMP::'.length);
  return Object.keys(namespaces).find((prefix) => prefix.toLowerCase() === groupPrefix.toLowerCase());
}

export function collectWritableXmpShapes(
  tables: TableDef[],
  upstreamShapes: Record<string, string>,
  namespaces: Record<string, string>,
): Record<string, 'bag' | 'seq' | 'alt'> {
  const byName = new Map(tables.map((table) => [table.perlName, table]));
  const shapes: Record<string, 'bag' | 'seq' | 'alt'> = {};
  for (const [key, rawShape] of Object.entries(upstreamShapes).sort(([left], [right]) => left.localeCompare(right))) {
    const separator = key.indexOf(':');
    if (separator < 1) continue;
    const table = byName.get(`XMP::${key.slice(0, separator)}`);
    if (!table) continue;
    const sourceProperty = key.slice(separator + 1);
    const sourceTag = table.tags.find((tag) =>
      tag.writable && (tag.id === sourceProperty || tag.name === sourceProperty)
    );
    if (!sourceTag) continue;
    const prefix = resolveXmpTablePrefix(table, namespaces);
    if (!prefix) continue;
    const property = prefix === 'dc' ? sourceTag.id.toLowerCase() : sourceTag.id;
    const shape = rawShape.toLowerCase();
    if (shape === 'bag' || shape === 'seq' || shape === 'alt') {
      shapes[`${prefix}:${property}`] = shape;
    }
  }
  return shapes;
}

export function assertWritableTypesClassified(tables: TableDef[]): void {
  const unclassified = new Set(
    tables.flatMap((table) => table.tags)
      .filter((tag) => tag.writable && !CLASSIFIED_WRITABLE_TYPES.has(tag.type))
      .map((tag) => tag.type),
  );
  if (unclassified.size > 0) {
    throw new Error(`Unclassified writable ExifTool types: ${[...unclassified].sort().join(', ')}`);
  }
}

function extractAttr(line: string, attr: string): string | undefined {
  const m = line.match(new RegExp(`${attr}='([^']*)'`));
  return m ? decodeXml(m[1]!) : undefined;
}

function extractText(line: string): string {
  const m = line.match(/>(.*)</);
  return decodeXml(m?.[1] ?? '');
}

function decodeXml(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, body: string) => {
    if (body === 'amp') return '&';
    if (body === 'lt') return '<';
    if (body === 'gt') return '>';
    if (body === 'quot') return '"';
    if (body === 'apos') return "'";
    const codePoint = body[1]?.toLowerCase() === 'x'
      ? Number.parseInt(body.slice(2), 16)
      : Number.parseInt(body.slice(1), 10);
    return Number.isFinite(codePoint) && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : entity;
  });
}

async function generate() {
  console.error('Spawning exiftool -listx...');
  const run = promisify(execFile);
  let xml: string;
  try {
    const [{ stdout: version }, { stdout: sourceTree }] = await Promise.all([
      run(EXIFTOOL_BIN, ['-ver'], { encoding: 'utf8' }),
      run('git', ['-C', EXIFTOOL_DIR, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }),
    ]);
    assertPinnedExifToolVersion(version.trim());
    const xmpSource = await readFile(join(EXIFTOOL_DIR, 'lib/Image/ExifTool/XMP.pm'), 'utf8');
    const xmpNamespaces = parseExifToolXmpNamespaces(xmpSource);
    ({ stdout: xml } = await run(EXIFTOOL_BIN, ['-listx'], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    }));
    const sourceTreeSha256 = sourceTree.trim();
    if (!/^[a-f0-9]{40}$/.test(sourceTreeSha256)) {
      throw new Error(`Invalid ExifTool source tree hash: ${sourceTreeSha256}`);
    }
    console.error(`Using ExifTool ${version.trim()} (${sourceTreeSha256})`);
    const tables = parseExifToolXml(xml);
    assertWritableTypesClassified(tables);
    const xmpTables = tables.filter((table) => table.perlName.startsWith('XMP::'));
    const perlListShapes = String.raw`
require Image::ExifTool::XMP;
    use JSON::PP;
my %shapes;
for my $table_name (@ARGV) {
    my $table = Image::ExifTool::GetTagTable("Image::ExifTool::XMP::$table_name");
    next unless $table;
    for my $id (sort keys %$table) {
        my $tag = $table->{$id};
        next unless ref($tag) eq 'HASH';
        my $shape = $tag->{List};
        next unless defined($shape) && $shape =~ /^(?:Bag|Seq|Alt)$/;
        my $name = $tag->{Name} // $id;
        $shapes{"$table_name:$name"} = $shape;
    }
}
print JSON::PP->new->canonical->encode(\%shapes);
`;
    const { stdout: shapeJson } = await run('perl', [
      `-I${join(EXIFTOOL_DIR, 'lib')}`,
      '-MImage::ExifTool',
      '-e', perlListShapes,
      ...xmpTables.map((table) => table.perlName.slice('XMP::'.length)),
    ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const xmpShapes = collectWritableXmpShapes(
      tables,
      JSON.parse(shapeJson) as Record<string, string>,
      xmpNamespaces,
    );
    const coreTables = tables.filter((table) => /^(?:Exif|GPS|IPTC|XMP)::/.test(table.perlName));
    const { stdout: writeMetadataJson } = await run('perl', [
      `-I${join(EXIFTOOL_DIR, 'lib')}`,
      '-MImage::ExifTool',
      '-e', PERL_WRITE_METADATA,
      ...coreTables.map((table) => table.perlName),
    ], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const writeMetadata = JSON.parse(writeMetadataJson) as {
      records: Array<{
          table: string;
          id: string;
          name: string;
          structSchema?: unknown;
        writable?: string;
        writeGroup?: string | null;
        protected?: boolean;
        conditional?: boolean;
        hasPrintConv?: boolean;
        hasPrintConvInv?: boolean;
        hasValueConvInv?: boolean;
      }>;
      missingTables: string[];
    };
    if (writeMetadata.missingTables.length > 0) {
      throw new Error(`Could not load core ExifTool tag tables: ${writeMetadata.missingTables.join(', ')}`);
    }
    const tableByName = new Map(tables.map((table) => [table.perlName, table]));
    const xmpStructs: Record<string, unknown> = {};
    for (const record of writeMetadata.records) {
      if (!record.structSchema) continue;
      const table = tableByName.get(record.table);
      const tag = table?.tags.find((item) => item.id === record.id);
      const prefix = table && resolveXmpTablePrefix(table, xmpNamespaces);
      if (prefix && tag) xmpStructs[`${prefix}:${tag.id}`] = record.structSchema;
    }

    const totalTags = tables.reduce((s, t) => s + t.tags.length, 0);
    const writableEntries = tables.flatMap((table) =>
      table.tags.filter((tag) => tag.writable).map((tag) => ({ table, tag }))
    );
    const writableTypeCounts: Record<string, number> = {};
    for (const { tag } of writableEntries) {
      writableTypeCounts[tag.type] = (writableTypeCounts[tag.type] ?? 0) + 1;
    }
    console.error(`Found ${tables.length} tables with ${totalTags} tags`);

    await mkdir(`${ROOT}/src/tags/generated`, { recursive: true });

    const json = JSON.stringify(tables);
    const namespaceJson = JSON.stringify(xmpNamespaces);
    const xmpShapesJson = JSON.stringify(xmpShapes);
    await writeFile(OUTPUT_JSON, json);
    await writeFile(OUTPUT_XMP_NAMESPACES, `${JSON.stringify(xmpNamespaces, null, 2)}\n`);
    await writeFile(OUTPUT_XMP_SHAPES, `${JSON.stringify(xmpShapes, null, 2)}\n`);
    const writeMetadataOutput = `${JSON.stringify(writeMetadata, null, 2)}\n`;
    await writeFile(OUTPUT_WRITE_METADATA, writeMetadataOutput);
    const xmpStructsOutput = `${JSON.stringify(xmpStructs, null, 2)}\n`;
    await writeFile(OUTPUT_XMP_STRUCTS, xmpStructsOutput);
    const manifest = {
      exiftoolVersion: version.trim(),
      exiftoolSourceTreeSha1: sourceTreeSha256,
      catalogSha256: sha256(json),
      xmpNamespaceCount: Object.keys(xmpNamespaces).length,
      xmpNamespacesSha256: sha256(namespaceJson),
      xmpShapeCount: Object.keys(xmpShapes).length,
      xmpShapesSha256: sha256(xmpShapesJson),
      xmpStructCount: Object.keys(xmpStructs).length,
      xmpStructsSha256: sha256(xmpStructsOutput),
      coreWriteMetadataSha256: sha256(writeMetadataOutput),
      coreWriteMetadataRecords: writeMetadata.records.length,
      unavailableCoreWriteMetadataTables: writeMetadata.missingTables,
      coreWriteMetadataWritableRecords: writeMetadata.records.filter((record) => record.writable).length,
      coreWriteGroupsSpecified: writeMetadata.records.filter((record) => record.writeGroup).length,
      coreProtectedRecords: writeMetadata.records.filter((record) => record.protected).length,
      coreConditionalRecords: writeMetadata.records.filter((record) => record.conditional).length,
      corePrintConvRecords: writeMetadata.records.filter((record) => record.hasPrintConv).length,
      corePrintConvInvRecords: writeMetadata.records.filter((record) => record.hasPrintConvInv).length,
      coreValueConvInvRecords: writeMetadata.records.filter((record) => record.hasValueConvInv).length,
      tableCount: tables.length,
      tagCount: totalTags,
      writableTagCount: writableEntries.length,
      writableTagsWithEnums: writableEntries.filter(({ tag }) => tag.values !== undefined).length,
      writableTagsWithoutFamily1ReadGroup: writableEntries
        .filter(({ table, tag }) => !table.groups.g1 && !tag.g2)
        .map(({ table, tag }) => ({ table: table.perlName, id: tag.id, name: tag.name })),
      writeGroupAndProtectionMetadata: 'not present in -listx; inspect pinned Perl tables',
      writableUnknownTypes: writableEntries
        .filter(({ tag }) => tag.type === '?')
        .map(({ table, tag }) => ({
          table: table.perlName,
          id: tag.id,
          name: tag.name,
          status: 'needs-manual-encoder-review',
        })),
      writableTypeCounts,
    };
    await writeFile(OUTPUT_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    console.error(`Wrote ${OUTPUT_JSON} (${(json.length / 1024 / 1024).toFixed(1)}MB)`);
    console.error(`Wrote ${OUTPUT_XMP_NAMESPACES} (${Object.keys(xmpNamespaces).length} namespaces)`);
    console.error(`Wrote ${OUTPUT_XMP_SHAPES} (${Object.keys(xmpShapes).length} writable list shapes)`);
    console.error(`Wrote ${OUTPUT_XMP_STRUCTS} (${Object.keys(xmpStructs).length} struct schemas)`);
    console.error(`Wrote ${OUTPUT_WRITE_METADATA} (${writeMetadata.records.length} Perl tag records)`);
    console.error(`Wrote ${OUTPUT_MANIFEST}`);
  } catch (error) {
    const e = error as { stderr?: string | Buffer; message?: string };
    console.error('tag generation failed:', e.stderr?.toString() ?? e.message);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  generate();
}
