import { UnsupportedFormatError } from './writers.js';
import type { TagStructValue, TagValue } from '../types.js';
import { COMPRESSION_VALUES, PHOTOMETRIC_INTERPRETATION_VALUES } from '../exif/tiff-builder.js';
import tagData from '../tags/generated/tags.json' with { type: 'json' };
import xmpNamespaceData from '../tags/generated/xmp-namespaces.json' with { type: 'json' };
import xmpShapeData from '../tags/generated/xmp-shapes.json' with { type: 'json' };
import type { TableDef } from '../tags.js';

/**
 * Generalized XMP property writer.
 *
 * Takes arbitrary `Group:Property` requests, serializes them to the value
 * shape XMP consumers expect, and either splices them into an existing
 * packet (replace-not-append, upsert semantics) or builds a minimal
 * conformant fresh packet when the container has none.
 *
 * Idempotence contract: writing the same properties twice yields a
 * byte-identical packet. Serialization is deterministic (no timestamps,
 * stable namespace ordering) and merging replaces the previous element of
 * the same property instead of appending.
 */

export type XmpPropertyShape = 'scalar' | 'alt' | 'bag' | 'seq';

export type XmpWriteValue =
  | string
  | number
  | boolean
  | (string | number | boolean)[]
  | TagStructValue
  | TagStructValue[];

export interface XmpPropertyRequest {
  /** Qualified property name, e.g. 'dc:subject' or 'xmpRights:WebStatement'. */
  name: string;
  value: XmpWriteValue;
  raw?: boolean;
}

const NAMESPACES = xmpNamespaceData as Record<string, string>;

/**
 * Value shapes by property. Properties not listed default to: scalar for
 * string values, Bag for arrays. Lang-alts serialize as rdf:Alt with a
 * single x-default item; ordered lists as rdf:Seq.
 */
