import { UnsupportedFormatError } from './writers.js';
import type { TagValue } from '../types.js';

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

export type XmpWriteValue = string | string[];

export interface XmpPropertyRequest {
  /** Qualified property name, e.g. 'dc:subject' or 'xmpRights:WebStatement'. */
  name: string;
  value: XmpWriteValue;
}

const NAMESPACES: Record<string, string> = {
  dc: 'http://purl.org/dc/elements/1.1/',
  xmp: 'http://ns.adobe.com/xap/1.0/',
  xmpRights: 'http://ns.adobe.com/xap/1.0/rights/',
  photoshop: 'http://ns.adobe.com/xap/1.0/photoshop/',
  xmpMM: 'http://ns.adobe.com/xap/1.0/mm/',
  exif: 'http://ns.adobe.com/exif/1.0/',
  tiff: 'http://ns.adobe.com/tiff/1.0/',
  aux: 'http://ns.adobe.com/exif/1.0/aux/',
  Iptc4xmpCore: 'http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/',
  crs: 'http://ns.adobe.com/camera-raw-settings/1.0/',
};

/**
 * Value shapes by property. Properties not listed default to: scalar for
 * string values, Bag for arrays. Lang-alts serialize as rdf:Alt with a
 * single x-default item; ordered lists as rdf:Seq.
 */
const SHAPES: Record<string, XmpPropertyShape> = {
  'dc:rights': 'alt',
  'dc:title': 'alt',
  'dc:description': 'alt',
  'dc:creator': 'seq',
  'dc:subject': 'bag',
};

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Serializes one property to its element form. Array values are per-shape. */
export function serializeXmpProperty(name: string, value: XmpWriteValue): string {
  const shape = SHAPES[name] ?? 'scalar';
  if (shape === 'alt') {
    const item = typeof value === 'string' ? value : value[0] ?? '';
    return `<${name}><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(item)}</rdf:li></rdf:Alt></${name}>`;
  }
  if (shape === 'bag' || shape === 'seq') {
    const items = (Array.isArray(value) ? value : [value])
      .map((v) => `<rdf:li>${xmlEscape(v)}</rdf:li>`)
      .join('');
    const kind = shape === 'bag' ? 'Bag' : 'Seq';
    return `<${name}><rdf:${kind}>${items}</rdf:${kind}></${name}>`;
  }
  if (Array.isArray(value)) {
    throw new UnsupportedFormatError(`XMP property ${name} requires a scalar value`);
  }
  return `<${name}>${xmlEscape(value)}</${name}>`;
}

function ensureRdfNamespace(xml: string, prefix: string, ns: string): string {
  const attr = `xmlns:${prefix}`;
  if (xml.includes(`${attr}="`)) return xml;
  const rdfOpen = xml.indexOf('<rdf:RDF');
  if (rdfOpen === -1) {
    throw new UnsupportedFormatError('XMP packet has no rdf:RDF element');
  }
  const openEnd = xml.indexOf('>', rdfOpen);
  return `${xml.slice(0, openEnd)} ${attr}="${ns}"${xml.slice(openEnd)}`;
}

/**
 * Span of the first TOP-LEVEL rdf:Description (Camera Raw packets nest
 * further rdf:Description elements inside crs structures — those must be
 * left untouched). Returns [openTagEnd, closeTagStart], or undefined.
 */
function topLevelDescriptionSpan(xml: string): [number, number] | undefined {
  const open = xml.indexOf('<rdf:Description');
  if (open === -1) return undefined;
  const openEnd = xml.indexOf('>', open);
  if (openEnd === -1) return undefined;
  const tokenRe = /<\/?rdf:Description(?:\s[^>]*)?>/g;
  tokenRe.lastIndex = openEnd + 1;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(xml)) !== null) {
    if (m[0].startsWith('</')) {
      depth--;
      if (depth === 0) return [openEnd + 1, m.index];
    } else if (!m[0].endsWith('/>')) {
      depth++;
    }
  }
  return undefined;
}

function upsertXmpProperty(xml: string, name: string, element: string): string {
  // Attribute form on the top-level description open tag: drop it first
  // (element form wins), so the span below is computed on the final xml.
  const descOpen = xml.indexOf('<rdf:Description');
  if (descOpen !== -1) {
    const descClose = xml.indexOf('>', descOpen);
    const tag = xml.slice(descOpen, descClose);
    const attrRe = new RegExp(`\\s${name}="[^"]*"`);
    if (attrRe.test(tag)) {
      xml = xml.slice(0, descOpen) + tag.replace(attrRe, '') + xml.slice(descClose);
    }
  }
  const span = topLevelDescriptionSpan(xml);
  if (!span) return xml;
  const [start, end] = span;
  const inner = xml.slice(start, end);
  // Existing element form inside the top-level description: replace it.
  const elRe = new RegExp(`<${name}(?:\\s[^>]*)?/>|<${name}(?:\\s[^>]*)?>[\\s\\S]*?</${name}>`);
  if (elRe.test(inner)) {
    return xml.slice(0, start) + inner.replace(elRe, element) + xml.slice(end);
  }
  // Insert before the top-level description's closing tag.
  return xml.slice(0, end) + element + xml.slice(end);
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
  const lower = key.toLowerCase();
  const name = lower.startsWith('xmp-') ? lower.slice(4) : BARE_ALIASES[lower];
  if (!name || !name.includes(':')) return undefined;
  const ok =
    typeof value === 'string' ||
    (Array.isArray(value) && value.every((v) => typeof v === 'string'));
  if (!ok) return undefined;
  return { name, value: value as XmpWriteValue };
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
  let out = packet;
  for (const { name } of props) {
    const prefix = name.slice(0, name.indexOf(':'));
    const ns = NAMESPACES[prefix];
    if (!ns) {
      throw new UnsupportedFormatError(`unknown XMP namespace prefix: ${prefix}`);
    }
    out = ensureRdfNamespace(out, prefix, ns);
  }
  for (const { name, value } of props) {
    out = upsertXmpProperty(out, name, serializeXmpProperty(name, value));
  }
  return out;
}

/**
 * Minimal conformant XMP packet carrying exactly the requested properties:
 * xpacket prolog/epilog with padding, x:xmpmeta, rdf:RDF declaring every
 * written namespace, one rdf:Description with rdf:about="".
 */
export function buildXmpPropertiesPacket(props: XmpPropertyRequest[]): string {
  const used: Record<string, string> = {};
  for (const { name } of props) {
    const prefix = name.slice(0, name.indexOf(':'));
    const ns = NAMESPACES[prefix];
    if (!ns) {
      throw new UnsupportedFormatError(`unknown XMP namespace prefix: ${prefix}`);
    }
    used[prefix] = ns;
  }
  const nsDecls = Object.entries(used)
    .map(([p, ns]) => `xmlns:${p}="${ns}"`)
    .join(' ');
  const children = props
    .map(({ name, value }) => serializeXmpProperty(name, value))
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
