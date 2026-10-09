import type { ContainerWriter, TagValue, WriteOutcome } from '../types.js';
import { buildTiff } from '../exif/tiff-builder.js';
import { crc32 } from '../utils/crc32.js';
import { zlibSync } from 'fflate';
import { toXmpPropertyRequest, writeXmpPacket, type XmpPropertyRequest } from './xmp-writer.js';
import { mergeExifTiff, resolveMergeRequests } from './jpeg-merge.js';

/**
 * Error thrown when a format does not support writing tags.
 */
 export class UnsupportedFormatError extends Error {}

function u32be(arr: number[], v: number): void {
  arr.push((v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255);
}
function u32le(arr: number[], v: number): void {
  arr.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255);
}

/** JPEG: replaces every APP1 'Exif\0\0' segment with one rebuilt segment. */
export const jpegWriter: ContainerWriter = (original, tags) => {
  if (original.length < 4 || original[0] !== 0xFF || original[1] !== 0xD8) {
    throw new UnsupportedFormatError('not a JPEG stream');
  }
  const { bytes: tiff, written, skipped } = buildTiff(tags);
  const app1Payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // 'Exif\0\0'
  const segLen = app1Payload.length + 2;

  const parts: number[][] = [
    [0xFF, 0xD8],
    [0xFF, 0xE1, (segLen >> 8) & 255, segLen & 255, ...app1Payload],
  ];
  let pos = 2;
  while (pos + 4 <= original.length) {
    if (original[pos] !== 0xFF) break;
    const marker = original[pos + 1];
    if (marker === 0xDA || marker === 0xD9) {
      parts.push([...original.subarray(pos)]);
      pos = original.length;
      break;
    }
    if ((marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) {
      parts.push([0xFF, marker]);
      pos += 2;
      continue;
    }
    const segLenOrig = (original[pos + 2] << 8) | original[pos + 3];
    const isExifApp1 =
      marker === 0xE1 && segLenOrig >= 8 &&
      original[pos + 4] === 0x45 && original[pos + 5] === 0x78 &&
      original[pos + 6] === 0x69 && original[pos + 7] === 0x66 &&
      original[pos + 8] === 0x00 && original[pos + 9] === 0x00;
    if (!isExifApp1) {
      parts.push([...original.subarray(pos, pos + 2 + segLenOrig)]);
    }
    pos += 2 + segLenOrig;
  }

  return { bytes: new Uint8Array(parts.flat()), written, skipped };
};

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

const PNG_XMP_KEYWORD = 'XML:com.adobe.xmp';
const PNG_DATA_CHUNKS = new Set(['IDAT', 'JDAT', 'JDAA']);
const PNG_MOVABLE_METADATA = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf']);
const PNG_NO_LEAPFROG = new Set(['SAVE', 'SEEK', 'IHDR', 'JHDR', 'IEND', 'MEND', 'DHDR', 'BASI', 'CLON', 'PAST', 'SHOW', 'MAGN']);

const PNG_TEXT_TAGS: Record<string, string> = {
  title: 'Title',
  author: 'Author',
  description: 'Description',
  copyright: 'Copyright',
  'creation time': 'CreationTime',
  creationtime: 'CreationTime',
  software: 'Software',
  disclaimer: 'Disclaimer',
  warning: 'PNGWarning',
  source: 'Source',
  comment: 'Comment',
  collection: 'Collection',
  artist: 'Artist',
  document: 'Document',
  label: 'Label',
  make: 'Make',
  model: 'Model',
  parameters: 'Parameters',
  'aesthetic score': 'AestheticScore',
  aestheticscore: 'AestheticScore',
  'create-date': 'CreateDate',
  createdate: 'CreateDate',
  'modify-date': 'ModDate',
  moddate: 'ModDate',
  timestamp: 'TimeStamp',
  url: 'URL',
};

interface PngTextRequest {
  key: string;
  keyword: string;
  value: string | null;
  language?: string;
  encoding?: { type: 'tEXt' | 'zTXt' | 'iTXt'; compressed: boolean };
}
interface PngAncillaryRequest { key: string; tag: 'gamma' | 'srgb' | 'physX' | 'physY' | 'physUnit'; value: number | null }
interface PngTimeRequest { key: string; value: string | null }

function splitPngWriteTags(tags: Record<string, TagValue>): {
  exif: Record<string, TagValue>;
  xmp: XmpPropertyRequest[];
  xmpKeys: string[];
  text: PngTextRequest[];
  iccProfile?: { key: string; profile: Uint8Array | null };
  iccName?: { key: string; name: string };
  ancillary: PngAncillaryRequest[];
  time?: PngTimeRequest;
  skipped: string[];
} {
  const exif: Record<string, TagValue> = {};
  const xmp: XmpPropertyRequest[] = [];
  const xmpKeys: string[] = [];
  const text: PngTextRequest[] = [];
  const skipped: string[] = [];
  let iccProfile: { key: string; profile: Uint8Array | null } | undefined;
  let iccName: { key: string; name: string } | undefined;
  let time: PngTimeRequest | undefined;
  const ancillary: PngAncillaryRequest[] = [];
  for (const [key, value] of Object.entries(tags)) {
    if (/^(?:png:)?modifydate$/i.test(key)) {
      if (value === null || typeof value === 'string') time = { key, value };
      else skipped.push(key);
      continue;
    }
    const ancillaryName = key.toLowerCase().replace(/^png:/, '');
    const ancillaryNames: Record<string, PngAncillaryRequest['tag']> = {
      gamma: 'gamma',
      srgbrendering: 'srgb',
      pixelsperunitx: 'physX',
      pixelsperunity: 'physY',
      pixelunits: 'physUnit',
    };
    const ancillaryTag = ancillaryNames[ancillaryName];
    if (ancillaryTag) {
      let number: number | null | undefined;
      if (value === null) number = null;
      else if (ancillaryTag === 'physUnit' && typeof value === 'string') {
        const unit = value.trim().toLowerCase();
        number = unit === 'unknown' ? 0 : unit === 'meters' || unit === 'meter' ? 1 : undefined;
      } else if (ancillaryTag === 'srgb' && typeof value === 'string') {
        const intents: Record<string, number> = {
          perceptual: 0,
          'relative colorimetric': 1,
          saturation: 2,
          'absolute colorimetric': 3,
        };
        number = intents[value.trim().toLowerCase()];
      } else if (typeof value === 'number' || typeof value === 'string') {
        const parsed = Number(value);
        number = Number.isFinite(parsed) ? parsed : undefined;
      }
      const integer = ancillaryTag !== 'gamma';
      const max = ancillaryTag === 'srgb' ? 3 : ancillaryTag === 'physUnit' ? 1 : 0xffffffff;
      if (number === null || (number !== undefined && number > 0 &&
          (integer ? Number.isInteger(number) : Number.isFinite(1e5 / number)) && number >= 0 && number <= max)) {
        ancillary.push({ key, tag: ancillaryTag, value: number });
      } else {
        skipped.push(key);
      }
      continue;
    }
    if (/^(?:png:)?icc_profile$/i.test(key)) {
      if (value === null || value instanceof Uint8Array) iccProfile = { key, profile: value };
      else skipped.push(key);
      continue;
    }
    if (/^png:profilename$/i.test(key)) {
      if (typeof value === 'string') iccName = { key, name: value };
      else skipped.push(key);
      continue;
    }
    const explicitPngGroup = /^png:/i.test(key);
    const textKey = explicitPngGroup ? key.slice(4).toLowerCase() : key.toLowerCase();
    const textBase = Object.keys(PNG_TEXT_TAGS)
      .sort((a, b) => b.length - a.length)
      .find((candidate) => textKey === candidate || textKey.startsWith(`${candidate}-`));
    const language = textBase && textKey.length > textBase.length ? textKey.slice(textBase.length + 1) : undefined;
    const keyword = (explicitPngGroup || !/^(make|model|artist|title|description|copyright)$/.test(textBase ?? textKey))
      ? (textBase ? PNG_TEXT_TAGS[textBase] : undefined)
      : undefined;
    if (keyword) {
      if (value === null || typeof value === 'string') {
        if (language && !/^[a-z]{2}(?:-[a-z0-9]{2,8})*$/i.test(language)) skipped.push(key);
        else text.push({ key, keyword, value, language });
      }
      else skipped.push(key);
      continue;
    }
    const property = toXmpPropertyRequest(key, value);
    if (property) {
      xmp.push(property);
      xmpKeys.push(key);
    } else {
      exif[key] = value;
    }
  }
  return { exif, xmp, xmpKeys, text, iccProfile, iccName, ancillary, time, skipped };
}

function splitWebpWriteTags(tags: Record<string, TagValue>): {
  exif: Record<string, TagValue>;
  xmp: XmpPropertyRequest[];
  xmpKeys: string[];
  iccProfile?: { key: string; profile: Uint8Array | null };
  skipped: string[];
} {
  const split = splitWriteTags(tags);
  const exif = { ...split.exif };
  const skipped = [...split.skipped];
  let iccProfile: { key: string; profile: Uint8Array | null } | undefined;
  for (const [key, value] of Object.entries(exif)) {
    if (!/^(?:webp:)?icc_profile$/i.test(key)) continue;
    delete exif[key];
    if (value === null || value instanceof Uint8Array) iccProfile = { key, profile: value };
    else skipped.push(key);
  }
  return { ...split, exif, iccProfile, skipped };
}

function pngTimeChunk(value: string): Uint8Array {
  const match = value.trim().match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) throw new UnsupportedFormatError(`invalid PNG ModifyDate: ${value}`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (year < 1 || year > 0xffff || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day || hour > 23 || minute > 59 || second > 60) {
    throw new UnsupportedFormatError(`invalid PNG ModifyDate: ${value}`);
  }
  const data = new Uint8Array(7);
  const view = new DataView(data.buffer);
  view.setUint16(0, year, false);
  data[2] = month;
  data[3] = day;
  data[4] = hour;
  data[5] = minute;
  data[6] = second;
  return data;
}

function pngTextChunk(
  keyword: string,
  value: string,
  language?: string,
  compress = false,
  encoding?: PngTextRequest['encoding'],
): { type: string; data: Uint8Array } {
  const shouldCompress = compress || encoding?.compressed === true;
  if (shouldCompress) {
    const latin1 = /^[\x00-\xff]*$/.test(value);
    const text = encoding?.type === 'zTXt' && latin1
      ? new Uint8Array([...value].map((character) => character.charCodeAt(0)))
      : new TextEncoder().encode(value);
    const compressed = zlibSync(text);
    if (compressed.length < text.length || encoding?.compressed) {
      const useItxt = encoding?.type === 'iTXt' ||
        (encoding?.type !== 'zTXt' && (language || /[^\x00-\x7f]/.test(value)));
      if (useItxt) {
        const prefix = new TextEncoder().encode(`${keyword}\0\u0001\0${language ?? ''}\0\0`);
        const data = new Uint8Array(prefix.length + compressed.length);
        data.set(prefix);
        data.set(compressed, prefix.length);
        return { type: 'iTXt', data };
      }
      const key = new TextEncoder().encode(keyword);
      const data = new Uint8Array(key.length + 2 + compressed.length);
      data.set(key);
      data[key.length + 1] = 0;
      data.set(compressed, key.length + 2);
      return { type: 'zTXt', data };
    }
  }
  if (encoding?.type === 'iTXt') {
    const prefix = new TextEncoder().encode(language
      ? `${keyword}\0\0\0${language}\0\0`
      : `${keyword}\0\0\0\0\0`);
    const text = new TextEncoder().encode(value);
    const data = new Uint8Array(prefix.length + text.length);
    data.set(prefix);
    data.set(text, prefix.length);
    return { type: 'iTXt', data };
  }
  if (!language && /^[\x00-\xff]*$/.test(value)) {
    const key = new TextEncoder().encode(keyword);
    const text = new Uint8Array([...value].map((character) => character.charCodeAt(0)));
    const data = new Uint8Array(key.length + 1 + text.length);
    data.set(key);
    data.set(text, key.length + 1);
    return { type: 'tEXt', data };
  }
  const prefix = new TextEncoder().encode(language
    ? `${keyword}\0\0\0${language}\0\0`
    : `${keyword}\0\0\0\0\0`);
  const text = new TextEncoder().encode(value);
  const data = new Uint8Array(prefix.length + text.length);
  data.set(prefix);
  data.set(text, prefix.length);
  return { type: 'iTXt', data };
}

function pngTextIdentifier(type: string, data: Uint8Array): string | undefined {
  if (type !== 'tEXt' && type !== 'zTXt' && type !== 'iTXt') return undefined;
  const separator = data.indexOf(0);
  if (separator <= 0) return undefined;
  const keyword = new TextDecoder().decode(data.subarray(0, separator)).toLowerCase();
  if (type !== 'iTXt') return `${keyword}\0`;
  const languageStart = separator + 3;
  const languageEnd = data.indexOf(0, languageStart);
  if (languageEnd < 0) return undefined;
  const language = new TextDecoder().decode(data.subarray(languageStart, languageEnd)).toLowerCase();
  return `${keyword}\0${language}`;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let offset = 0; offset < data.length; offset += 5552) {
    const end = Math.min(offset + 5552, data.length);
    for (let index = offset; index < end; index++) {
      a += data[index]!;
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function zlibStored(data: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(data.length / 0xffff));
  const out = new Uint8Array(2 + data.length + blocks * 5 + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let inputOffset = 0;
  let outputOffset = 2;
  for (let block = 0; block < blocks; block++) {
    const length = Math.min(0xffff, data.length - inputOffset);
    out[outputOffset++] = block === blocks - 1 ? 1 : 0;
    out[outputOffset++] = length & 0xff;
    out[outputOffset++] = length >> 8;
    const inverse = (~length) & 0xffff;
    out[outputOffset++] = inverse & 0xff;
    out[outputOffset++] = inverse >> 8;
    out.set(data.subarray(inputOffset, inputOffset + length), outputOffset);
    inputOffset += length;
    outputOffset += length;
  }
  const checksum = adler32(data);
  out[outputOffset++] = checksum >>> 24;
  out[outputOffset++] = checksum >>> 16;
  out[outputOffset++] = checksum >>> 8;
  out[outputOffset++] = checksum;
  return out.subarray(0, outputOffset);
}

function pngIccChunk(name: string, profile: Uint8Array): { type: string; data: Uint8Array } {
  const codepoints = [...name].map((character) => character.codePointAt(0)!);
  if (codepoints.length < 1 || codepoints.length > 79 || codepoints.some((codepoint) => codepoint === 0 || codepoint > 0xff)) {
    throw new UnsupportedFormatError('PNG ICC profile name must be 1 to 79 Latin-1 bytes');
  }
  const keyword = new Uint8Array(codepoints);
  const compressed = zlibStored(profile);
  const data = new Uint8Array(keyword.length + 2 + compressed.length);
  data.set(keyword);
  data[keyword.length + 1] = 0;
  data.set(compressed, keyword.length + 2);
  return {
    type: 'iCCP',
    data,
  };
}

/**
 * Splits flat write tags into EXIF-tag requests and XMP property requests
 * ('XMP-group:Property' keys or bare aliases).
 */
export function splitWriteTags(tags: Record<string, TagValue>): {
  exif: Record<string, TagValue>;
  xmp: XmpPropertyRequest[];
  xmpKeys: string[];
  skipped: string[];
} {
  const exif: Record<string, TagValue> = {};
  const xmp: XmpPropertyRequest[] = [];
  const xmpKeys: string[] = [];
  const skipped: string[] = [];
  for (const [key, value] of Object.entries(tags)) {
    const prop = toXmpPropertyRequest(key, value);
    if (prop) {
      xmp.push(prop);
      xmpKeys.push(key);
    } else {
      exif[key] = value;
    }
  }
  return { exif, xmp, xmpKeys, skipped };
}

/** PNG iTXt chunk carrying an uncompressed XMP packet (XMP spec §1.1.1). */
function pngXmpItxt(packet: string): { type: string; data: Uint8Array } {
  const text = new TextEncoder().encode(packet);
  const prefix = new TextEncoder().encode(`${PNG_XMP_KEYWORD}\0\0\0\0\0`);
  const data = new Uint8Array(prefix.length + text.length);
  data.set(prefix);
  data.set(text, prefix.length);
  return { type: 'iTXt', data };
}

/**
 * PNG: drops replaced metadata chunks, inserts new chunks after IHDR, and
 * moves eligible text/EXIF chunks found after image data before the first
 * data chunk. The XMP iTXt is uncompressed with keyword XML:com.adobe.xmp.
 */
export const pngWriter: ContainerWriter = (original, tags, options) => {
  for (let i = 0; i < 8; i++) {
    if (original[i] !== PNG_SIG[i]) throw new UnsupportedFormatError('not a PNG stream');
  }
  const { exif, xmp, xmpKeys, iccProfile, iccName, text, ancillary, time, skipped } = splitPngWriteTags(tags);
  const dv = new DataView(original.buffer, original.byteOffset, original.byteLength);

  const kept: Array<{ type: string; data: Uint8Array }> = [];
  let existingXmp: string | null = null;
  let inserted = false;
  const written: string[] = [];
  const textByKeyword = new Map(text.map((request) => [
    `${request.keyword.toLowerCase()}\0${request.language?.toLowerCase() ?? ''}`,
    request,
  ]));
  let existingExifTiff: Uint8Array | undefined;
  let scanPos = 8;
  while (scanPos + 12 <= original.length) {
    const length = dv.getUint32(scanPos, false);
    if (scanPos + 12 + length > original.length) break;
    const type = String.fromCharCode(...original.subarray(scanPos + 4, scanPos + 8));
    const data = original.subarray(scanPos + 8, scanPos + 8 + length);
    if (type === 'eXIf' && !existingExifTiff) existingExifTiff = data.slice();
    const identifier = pngTextIdentifier(type, data);
    const request = identifier ? textByKeyword.get(identifier) : undefined;
    if (request && !request.encoding) {
      const separator = data.indexOf(0);
      request.encoding = {
        type: type as 'tEXt' | 'zTXt' | 'iTXt',
        compressed: type === 'zTXt' || (type === 'iTXt' && data[separator + 1] === 1),
      };
    }
    scanPos += length + 12;
  }
  const hoistedOffsets = new Set<number>();
  const hoistedChunks: Array<{ type: string; data: Uint8Array }> = [];
  let sawImageData = false;
  scanPos = 8;
  while (scanPos + 12 <= original.length) {
    const length = dv.getUint32(scanPos, false);
    if (scanPos + 12 + length > original.length) break;
    const type = String.fromCharCode(...original.subarray(scanPos + 4, scanPos + 8));
    if (sawImageData) {
      if (PNG_NO_LEAPFROG.has(type)) break;
      if (PNG_MOVABLE_METADATA.has(type)) {
        const data = original.subarray(scanPos + 8, scanPos + 8 + length);
        const identifier = pngTextIdentifier(type, data);
        const replacedText = identifier !== undefined && textByKeyword.has(identifier);
        const replacedXmp = type === 'iTXt' && xmp.length > 0 &&
          new TextDecoder().decode(data.subarray(0, data.indexOf(0))) === PNG_XMP_KEYWORD;
        if (!replacedText && !replacedXmp && !(type === 'eXIf' && Object.keys(exif).length > 0)) {
          hoistedOffsets.add(scanPos);
          hoistedChunks.push({ type, data: data.slice() });
        }
      }
    } else if (PNG_DATA_CHUNKS.has(type)) {
      sawImageData = true;
    }
    scanPos += length + 12;
  }
  let imageDataInserted = false;
  const writeGamma = ancillary.find((request) => request.tag === 'gamma');
  const writeSrgb = ancillary.find((request) => request.tag === 'srgb');
  const physRequests = ancillary.filter((request) => request.tag.startsWith('phys'));
  const writePhys = physRequests.length > 0;
  let pos = 8;
  while (pos + 12 <= original.length) {
    const chunkOffset = pos;
    const length = dv.getUint32(pos, false);
    const type = String.fromCharCode(...original.subarray(pos + 4, pos + 8));
    const data = original.slice(pos + 8, pos + 8 + length);
    if (pos + 12 + length > original.length) break; // truncated tail
    pos += 12 + length;
    if (type === 'IEND') continue;
    if (type === 'iCCP' && iccProfile) continue;
    if (type === 'sRGB' && iccProfile?.profile) continue;
    if (type === 'gAMA' && writeGamma) continue;
    if (type === 'sRGB' && writeSrgb) continue;
    if (type === 'pHYs' && writePhys) continue;
    if (type === 'tIME' && time) continue;
    if (type === 'eXIf' && Object.keys(exif).length > 0) continue;
    if (type === 'iTXt' && xmp.length > 0) {
      // Existing XMP packet (keyword XML:com.adobe.xmp): decode for merge.
      const kwEnd = data.indexOf(0);
      const keyword = kwEnd > 0 ? String.fromCharCode(...data.subarray(0, kwEnd)) : '';
      if (keyword === PNG_XMP_KEYWORD) {
        existingXmp = new TextDecoder().decode(data.subarray(kwEnd + 4));
        continue;
      }
    }
    const textIdentifier = pngTextIdentifier(type, data);
    if (textIdentifier) {
      const request = textByKeyword.get(textIdentifier);
      if (request) continue;
    }
    if (hoistedOffsets.has(chunkOffset)) {
      continue;
    }
    if ((PNG_DATA_CHUNKS.has(type) || type === 'IEND') && !imageDataInserted) {
      kept.push(...hoistedChunks);
      hoistedChunks.length = 0;
      imageDataInserted = true;
    }
    kept.push({ type, data });
    if (type === 'IHDR') {
      if (iccProfile?.profile) {
        const profileName = iccName?.name ?? 'icm';
        kept.push(pngIccChunk(profileName, iccProfile.profile));
        written.push(iccProfile.key);
        if (iccName) written.push(iccName.key);
      } else if (iccProfile) {
        written.push(iccProfile.key);
      } else if (iccName) {
        skipped.push(iccName.key);
      }
      if (writeSrgb?.value !== null && (writeSrgb || iccProfile?.profile)) {
        if (writeSrgb) {
          kept.push({ type: 'sRGB', data: new Uint8Array([writeSrgb.value!]) });
          written.push(writeSrgb.key);
        }
      }
      if (writeGamma) {
        if (writeGamma.value !== null) {
          const value = Math.round(100000 / writeGamma.value!);
          const data = new Uint8Array(4);
          new DataView(data.buffer).setUint32(0, value, false);
          kept.push({ type: 'gAMA', data });
        }
        written.push(writeGamma.key);
      }
      if (writePhys) {
        if (!physRequests.some((request) => request.value === null)) {
          const values = { x: 2834, y: 2834, unit: 1 };
          for (const request of physRequests) {
            if (request.tag === 'physX') values.x = request.value!;
            else if (request.tag === 'physY') values.y = request.value!;
            else values.unit = request.value!;
          }
          const data = new Uint8Array(9);
          const view = new DataView(data.buffer);
          view.setUint32(0, values.x, false);
          view.setUint32(4, values.y, false);
          data[8] = values.unit;
          kept.push({ type: 'pHYs', data });
        }
        written.push(...physRequests.map((request) => request.key));
      }
      if (time) {
        if (time.value !== null) kept.push({ type: 'tIME', data: pngTimeChunk(time.value) });
        written.push(time.key);
      }
      if (Object.keys(exif).length > 0) {
        let tiff: Uint8Array;
        let exifWritten: string[];
        let exifSkipped: string[];
        if (existingExifTiff) {
          const requests = resolveMergeRequests(exif);
          const merged = mergeExifTiff(existingExifTiff, requests.exif);
          tiff = merged.bytes;
          exifWritten = merged.written;
          exifSkipped = [...requests.skipped, ...merged.skipped];
        } else {
          const built = buildTiff(exif);
          tiff = built.bytes;
          exifWritten = built.written;
          exifSkipped = built.skipped;
        }
        kept.push({ type: 'eXIf', data: tiff });
        written.push(...exifWritten);
        skipped.push(...exifSkipped);
      }
      if (xmp.length > 0) {
        kept.push(pngXmpItxt(writeXmpPacket(existingXmp, xmp)));
        written.push(...xmpKeys);
      }
      for (const request of text) {
        if (request.value !== null) {
          kept.push(pngTextChunk(
            request.keyword,
            request.value,
            request.language,
            options?.compress,
            request.encoding,
          ));
        }
        written.push(request.key);
      }
      inserted = true;
    }
  }
  if (!inserted) throw new UnsupportedFormatError('PNG has no IHDR chunk');

  const out: number[] = [...PNG_SIG];
  for (const chunk of kept) {
    u32be(out, chunk.data.length);
    const crcInput = new Uint8Array(4 + chunk.data.length);
    for (let i = 0; i < 4; i++) crcInput[i] = chunk.type.charCodeAt(i);
    crcInput.set(chunk.data, 4);
    for (const c of chunk.type) out.push(c.charCodeAt(0));
    out.push(...chunk.data);
    u32be(out, crc32(crcInput));
  }
  u32be(out, 0);
  for (const c of 'IEND') out.push(c.charCodeAt(0));
  const iendCrc = new Uint8Array(4);
  iendCrc[0] = 0x49; iendCrc[1] = 0x45; iendCrc[2] = 0x4e; iendCrc[3] = 0x44;
  u32be(out, crc32(iendCrc));
  return { bytes: new Uint8Array(out), written, skipped };
};

/**
 * WebP: requires an existing VP8X chunk (sets its EXIF and XMP flags as
 * needed), removes old EXIF/XMP chunks and inserts fresh ones directly
 * after VP8X. XMP chunk ids are 'XMP ' with even-padded payloads.
 */
export const webpWriter: ContainerWriter = (original, tags) => {
  const riff = String.fromCharCode(...original.subarray(0, 4));
  const webp = String.fromCharCode(...original.subarray(8, 12));
  if (riff !== 'RIFF' || webp !== 'WEBP') {
    throw new UnsupportedFormatError('not a WebP stream');
  }
  const { exif, xmp, xmpKeys, iccProfile, skipped } = splitWebpWriteTags(tags);
  const writtenOut: string[] = [];
  const dv = new DataView(original.buffer, original.byteOffset, original.byteLength);

  interface Chunk { id: string; data: Uint8Array }
  const chunks: Chunk[] = [];
  let existingXmp: string | null = null;
  let pos = 12;
  while (pos + 8 <= original.length) {
    const id = String.fromCharCode(...original.subarray(pos, pos + 4));
    const size = dv.getUint32(pos + 4, true);
    const data = original.slice(pos + 8, pos + 8 + size);
    if (id === 'ICCP' && iccProfile) {
      pos += 8 + size + (size % 2);
      continue;
    }
    if (id === 'XMP ' && xmp.length > 0) {
      existingXmp = new TextDecoder().decode(data);
    } else {
      chunks.push({ id, data });
    }
    pos += 8 + size + (size % 2);
  }

  const vp8x = chunks.find((c) => c.id === 'VP8X');
  if (!vp8x) throw new UnsupportedFormatError('WebP writing requires a VP8X chunk');
  const vp8xData = Uint8Array.from(vp8x.data);
  if (Object.keys(exif).length > 0) vp8xData[0] |= 0x08; // EXIF flag
  if (xmp.length > 0) vp8xData[0] |= 0x04; // XMP flag
  if (iccProfile?.profile) vp8xData[0] |= 0x20; // ICC flag
  else if (iccProfile) vp8xData[0] &= ~0x20;

  const out: number[] = [];
  for (const c of 'RIFF') out.push(c.charCodeAt(0));
  const sizeHolder = out.length;
  u32le(out, 0); // patched below
  for (const c of 'WEBP') out.push(c.charCodeAt(0));

  const pushChunk = (id: string, data: Uint8Array) => {
    for (const c of id) out.push(c.charCodeAt(0));
    u32le(out, data.length);
    out.push(...data);
    if (data.length % 2) out.push(0);
  };

  pushChunk('VP8X', vp8xData);
  if (iccProfile?.profile) {
    pushChunk('ICCP', iccProfile.profile);
    writtenOut.push(iccProfile.key);
  } else if (iccProfile) {
    writtenOut.push(iccProfile.key);
  }
  if (Object.keys(exif).length > 0) {
    const { bytes: tiff, written, skipped: exifSkipped } = buildTiff(exif);
    pushChunk('EXIF', new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff])); // 'Exif\0\0' prefix
    skipped.push(...exifSkipped);
    writtenOut.push(...written);
  }
  if (xmp.length > 0) {
    const packet = new TextEncoder().encode(writeXmpPacket(existingXmp, xmp));
    pushChunk('XMP ', packet);
    for (const k of xmpKeys) writtenOut.push(k);
  }
  for (const c of chunks) {
    if (c.id === 'EXIF' || c.id === 'VP8X') continue;
    pushChunk(c.id, c.data);
  }

  const payloadSize = out.length - sizeHolder - 4;
  out[sizeHolder] = payloadSize & 255;
  out[sizeHolder + 1] = (payloadSize >> 8) & 255;
  out[sizeHolder + 2] = (payloadSize >> 16) & 255;
  out[sizeHolder + 3] = (payloadSize >> 24) & 255;
  return { bytes: new Uint8Array(out), written: writtenOut, skipped };
};

function box(type: string, payload: number[]): number[] {
  const out: number[] = [];
  u32be(out, payload.length + 8);
  for (const c of type) out.push(c.charCodeAt(0));
  return [...out, ...payload];
}

function fullBox(type: string, versionAndFlags: number[], payload: number[]): number[] {
  return box(type, [...versionAndFlags, ...payload]);
}

function chars(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

/**
 * AVIF: replaces the Exif item payload inside an existing meta box, or
 * appends a fresh minimal meta box (hdlr/pitm/iinf/Exif) after ftyp when
 * none exists. iloc tables of pre-existing files are left untouched —
 * readers in this project locate the Exif box structurally.
 */
export const avifWriter: ContainerWriter = (original, tags) => {
  if (String.fromCharCode(...original.subarray(4, 8)) !== 'ftyp') {
    throw new UnsupportedFormatError('not an ISOBMFF/AVIF stream');
  }
  const { bytes: tiff, written, skipped } = buildTiff(tags);

  const exifBox = box('Exif', [0, 0, 0, 4, ...tiff]); // offset prefix -> TIFF starts after it

  const dv = new DataView(original.buffer, original.byteOffset, original.byteLength);
  const topLevel: Array<{ type: string; start: number; total: number }> = [];
  let pos = 0;
  while (pos + 8 <= original.length) {
    const size = dv.getUint32(pos, false);
    const type = String.fromCharCode(...original.subarray(pos + 4, pos + 8));
    const total = size === 0 ? original.length - pos : size;
    if (total < 8 || pos + total > original.length) break;
    topLevel.push({ type, start: pos, total });
    pos += total;
  }

  const metaTop = topLevel.find((b) => b.type === 'meta');
  let metaBytes: number[];
  if (metaTop) {
    const children: number[] = [];
    let cpos = metaTop.start + 8; // plain box: children follow the header
    const metaEnd = metaTop.start + metaTop.total;
    while (cpos + 8 <= metaEnd) {
      const csize = dv.getUint32(cpos, false);
      const ctype = String.fromCharCode(...original.subarray(cpos + 4, cpos + 8));
      // Malformed children are dropped so the rebuilt meta box stays
      // parseable; well-formed non-Exif siblings are preserved.
      const wellFormed = csize >= 8 && cpos + csize <= metaEnd;
      if (wellFormed && ctype !== 'Exif') {
        children.push(...original.subarray(cpos, cpos + csize));
      }
      cpos += wellFormed ? csize : 8;
    }
    metaBytes = box('meta', [...children, ...exifBox]);
  } else {
    const hdlr = fullBox(
      'hdlr',
      [0, 0, 0, 0],
      [0, 0, 0, 0, ...chars('pict'), 0, 0, 0, 0, 0],
    );
    const pitm = fullBox('pitm', [0, 0, 0, 0], [0, 1]);
    const infe = fullBox('infe', [2, 0, 0], [0, 1, 0, 0, ...chars('Exif'), 0]);
    const iinf = fullBox('iinf', [0, 0, 0, 0], [0, 1, ...infe]);
    metaBytes = box('meta', [
      ...box('hdlr', hdlr.slice(8)),
      ...box('pitm', pitm.slice(8)),
      ...box('iinf', iinf.slice(8)),
      ...exifBox,
    ]);
  }

  const out: number[] = [];
  for (const b of topLevel) {
    if (b.type === 'meta') {
      out.push(...metaBytes);
    } else {
      out.push(...original.subarray(b.start, b.start + b.total));
      if (b.type === 'ftyp' && !metaTop) out.push(...metaBytes);
    }
  }
  return { bytes: new Uint8Array(out), written, skipped };
};