const SHAPES: Record<string, XmpPropertyShape> = {
  ...(xmpShapeData as Record<string, XmpPropertyShape>),
  'xmp:Advisory': 'bag',
  'xmp:Identifier': 'bag',
  'lr:HierarchicalSubject': 'bag',
  'lr:WeightedFlatSubject': 'bag',
  'photoshop:DocumentAncestors': 'bag',
  'photoshop:SupplementalCategories': 'bag',
  'Iptc4xmpCore:Scene': 'bag',
  'Iptc4xmpCore:SubjectCode': 'bag',
  'xmpTPg:PlateNames': 'seq',
  'crs:ToneCurve': 'seq',
  'tiff:BitsPerSample': 'seq',
  'dc:rights': 'alt',
  'dc:title': 'alt',
  'dc:description': 'alt',
  'dc:date': 'seq',
  'dc:creator': 'seq',
  'dc:contributor': 'bag',
  'dc:identifier': 'bag',
  'dc:language': 'bag',
  'dc:relation': 'bag',
  'dc:subject': 'bag',
  'dc:publisher': 'bag',
  'dc:type': 'bag',
  'xmpRights:UsageTerms': 'alt',
  'xmpRights:Owner': 'bag',
  'exifEX:LensSpecification': 'seq',
  'Iptc4xmpExt:AltTextAccessibility': 'alt',
  'Iptc4xmpExt:ExtDescrAccessibility': 'alt',
  'Iptc4xmpExt:ModelAge': 'bag',
  'Iptc4xmpExt:OrganisationInImageCode': 'bag',
  'Iptc4xmpExt:OrganisationInImageName': 'bag',
  'Iptc4xmpExt:PersonInImage': 'bag',
};
const XMP_ENUMS: Record<string, Record<string, string>> = {
  'tiff:Compression': { ...COMPRESSION_VALUES },
  'tiff:PhotometricInterpretation': { ...PHOTOMETRIC_INTERPRETATION_VALUES },
  'photoshop:ColorMode': {
    0: 'Bitmap', 1: 'Grayscale', 2: 'Indexed', 3: 'RGB', 4: 'CMYK',
    7: 'Multichannel', 8: 'Duotone', 9: 'Lab',
  },
  'tiff:Orientation': {
    1: 'Horizontal (normal)', 2: 'Mirror horizontal', 3: 'Rotate 180',
    4: 'Mirror vertical', 5: 'Mirror horizontal and rotate 270 CW',
    6: 'Rotate 90 CW', 7: 'Mirror horizontal and rotate 90 CW', 8: 'Rotate 270 CW',
  },
  'tiff:PlanarConfiguration': { 1: 'Chunky', 2: 'Planar' },
  'tiff:YCbCrPositioning': { 1: 'Centered', 2: 'Co-sited' },
  'exifEX:SensitivityType': {
    0: 'Unknown', 1: 'Standard Output Sensitivity', 2: 'Recommended Exposure Index',
    3: 'ISO Speed', 4: 'Standard Output Sensitivity and Recommended Exposure Index',
    5: 'Standard Output Sensitivity and ISO Speed', 6: 'Recommended Exposure Index and ISO Speed',
    7: 'Standard Output Sensitivity, Recommended Exposure Index and ISO Speed',
  },
};
const XMP_NUMERIC_ENUM_TYPES = new Set([
  'int8u', 'int8s', 'int16u', 'int16s', 'int32u', 'int32s', 'int64u', 'int64s',
  'integer', 'real', 'float', 'double', 'rational32u', 'rational64u', 'rational64s',
]);
const XMP_STRUCT_PROPERTIES = new Set([
  'xmpTPg:MaxPageSize', 'xmpMM:DerivedFrom', 'xmpMM:ManagedFrom', 'Iptc4xmpCore:CreatorContactInfo',
]);
const XMP_STRUCT_LIST_SHAPES: Record<string, 'bag' | 'seq' | 'alt'> = {
  'xmp:Thumbnails': 'alt',
  'xmp:PageInfo': 'seq',
  'xmpBJ:JobRef': 'bag',
  'Iptc4xmpExt:Contributor': 'bag',
  'Iptc4xmpExt:Creator': 'bag',
  'Iptc4xmpExt:ProductInImage': 'bag',
  'Iptc4xmpExt:PublicationEvent': 'bag',
  'Iptc4xmpExt:DopesheetLink': 'bag',
  'Iptc4xmpExt:RegistryId': 'bag',
  'prism:onSaleDay': 'bag',
  'prism:url': 'bag',
  'photoshop:TextLayers': 'seq',
  'xmpMM:Ingredients': 'bag',
  'Iptc4xmpExt:AboutCvTerm': 'bag',
  'Iptc4xmpExt:Genre': 'bag',
  'xmpMM:History': 'seq',
  'xmpMM:Manifest': 'bag',
  'xmpMM:Pantry': 'bag',
  'xmpMM:Versions': 'seq',
  'xmpDM:markers': 'seq',
  'xmpDM:Tracks': 'bag',
  'xmpTPg:Colorants': 'seq',
  'xmpTPg:Fonts': 'bag',
  'xmpTPg:SwatchGroups': 'seq',
};
const RESOURCE_REF_FIELDS = new Set([
  'stRef:documentID', 'stRef:instanceID', 'stRef:manager', 'stRef:managerVariant',
  'stRef:manageTo', 'stRef:manageUI', 'stRef:renditionClass', 'stRef:renditionParams',
  'stRef:versionID', 'stRef:filePath', 'stRef:fromPart', 'stRef:lastModifyDate',
  'stRef:maskMarkers', 'stRef:partMapping', 'stRef:toPart', 'stRef:originalDocumentID',
  'stRef:lastURL', 'stRef:linkForm', 'stRef:linkCategory', 'stRef:placedXResolution',
  'stRef:placedYResolution', 'stRef:placedResolutionUnit',
]);
const RESOURCE_EVENT_FIELDS = new Set([
  'stEvt:action', 'stEvt:instanceID', 'stEvt:parameters', 'stEvt:softwareAgent',
  'stEvt:when', 'stEvt:changed',
]);
const XMP_STRUCT_FIELDS: Record<string, Set<string>> = {
  'xmp:Thumbnails': new Set(['xmpGImg:height', 'xmpGImg:width', 'xmpGImg:format', 'xmpGImg:image']),
  'xmp:PageInfo': new Set(['xmpTPg:PageNumber', 'xmpGImg:height', 'xmpGImg:width', 'xmpGImg:format', 'xmpGImg:image']),
  'xmpBJ:JobRef': new Set(['stJob:id', 'stJob:name', 'stJob:url']),
  'Iptc4xmpExt:Contributor': new Set(['xmp:Identifier', 'Iptc4xmpExt:Name', 'Iptc4xmpExt:Role']),
  'Iptc4xmpExt:Creator': new Set(['xmp:Identifier', 'Iptc4xmpExt:Name', 'Iptc4xmpExt:Role']),
  'Iptc4xmpExt:ProductInImage': new Set([
    'Iptc4xmpExt:ProductName', 'Iptc4xmpExt:ProductGTIN',
    'Iptc4xmpExt:ProductDescription', 'Iptc4xmpExt:ProductId',
  ]),
  'Iptc4xmpExt:PublicationEvent': new Set(['Iptc4xmpExt:Date', 'Iptc4xmpExt:Identifier']),
  'Iptc4xmpExt:DopesheetLink': new Set(['Iptc4xmpExt:Link', 'Iptc4xmpExt:LinkQualifier']),
  'Iptc4xmpExt:RegistryId': new Set([
    'Iptc4xmpExt:RegEntryRole', 'Iptc4xmpExt:RegItemId', 'Iptc4xmpExt:RegOrgId',
  ]),
  'prism:onSaleDay': new Set(['prism:day', 'prism:a-platform']),
  'prism:url': new Set(['prism:url', 'prism:a-platform']),
  'photoshop:TextLayers': new Set(['photoshop:LayerName', 'photoshop:LayerText']),
  'xmpTPg:MaxPageSize': new Set(['stDim:w', 'stDim:h', 'stDim:unit']),
  'Iptc4xmpCore:CreatorContactInfo': new Set([
    'Iptc4xmpCore:CiAdrCity', 'Iptc4xmpCore:CiAdrCtry', 'Iptc4xmpCore:CiAdrExtadr',
    'Iptc4xmpCore:CiAdrPcode', 'Iptc4xmpCore:CiAdrRegion', 'Iptc4xmpCore:CiEmailWork',
    'Iptc4xmpCore:CiTelWork', 'Iptc4xmpCore:CiUrlWork',
  ]),
  'xmpMM:ManagedFrom': RESOURCE_REF_FIELDS,
  'xmpMM:DerivedFrom': RESOURCE_REF_FIELDS,
  'xmpMM:Ingredients': RESOURCE_REF_FIELDS,
  'xmpMM:Manifest': new Set([
    'stMfs:linkForm', 'stMfs:reference', 'xmpMM:placedXResolution', 'xmpMM:placedYResolution', 'xmpMM:placedResolutionUnit',
  ]),
  'xmpMM:ManifestReference': RESOURCE_REF_FIELDS,
  'xmpMM:History': RESOURCE_EVENT_FIELDS,
  'xmpMM:Pantry': new Set(['xmpMM:InstanceID']),
  'xmpMM:Versions': new Set(['stVer:comments', 'stVer:event', 'stVer:modifier', 'stVer:modifyDate', 'stVer:version']),
  'xmpMM:VersionEvent': RESOURCE_EVENT_FIELDS,
  'xmpDM:Tracks': new Set(['xmpDM:frameRate', 'xmpDM:markers', 'xmpDM:trackName', 'xmpDM:trackType']),
  'xmpDM:markers': new Set([
    'xmpDM:comment', 'xmpDM:duration', 'xmpDM:location', 'xmpDM:name', 'xmpDM:startTime',
    'xmpDM:target', 'xmpDM:type', 'xmpDM:cuePointParams', 'xmpDM:cuePointType', 'xmpDM:probability', 'xmpDM:speaker',
  ]),
  'xmpDM:CuePointParam': new Set(['xmpDM:key', 'xmpDM:value']),
  'xmpTPg:Colorants': new Set([
    'xmpG:swatchName', 'xmpG:mode', 'xmpG:type', 'xmpG:cyan', 'xmpG:magenta', 'xmpG:yellow', 'xmpG:black',
    'xmpG:red', 'xmpG:green', 'xmpG:blue', 'xmpG:gray', 'xmpG:L', 'xmpG:A', 'xmpG:B', 'xmpG:tint',
  ]),
  'xmpTPg:Fonts': new Set([
    'stFnt:fontName', 'stFnt:fontFamily', 'stFnt:fontFace', 'stFnt:fontType',
    'stFnt:versionString', 'stFnt:composite', 'stFnt:fontFileName', 'stFnt:childFontFiles',
  ]),
  'xmpTPg:SwatchGroups': new Set(['xmpG:groupName', 'xmpG:groupType', 'xmpG:Colorants']),
  'Iptc4xmpExt:AboutCvTerm': new Set([
    'Iptc4xmpExt:CvTermId', 'Iptc4xmpExt:CvTermName', 'Iptc4xmpExt:CvId', 'Iptc4xmpExt:CvTermRefinedAbout',
  ]),
  'Iptc4xmpExt:Genre': new Set([
    'Iptc4xmpExt:CvTermId', 'Iptc4xmpExt:CvTermName', 'Iptc4xmpExt:CvId', 'Iptc4xmpExt:CvTermRefinedAbout',
  ]),
};

