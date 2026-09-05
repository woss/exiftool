import { md5Hex } from '../utils/md5.js';
import type { TagValue } from '../types.js';

const IPTC_LOOKUP: Record<number, string> = {
  0: 'ApplicationRecordVersion',
  5: 'ObjectName',
  25: 'Keywords',
  55: 'DateCreated',
  60: 'TimeCreated',
  62: 'DigitalCreationDate',
  63: 'DigitalCreationTime',
  80: 'By-line',
  85: 'OriginalDocumentID',
  86: 'OriginalInstanceID',
  // Dataset 90 is record-dependent: 1:90 CodedCharacterSet (handled in the
  // parse loop before the recNum check), 2:90 City.
  90: 'City',
  92: 'Sub-location',
  95: 'Province-State',
  100: 'Country-PrimaryLocationCode',
  101: 'Country-PrimaryLocationName',
  116: 'CopyrightNotice',
  120: 'Caption-Abstract',
};

/**
 * Parses APP13 (Photoshop IRB) segment for IPTC metadata.
 *
 * APP13 contains Photoshop Image Resource Blocks (IRB), each with:
 * - Signature "8BIM"
 * - Resource ID (2 bytes)
 * - Pascal-string name
 * - Data size + data
 *
 * The IPTC/IIM data is stored in resource ID 0x0404.
 *
 * @param data - APP13 segment data (after APP13 marker)
 * @returns Extracted tags
 */
 export function parseAPP13(data: Uint8Array): Record<string, TagValue> {
  const result: Record<string, TagValue> = {};
  let iptcData: Uint8Array | undefined;
  let offset = 0;

  while (offset + 8 <= data.length) {
    const sig = new TextDecoder().decode(data.slice(offset, offset + 4));
    if (sig !== '8BIM') break;
    offset += 4;

    const resId = (data[offset] << 8) | data[offset + 1];
    offset += 2;

    const nameLen = data[offset];
    offset += 1;
    const nameBytes = nameLen > 0 ? data.slice(offset, offset + nameLen) : new Uint8Array(0);
    offset += nameLen;
    if (nameLen % 2 === 0) offset += 1;

    if (offset + 4 > data.length) break;
    const resSize = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
    offset += 4;

    if (offset + resSize > data.length) break;
    const resData = data.slice(offset, offset + resSize);

    if (resId === 0x0404) {
      iptcData = resData;
      const iptcTags = parseIPTC(resData);
      for (const [k, v] of Object.entries(iptcTags)) {
        result[k] = v;
      }
    } else if (resId === 0x03ed) {
      // ResolutionInfo: hRes fixed32 + hResUnit int16 + widthUnit int16,
      // then the same triple for the vertical resolution. The unit fields
      // surface as DisplayedUnitsX/Y (exiftool: inches/cm/points/picas).
      const view = new DataView(resData.buffer, resData.byteOffset, resData.byteLength);
      if (resData.length >= 16) {
        const unitNames: Record<number, string> = {
          1: 'inches',
          2: 'cm',
          3: 'points',
          4: 'picas',
        };
        result['DisplayedUnitsX'] = unitNames[view.getUint16(4)] ?? view.getUint16(4);
        result['DisplayedUnitsY'] = unitNames[view.getUint16(12)] ?? view.getUint16(12);
      }
    } else if (resId === 0x0417) {
      result['DisplayedUnitsX'] = resData[0] === 2 ? 'inches' : 'cm';
    } else if (resId === 0x0418) {
      result['DisplayedUnitsY'] = resData[0] === 2 ? 'inches' : 'cm';
    } else if (resId === 0x040c) {
      // The thumbnail resource carries a 28-byte ImageSource header before
      // the embedded JPEG; exiftool emits the JPEG data alone.
      result['PhotoshopThumbnail'] = resData.slice(28);
    } else if (resId === 0x0425) {
      // The stored digest resource is 16 raw bytes; exiftool prints hex.
      result['IPTCDigest'] = [...resData]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }

    offset += resSize;
    if (resSize % 2 !== 0) offset += 1;
  }

  // ExifTool computes CurrentIPTCDigest as the MD5 of the IPTC block.
  if (iptcData) result['CurrentIPTCDigest'] = md5Hex(iptcData);

  // A single-keyword list prints as a scalar (exiftool -j behavior).
  if (Array.isArray(result['Keywords']) && result['Keywords'].length === 1) {
    result['Keywords'] = result['Keywords'][0];
  }


  // IPTC times carry compact offsets (+0100); exiftool prints +01:00.
  for (const [k, v] of Object.entries(result)) {
    if (typeof v === 'string') {
      result[k] = v.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    }
  }
  return result;
}

function parseIPTC(data: Uint8Array): Record<string, TagValue> {
  const result: Record<string, TagValue> = {};
  let offset = 0;

  while (offset + 5 <= data.length) {
    if (data[offset] !== 0x1C) break;
    offset++;

    const recNum = data[offset] & 0x1f;
    offset++;

    const dsNum = data[offset];
    offset++;

    const valLen = (data[offset] << 8) | data[offset + 1];
    offset += 2;

    if (offset + valLen > data.length) break;
    const val = new TextDecoder().decode(data.slice(offset, offset + valLen));
    offset += valLen;

    const tagName = IPTC_LOOKUP[dsNum];
    if (!tagName) continue;
    if (recNum === 1 && dsNum === 90) {
      result['CodedCharacterSet'] = 'UTF8';
      continue;
    }
    if (recNum !== 2) continue;
    if (tagName === 'TimeCreated' || tagName === 'DigitalCreationTime') {
      if (/^\d{6}$/.test(val)) {
        result[tagName] = `${val.slice(0, 2)}:${val.slice(2, 4)}:${val.slice(4, 6)}`;
      } else if (/^\d{6}[+-]\d{4}$/.test(val)) {
        result[tagName] =
          `${val.slice(0, 2)}:${val.slice(2, 4)}:${val.slice(4, 6)}${val.slice(6, 7)}${val.slice(7, 9)}:${val.slice(9, 11)}`;
      } else {
        result[tagName] = val;
      }
      continue;
    }

    if (dsNum === 0x19) {
      if (!result[tagName]) result[tagName] = [];
      (result[tagName] as string[]).push(val);
      continue;
    }

    // ExifTool renders the compact IIM dates/times as 2023:09:29 / 17:01:22.
    if (tagName === 'DateCreated' || tagName === 'DigitalCreationDate') {
      if (/^\d{8}$/.test(val)) {
        result[tagName] = `${val.slice(0, 4)}:${val.slice(4, 6)}:${val.slice(6, 8)}`;
      } else if (/^\d{14}([+-]\d{4})?$/.test(val)) {
        // 19-digit form embeds the time; exiftool prints date + time and
        // drops the embedded offset (the capture tz is appended separately).
        result[tagName] = `${val.slice(0, 4)}:${val.slice(4, 6)}:${val.slice(6, 8)} ${val.slice(8, 10)}:${val.slice(10, 12)}:${val.slice(12, 14)}`;
      } else {
        result[tagName] = val;
      }
      continue;
    }


    if (dsNum === 0) {
      // ApplicationRecordVersion: big-endian int16; exiftool prints it numeric.
      result[tagName] = String(((val.charCodeAt(0) << 8) | val.charCodeAt(1)) & 0xffff);
      continue;
    }

    result[tagName] = val;
  }

  return result;
}