const XMP_STRUCT_FIELD_LISTS: Record<string, Record<string, 'bag' | 'seq'>> = {
  'Iptc4xmpExt:Contributor': { 'xmp:Identifier': 'bag', 'Iptc4xmpExt:Role': 'bag' },
  'Iptc4xmpExt:Creator': { 'xmp:Identifier': 'bag', 'Iptc4xmpExt:Role': 'bag' },
  'xmpTPg:Fonts': { 'stFnt:childFontFiles': 'seq' },
  'xmpDM:Tracks': { 'xmpDM:markers': 'seq' },
  'xmpDM:markers': { 'xmpDM:cuePointParams': 'seq' },
  'xmpTPg:SwatchGroups': { 'xmpG:Colorants': 'seq' },
};
const XMP_STRUCT_FIELD_LIST_ITEMS: Record<string, Record<string, string>> = {
  'xmpDM:Tracks': { 'xmpDM:markers': 'xmpDM:markers' },
  'xmpDM:markers': { 'xmpDM:cuePointParams': 'xmpDM:CuePointParam' },
  'xmpTPg:SwatchGroups': { 'xmpG:Colorants': 'xmpTPg:Colorants' },
};
const XMP_STRUCT_FIELD_STRUCTS: Record<string, Record<string, string>> = {
  'xmpMM:Manifest': { 'stMfs:reference': 'xmpMM:ManifestReference' },
  'xmpMM:Versions': { 'stVer:event': 'xmpMM:VersionEvent' },
};
const XMP_STRUCT_FIELD_ALTS: Record<string, Set<string>> = {
  'Iptc4xmpExt:Contributor': new Set(['Iptc4xmpExt:Name']),
  'Iptc4xmpExt:Creator': new Set(['Iptc4xmpExt:Name']),
  'Iptc4xmpExt:ProductInImage': new Set([
    'Iptc4xmpExt:ProductName', 'Iptc4xmpExt:ProductDescription',
  ]),
  'Iptc4xmpExt:AboutCvTerm': new Set(['Iptc4xmpExt:CvTermName']),
  'Iptc4xmpExt:Genre': new Set(['Iptc4xmpExt:CvTermName']),
};

const XMP_TABLE_PREFIXES: Record<string, string> = {
  'XMP::acdsee': 'acdsee',
  'XMP::crd': 'crd',
  'XMP::crs': 'crs',
  'XMP::dc': 'dc',
  'XMP::cc': 'cc',
  'XMP::DICOM': 'DICOM',
  'XMP::dex': 'dex',
  'XMP::digiKam': 'digiKam',
  'XMP::GettyImages': 'GettyImagesGIFT',
  'XMP::ics': 'ics',
  'XMP::photoshop': 'photoshop',
  'XMP::xmpDM': 'xmpDM',
  'XMP::xmpMM': 'xmpMM',
  'XMP::xmpRights': 'xmpRights',
  'XMP::pdf': 'pdf',
  'XMP::prism': 'prism',
  'XMP::pur': 'pur',
  'XMP::tiff': 'tiff',
  'XMP::exif': 'exif',
  'XMP::iptcCore': 'Iptc4xmpCore',
  'XMP::iptcExt': 'Iptc4xmpExt',
  'XMP::xmp': 'xmp',
};

function xmpTablePrefix(table: TableDef): string | undefined {
  const explicit = XMP_TABLE_PREFIXES[table.perlName];
  if (explicit) return explicit;
  const groupPrefix = table.groups.g1?.startsWith('XMP-')
    ? table.groups.g1.slice('XMP-'.length)
    : table.perlName.slice('XMP::'.length);
  return Object.keys(NAMESPACES).find((prefix) => prefix.toLowerCase() === groupPrefix.toLowerCase());
}

const XMP_GROUP_PREFIXES: Record<string, string> = {};
const XMP_PROPERTY_IDS: Record<string, string> = {};
for (const table of tagData as TableDef[]) {
  if (!table.groups.g1?.startsWith('XMP-')) continue;
  const prefix = xmpTablePrefix(table);
  if (prefix) XMP_GROUP_PREFIXES[table.groups.g1.slice('XMP-'.length).toLowerCase()] = prefix;
  if (!prefix) continue;
  for (const tag of table.tags.filter((item) => item.writable)) {
    const canonical = `${prefix}:${tag.id}`;
    XMP_PROPERTY_IDS[canonical.toLowerCase()] = canonical;
    XMP_PROPERTY_IDS[`${prefix}:${tag.name}`.toLowerCase()] = canonical;
  }
}

function canonicalXmpPropertyName(name: string): string {
  return XMP_PROPERTY_IDS[name.toLowerCase()] ?? name;
}

for (const table of tagData as TableDef[]) {
  const prefix = xmpTablePrefix(table);
  if (!prefix) continue;
  for (const tag of table.tags) {
    if (!tag.values || (!XMP_NUMERIC_ENUM_TYPES.has(tag.type) && tag.type !== 'string')) continue;
    const values = Object.fromEntries(
      Object.entries(tag.values).filter(([value]) =>
        tag.type === 'string' || Number.isSafeInteger(Number(value))
      ),
    );
    if (Object.keys(values).length === 0) continue;
    const name = `${prefix}:${tag.id}`;
    XMP_ENUMS[name] = { ...values, ...XMP_ENUMS[name] };
  }
}

const LANGUAGE_ALTERNATIVES = new Set<string>();
const XMP_DATE_PROPERTIES = new Set<string>();
for (const table of tagData as TableDef[]) {
  const prefix = xmpTablePrefix(table);
  if (!prefix) continue;
  for (const tag of table.tags) {
    if (!tag.writable) continue;
    const property = prefix === 'dc' ? tag.id.toLowerCase() : tag.id;
    if (tag.type === 'lang-alt') {
      LANGUAGE_ALTERNATIVES.add(`${prefix}:${property}`);
    }
    if (tag.type === 'date') XMP_DATE_PROPERTIES.add(`${prefix}:${property}`);
  }
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function encodeBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const output = new Uint8Array(Math.ceil(bytes.length / 3) * 4);
  let inputOffset = 0;
  let outputOffset = 0;
  while (inputOffset < bytes.length) {
    const octet1 = bytes[inputOffset++]!;
    const hasOctet2 = inputOffset < bytes.length;
    const octet2 = hasOctet2 ? bytes[inputOffset++]! : 0;
    const hasOctet3 = inputOffset < bytes.length;
    const octet3 = hasOctet3 ? bytes[inputOffset++]! : 0;
    output[outputOffset++] = alphabet.charCodeAt(octet1 >> 2);
    output[outputOffset++] = alphabet.charCodeAt(((octet1 & 3) << 4) | (octet2 >> 4));
    output[outputOffset++] = hasOctet2
      ? alphabet.charCodeAt(((octet2 & 15) << 2) | (octet3 >> 6))
      : 61;
    output[outputOffset++] = hasOctet3 ? alphabet.charCodeAt(octet3 & 63) : 61;
  }
  return new TextDecoder().decode(output);
}

function isXmpStructValue(value: XmpWriteValue | TagValue): value is TagStructValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Uint8Array);
}

function structFieldName(name: string): { prefix: string; localName: string } | undefined {
  const separator = name.indexOf(':');
  if (separator < 1 || separator === name.length - 1) return undefined;
  const prefix = name.slice(0, separator);
  const localName = name.slice(separator + 1);
  if (!NAMESPACES[prefix] || !/^[A-Za-z_][\w.-]*$/.test(localName)) return undefined;
  return { prefix, localName };
}

function supportsLanguageAlternatives(name: string): boolean {
  return SHAPES[name] === 'alt' || LANGUAGE_ALTERNATIVES.has(name);
}

function isLanguageAlternativeValue(name: string, value: XmpWriteValue | TagValue): value is TagStructValue {
  return supportsLanguageAlternatives(name) && isLanguageMap(value);
}

function isLanguageMap(value: XmpWriteValue | TagValue): value is TagStructValue {
  if (!isXmpStructValue(value) || Object.keys(value).length === 0) return false;
  const seen = new Set<string>();
  return Object.entries(value).every(([language, text]) => {
    if (typeof text !== 'string' || !/^(?:x-default|[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*)$/i.test(language)) {
      return false;
    }
    const normalized = language.toLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function isValidXmpStruct(name: string, value: TagStructValue): boolean {
  const fields = XMP_STRUCT_FIELDS[name];
  if (!fields || Object.keys(value).length === 0) return false;
  if (name === 'xmpMM:Pantry' && !Object.hasOwn(value, 'xmpMM:InstanceID')) return false;
  return Object.entries(value).every(([field, item]) => {
    if (!fields.has(field)) return false;
    if ((name === 'xmp:Thumbnails' || name === 'xmp:PageInfo') && field === 'xmpGImg:image') {
      return item instanceof Uint8Array;
    }
    if (Array.isArray(item)) {
      const itemStruct = XMP_STRUCT_FIELD_LIST_ITEMS[name]?.[field];
      if (!XMP_STRUCT_FIELD_LISTS[name]?.[field]) return false;
      return item.every((value) => itemStruct
        ? isXmpStructValue(value) && isValidXmpStruct(itemStruct, value)
        : typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
      );
    }
    if (XMP_STRUCT_FIELD_ALTS[name]?.has(field)) return isLanguageMap(item);
    const nestedStruct = XMP_STRUCT_FIELD_STRUCTS[name]?.[field];
    if (nestedStruct) return isXmpStructValue(item) && isValidXmpStruct(nestedStruct, item);
    return typeof item === 'string' || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item));
  });
}

function xmpStructValues(value: XmpWriteValue | TagValue): TagStructValue[] | undefined {
  if (isXmpStructValue(value)) return [value];
  if (Array.isArray(value) && value.every(isXmpStructValue)) return value as TagStructValue[];
  return undefined;
}

function xmpStructFieldNames(value: TagStructValue): string[] {
  const names: string[] = [];
  for (const [field, item] of Object.entries(value)) {
    names.push(field);
    if (isXmpStructValue(item) && !isLanguageMap(item)) {
      names.push(...xmpStructFieldNames(item));
    } else if (Array.isArray(item) && item.every(isXmpStructValue)) {
      for (const nested of item as TagStructValue[]) names.push(...xmpStructFieldNames(nested));
    }
  }
  return names;
}

function serializeXmpAlt(name: string, value: TagStructValue): string {
  const entries = Object.entries(value) as [string, string][];
  entries.sort(([left], [right]) => Number(right.toLowerCase() === 'x-default') - Number(left.toLowerCase() === 'x-default'));
  const items = entries
    .map(([language, text]) => `<rdf:li xml:lang="${language.toLowerCase() === 'x-default' ? 'x-default' : language}">${xmlEscape(text)}</rdf:li>`)
    .join('');
  return `<${name}><rdf:Alt>${items}</rdf:Alt></${name}>`;
}

function serializeXmpStructFields(name: string, value: TagStructValue): string {
  const fields: string[] = [];
  for (const [fieldName, fieldValue] of Object.entries(value)) {
    const field = structFieldName(fieldName);
    if (!field) throw new UnsupportedFormatError(`invalid XMP struct field ${fieldName} for ${name}`);
    if (Array.isArray(fieldValue)) {
      const shape = XMP_STRUCT_FIELD_LISTS[name]?.[fieldName];
      if (!shape) throw new UnsupportedFormatError(`invalid XMP struct list field ${fieldName} for ${name}`);
      const kind = shape === 'bag' ? 'Bag' : 'Seq';
      const itemStruct = XMP_STRUCT_FIELD_LIST_ITEMS[name]?.[fieldName];
      const items = fieldValue.map((item) => {
        if (itemStruct) {
          return `<rdf:li rdf:parseType="Resource">${serializeXmpStructFields(itemStruct, item as TagStructValue)}</rdf:li>`;
        }
        return `<rdf:li>${xmlEscape(xmpScalar(item as string | number | boolean))}</rdf:li>`;
      }).join('');
      fields.push(`<${field.prefix}:${field.localName}><rdf:${kind}>${items}</rdf:${kind}></${field.prefix}:${field.localName}>`);
    } else if (isXmpStructValue(fieldValue)) {
      if (XMP_STRUCT_FIELD_ALTS[name]?.has(fieldName) && isLanguageMap(fieldValue)) {
        fields.push(serializeXmpAlt(fieldName, fieldValue));
        continue;
      }
      const nestedStruct = XMP_STRUCT_FIELD_STRUCTS[name]?.[fieldName]!;
      fields.push(
        `<${field.prefix}:${field.localName} rdf:parseType="Resource">${serializeXmpStructFields(nestedStruct, fieldValue)}</${field.prefix}:${field.localName}>`,
      );
    } else if (fieldValue instanceof Uint8Array) {
      fields.push(`<${field.prefix}:${field.localName}>${encodeBase64(fieldValue)}</${field.prefix}:${field.localName}>`);
    } else {
      fields.push(`<${field.prefix}:${field.localName}>${xmlEscape(xmpScalar(fieldValue))}</${field.prefix}:${field.localName}>`);
    }
  }
  return fields.join('');
}

/** Serializes one property to its element form. Array values are per-shape. */
export function serializeXmpProperty(name: string, value: XmpWriteValue, raw = false): string {
  name = canonicalXmpPropertyName(name);
  if (!raw && XMP_DATE_PROPERTIES.has(name)) {
    if (typeof value === 'string') {
      value = normalizeXmpDate(value);
    } else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      value = value.map((item) => normalizeXmpDate(item));
    } else {
      throw new UnsupportedFormatError(`XMP date property ${name} requires a date string or string list`);
    }
  }
  if (isLanguageAlternativeValue(name, value)) {
    const entries = Object.entries(value) as [string, string][];
    entries.sort(([left], [right]) => Number(right.toLowerCase() === 'x-default') - Number(left.toLowerCase() === 'x-default'));
    const items = entries
      .map(([language, text]) => `<rdf:li xml:lang="${language.toLowerCase() === 'x-default' ? 'x-default' : language}">${xmlEscape(text)}</rdf:li>`)
      .join('');
    return `<${name}><rdf:Alt>${items}</rdf:Alt></${name}>`;
  }
  if (XMP_STRUCT_LIST_SHAPES[name]) {
    if (!Array.isArray(value) || !value.every((item) => isXmpStructValue(item) && isValidXmpStruct(name, item))) {
      throw new UnsupportedFormatError(`XMP property ${name} requires a list of struct values`);
    }
    const items = (value as TagStructValue[]).map((item) =>
      `<rdf:li rdf:parseType="Resource">${serializeXmpStructFields(name, item)}</rdf:li>`
    ).join('');
    const shape = XMP_STRUCT_LIST_SHAPES[name];
    const kind = shape === 'seq' ? 'Seq' : shape === 'alt' ? 'Alt' : 'Bag';
    return `<${name}><rdf:${kind}>${items}</rdf:${kind}></${name}>`;
  }
  if (XMP_STRUCT_PROPERTIES.has(name)) {
    if (!isXmpStructValue(value) || !isValidXmpStruct(name, value)) {
      throw new UnsupportedFormatError(`XMP property ${name} requires a struct value`);
    }
    return `<${name} rdf:parseType="Resource">${serializeXmpStructFields(name, value)}</${name}>`;
  }
  if (isXmpStructValue(value)) {
    throw new UnsupportedFormatError(`XMP property ${name} does not accept a struct value`);
  }
  if (Array.isArray(value) && value.some(isXmpStructValue)) {
    throw new UnsupportedFormatError(`XMP property ${name} does not accept a list of structs`);
  }
  const enumValues = XMP_ENUMS[name];
  if (enumValues) {
    const resolveEnumCode = (candidate: string | number): string | undefined => {
      if (typeof candidate === 'number') {
        return Number.isInteger(candidate) && enumValues[String(candidate)] !== undefined
          ? String(candidate)
          : undefined;
      }
      const input = candidate.trim().toLowerCase();
      const entries = Object.entries(enumValues);
      const exactCodes = entries.filter(([code]) => code.toLowerCase() === input);
      const exactLabels = entries.filter(([, label]) => label.toLowerCase() === input);
      const matches = exactCodes.length
        ? exactCodes
        : exactLabels.length
          ? exactLabels
          : entries.filter(([, label]) => label.toLowerCase().startsWith(input));
      return matches.length === 1 ? matches[0]![0] : undefined;
    };
    if (Array.isArray(value)) {
      const storageValues = value.map((item) => {
        if (raw) return typeof item === 'number' && Number.isFinite(item) ? String(item) : undefined;
        return typeof item === 'string' || typeof item === 'number' ? resolveEnumCode(item) : undefined;
      });
      if (storageValues.some((item) => item === undefined)) {
        throw new UnsupportedFormatError(`invalid value for XMP property ${name}`);
      }
      value = storageValues as string[];
    } else {
      const rawValue = raw
        ? typeof value === 'number' && Number.isFinite(value)
          ? String(value)
          : undefined
        : typeof value === 'string' || typeof value === 'number'
          ? resolveEnumCode(value)
          : undefined;
      if (raw && rawValue === undefined) {
        throw new UnsupportedFormatError(`raw XMP enum ${name} requires a numeric value`);
      }
      if (rawValue === undefined) throw new UnsupportedFormatError(`invalid value for XMP property ${name}`);
      return `<${name}>${xmlEscape(rawValue)}</${name}>`;
    }
  }
  const shape = SHAPES[name] ?? (LANGUAGE_ALTERNATIVES.has(name) ? 'alt' : 'scalar');
  if (shape === 'alt') {
    if (Array.isArray(value) && value.length > 1) {
      throw new UnsupportedFormatError(`XMP property ${name} requires language-keyed alternatives`);
    }
    const item = Array.isArray(value) ? value[0] ?? '' : value;
    if (isXmpStructValue(item)) throw new UnsupportedFormatError(`XMP property ${name} does not accept a struct value`);
    return `<${name}><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(xmpScalar(item))}</rdf:li></rdf:Alt></${name}>`;
  }
  if (shape === 'bag' || shape === 'seq') {
    const items = (Array.isArray(value) ? value : [value])
      .map((v) => {
        if (isXmpStructValue(v)) throw new UnsupportedFormatError(`XMP property ${name} does not accept struct items`);
        return `<rdf:li>${xmlEscape(xmpScalar(v))}</rdf:li>`;
      })
      .join('');
    const kind = shape === 'bag' ? 'Bag' : 'Seq';
    return `<${name}><rdf:${kind}>${items}</rdf:${kind}></${name}>`;
  }
  if (Array.isArray(value)) {
    throw new UnsupportedFormatError(`XMP property ${name} requires a scalar value`);
  }
  return `<${name}>${xmlEscape(xmpScalar(value))}</${name}>`;
}

function xmpScalar(value: string | number | boolean): string {
  return typeof value === 'boolean' ? (value ? 'True' : 'False') : String(value);
}

function normalizeXmpDate(value: string): string {
  const match = value.trim().match(
    /^(\d{4})[-:](\d{2})[-:](\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/i,
  );
  if (!match) return value;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? 0);
  const minute = Number(match[5] ?? 0);
  const second = Number(match[6] ?? 0);
  const offset = match[8];
  const offsetDigits = offset && offset.toUpperCase() !== 'Z' ? offset.slice(1).replace(':', '') : '';
  const offsetHour = offsetDigits ? Number(offsetDigits.slice(0, 2)) : 0;
  const offsetMinute = offsetDigits ? Number(offsetDigits.slice(2, 4)) : 0;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]! ||
    hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59
  ) throw new UnsupportedFormatError(`invalid XMP date value: ${value}`);
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  if (!match[4]) return date;
  const timezone = match[8]?.replace(/([+-]\d{2})(\d{2})$/, '$1:$2') ?? '';
  return `${date}T${match[4]}:${match[5]}:${match[6]}${match[7] ?? ''}${timezone}`;
}

function ensureRdfNamespace(xml: string, prefix: string, ns: string): string {
  const attr = `xmlns:${prefix}`;
  const escapedAttr = attr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`\\b${escapedAttr}\\s*=(?:"[^"]*"|'[^']*')`).test(xml)) return xml;
  const rdfOpen = xml.indexOf('<rdf:RDF');
  if (rdfOpen === -1) {
    throw new UnsupportedFormatError('XMP packet has no rdf:RDF element');
  }
  const openEnd = xml.indexOf('>', rdfOpen);
  return `${xml.slice(0, openEnd)} ${attr}="${ns}"${xml.slice(openEnd)}`;
}

interface DescriptionSpan {
  openStart: number;
  openEnd: number;
  closeStart: number;
  closeEnd: number;
  selfClosing: boolean;
}

function topLevelDescriptionSpans(xml: string): DescriptionSpan[] {
  const spans: DescriptionSpan[] = [];
  const tokenRe = /<\/?rdf:Description(?:\s[^>]*)?>/g;
  let depth = 0;
  let current: Omit<DescriptionSpan, 'closeStart' | 'closeEnd'> | undefined;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(xml)) !== null) {
    const token = match[0];
    if (token.startsWith('</')) {
      depth--;
      if (depth === 0 && current) {
        spans.push({ ...current, closeStart: match.index, closeEnd: tokenRe.lastIndex });
        current = undefined;
      }
    } else if (depth === 0) {
      const selfClosing = /\/\s*>$/.test(token);
      current = { openStart: match.index, openEnd: tokenRe.lastIndex, selfClosing };
      if (selfClosing) {
        spans.push({ ...current, closeStart: tokenRe.lastIndex, closeEnd: tokenRe.lastIndex });
        current = undefined;
      } else {
        depth = 1;
      }
    } else if (!token.endsWith('/>')) {
      depth++;
    }
  }
  return spans;
}

function upsertXmpProperty(xml: string, name: string, element: string): string {
  const descriptions = topLevelDescriptionSpans(xml);
  if (descriptions.length === 0) return xml;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const attrRe = new RegExp(`\\s${escaped}\\s*=\\s*(?:"[^"]*"|'[^']*')`);
  const elementPattern = `<${escaped}(?:\\s[^>]*)?\\s*/>|<${escaped}(?:\\s[^>]*)?>[\\s\\S]*?</${escaped}>`;
  const replacementIndex = descriptions.findIndex((span) =>
    !span.selfClosing && new RegExp(elementPattern).test(xml.slice(span.openEnd, span.closeStart)),
  );
  for (let index = descriptions.length - 1; index >= 0; index--) {
    const span = descriptions[index]!;
    let openTag = xml.slice(span.openStart, span.openEnd).replace(attrRe, '');
    let body = span.selfClosing ? '' : xml.slice(span.openEnd, span.closeStart);
    const elementRe = new RegExp(elementPattern, 'g');
    let replaced = false;
    body = body.replace(elementRe, (match) => {
      if (index === replacementIndex && !replaced) {
        replaced = true;
        return element;
      }
      return '';
    });
    const replacement = index === 0
      ? span.selfClosing
        ? `${openTag.replace(/\/\s*>$/, '>')}${element}</rdf:Description>`
        : `${openTag}${body}${replacementIndex === -1 ? element : ''}${xml.slice(span.closeStart, span.closeEnd)}`
      : span.selfClosing
        ? openTag
        : `${openTag}${body}${xml.slice(span.closeStart, span.closeEnd)}`;
    xml = xml.slice(0, span.openStart) + replacement + xml.slice(span.closeEnd);
  }
  return xml;
}

/**
 * Bare-alias map (prefix optional, case-insensitive) mirroring the JPEG
 * merge-writer convention. Keys are lowercased.
 */
const BARE_ALIASES: Record<string, string> = {
  rights: 'dc:rights',
  webstatement: 'xmpRights:WebStatement',
  subject: 'dc:subject',
  keywords: 'dc:subject',
  title: 'dc:title',
  description: 'dc:description',
  metadatadate: 'xmp:MetadataDate',
  creator: 'dc:creator',
  credit: 'photoshop:Credit',
  headline: 'photoshop:Headline',
};

/**
 * Resolves a write-tag key to an XMP property request. Accepts
 * 'XMP-dc:Subject', 'xmp-dc:subject', or a bare alias ('Subject',
 * 'Keywords'). Returns undefined when the key is not an XMP tag.
 */
export function toXmpPropertyRequest(
  key: string,
  value: TagValue,
): XmpPropertyRequest | undefined {
  const raw = key.endsWith('#');
  const name = toXmpPropertyName(raw ? key.slice(0, -1) : key);
  if (!name) return undefined;
  if (XMP_STRUCT_LIST_SHAPES[name]) {
    if (!Array.isArray(value) || !value.every((item) =>
      isXmpStructValue(item) && isValidXmpStruct(name, item)
    )) return undefined;
    return raw ? undefined : { name, value: value as TagStructValue[] };
  }
  if (isXmpStructValue(value)) {
    if (isLanguageAlternativeValue(name, value)) return raw ? undefined : { name, value };
    if (!XMP_STRUCT_PROPERTIES.has(name)) return undefined;
    if (!isValidXmpStruct(name, value)) return undefined;
    return raw ? undefined : { name, value };
  }
  const ok =
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    typeof value === 'boolean' ||
    (Array.isArray(value) && value.every((v) =>
      typeof v === 'string' || typeof v === 'boolean' ||
      (typeof v === 'number' && Number.isFinite(v))
    ));
  if (!ok) return undefined;
  return { name, value: value as XmpWriteValue, ...(raw ? { raw: true } : {}) };
}

export function toXmpPropertyName(key: string): string | undefined {
  const lower = key.toLowerCase();
  let name = BARE_ALIASES[lower];
  if (name === undefined && lower.startsWith('xmp-')) {
    const qualified = key.slice(4);
    const colon = qualified.indexOf(':');
    if (colon < 1 || colon === qualified.length - 1) return undefined;
    const requestedPrefix = qualified.slice(0, colon);
    const prefix = Object.keys(NAMESPACES).find(
      (candidate) => candidate.toLowerCase() === requestedPrefix.toLowerCase(),
    ) ?? XMP_GROUP_PREFIXES[requestedPrefix.toLowerCase()];
    if (!prefix) return undefined;
    const property = qualified.slice(colon + 1);
    name = XMP_PROPERTY_IDS[`${prefix}:${property}`.toLowerCase()] ??
      `${prefix}:${prefix === 'dc' ? property.toLowerCase() : property}`;
  }
  if (!name || !name.includes(':')) return undefined;
  return name;
}

/** Removes matching top-level XMP properties without rewriting other XML. */
export function deleteXmpProperties(packet: string, names: string[]): string | null {
  if (names.length === 0) return packet;
  let out = packet;
  for (const inputName of names) {
    const name = canonicalXmpPropertyName(inputName);
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const attrRe = new RegExp(`\\s${escaped}\\s*=\\s*(?:"[^"]*"|'[^']*')`);
    const propertyRe = new RegExp(
      `<${escaped}(?:\\s[^>]*)?\\s*/>|<${escaped}(?:\\s[^>]*)?>[\\s\\S]*?</${escaped}>`,
      'g',
    );
    const descriptions = topLevelDescriptionSpans(out);
    for (let index = descriptions.length - 1; index >= 0; index--) {
      const span = descriptions[index]!;
      const openTag = out.slice(span.openStart, span.openEnd).replace(attrRe, '');
      const body = span.selfClosing
        ? ''
        : out.slice(span.openEnd, span.closeStart).replace(propertyRe, '');
      const replacement = span.selfClosing
        ? openTag
        : `${openTag}${body}${out.slice(span.closeStart, span.closeEnd)}`;
      out = out.slice(0, span.openStart) + replacement + out.slice(span.closeEnd);
    }
  }
  const descriptions = topLevelDescriptionSpans(out);
  if (descriptions.length === 0) return null;
  const hasContent = descriptions.some((span) => {
    const openTag = out.slice(span.openStart, span.openEnd);
    const attributes = openTag
      .replace(/^<rdf:Description\b|\/?\s*>$/g, '')
      .replace(/\sxmlns(?::[\w.-]+)?=(?:"[^"]*"|'[^']*')/g, '')
      .replace(/\srdf:(?:about|ID|nodeID)=(?:"[^"]*"|'[^']*')/g, '')
      .trim();
    const body = span.selfClosing
      ? ''
      : out.slice(span.openEnd, span.closeStart).replace(/<!--[\s\S]*?-->/g, '').trim();
    return attributes.length > 0 || body.length > 0;
  });
  return hasContent ? out : null;
}

/**
 * Splices the requested properties into an existing XMP packet without
 * re-serializing anything else: namespaces are added to rdf:RDF when
 * missing, properties are upserted inside the first top-level
 * rdf:Description (replacing the previous element of the same property).
 */
export function mergeXmpProperties(
  packet: string,
  props: XmpPropertyRequest[],
): string {
  props = props.map((prop) => ({ ...prop, name: canonicalXmpPropertyName(prop.name) }));
  let out = packet;
  for (const { name, value } of props) {
    const prefix = name.slice(0, name.indexOf(':'));
    const ns = NAMESPACES[prefix];
    if (!ns) {
      throw new UnsupportedFormatError(`unknown XMP namespace prefix: ${prefix}`);
    }
    out = ensureRdfNamespace(out, prefix, ns);
    const structs = isLanguageAlternativeValue(name, value) ? undefined : xmpStructValues(value);
    if (structs) {
      for (const fieldName of structs.flatMap(xmpStructFieldNames)) {
        const field = structFieldName(fieldName)!;
        out = ensureRdfNamespace(out, field.prefix, NAMESPACES[field.prefix]!);
      }
    }
  }
  for (const { name, value, raw } of props) {
    out = upsertXmpProperty(out, name, serializeXmpProperty(name, value, raw));
  }
  return out;
}

/**
 * Minimal conformant XMP packet carrying exactly the requested properties:
 * xpacket prolog/epilog with padding, x:xmpmeta, rdf:RDF declaring every
 * written namespace, one rdf:Description with rdf:about="".
 */
export function buildXmpPropertiesPacket(props: XmpPropertyRequest[]): string {
  props = props.map((prop) => ({ ...prop, name: canonicalXmpPropertyName(prop.name) }));
  const used: Record<string, string> = {};
  for (const { name, value } of props) {
    const prefix = name.slice(0, name.indexOf(':'));
    const ns = NAMESPACES[prefix];
    if (!ns) {
      throw new UnsupportedFormatError(`unknown XMP namespace prefix: ${prefix}`);
    }
    used[prefix] = ns;
    const structs = isLanguageAlternativeValue(name, value) ? undefined : xmpStructValues(value);
    if (structs) {
      for (const fieldName of structs.flatMap(xmpStructFieldNames)) {
        const field = structFieldName(fieldName)!;
        used[field.prefix] = NAMESPACES[field.prefix]!;
      }
    }
  }
  const nsDecls = Object.entries(used)
    .map(([p, ns]) => `xmlns:${p}="${ns}"`)
    .join(' ');
  const children = props
    .map(({ name, value, raw }) => serializeXmpProperty(name, value, raw))
    .join('');
  return (
    `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="exiftool-ts">\n` +
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"${nsDecls ? ` ${nsDecls}` : ''}>\n` +
    `<rdf:Description rdf:about="">${children}</rdf:Description>\n` +
    `</rdf:RDF>\n` +
    `</x:xmpmeta>\n` +
    `<?xpacket end=" w"?>`
  );
}

/**
 * Merges properties into an existing packet, or builds a fresh one when
 * `packet` is null. The single entry point containers call.
 */
export function writeXmpPacket(
  packet: string | null,
  props: XmpPropertyRequest[],
): string {
  if (props.length === 0) return packet ?? '';
  return packet ? mergeXmpProperties(packet, props) : buildXmpPropertiesPacket(props);
}
