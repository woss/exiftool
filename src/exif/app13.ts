import type { TagValue } from '../types.ts';

const IPTC_LOOKUP: Record<number, string> = {
  0: 'ApplicationRecordVersion',
  5: 'ObjectName',
  25: 'Keywords',
  55: '_IPTCDateCreated',
  60: '_IPTCTimeCreated',
  62: '_IPTCDigitalCreationDate',
  63: '_IPTCDigitalCreationTime',
  80: 'By-line',
  90: 'CodedCharacterSet',
  116: 'CopyrightNotice',
  120: 'Caption-Abstract',
};

export function parseAPP13(data: Uint8Array): Record<string, TagValue> {
  const result: Record<string, TagValue> = {};
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
      const iptcTags = parseIPTC(resData);
      for (const [k, v] of Object.entries(iptcTags)) {
        result[k] = v;
      }
    } else if (resId === 0x0417) {
      result['DisplayedUnitsX'] = resData[0] === 2 ? 'inches' : 'cm';
    } else if (resId === 0x0418) {
      result['DisplayedUnitsY'] = resData[0] === 2 ? 'inches' : 'cm';
    } else if (resId === 0x040C) {
      // skip — PhotoshopThumbnail duplicates EXIF ThumbnailImage
    }

    offset += resSize;
    if (resSize % 2 !== 0) offset += 1;
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

    if (recNum === 1 && dsNum === 90) {
      result['CodedCharacterSet'] = 'UTF8';
      continue;
    }

    if (recNum !== 2) continue;

    const tagName = IPTC_LOOKUP[dsNum];
    if (!tagName) continue;

    if (dsNum === 0x19) {
      if (!result[tagName]) result[tagName] = [];
      (result[tagName] as string[]).push(val);
    } else {
      result[tagName] = val;
    }
  }

  return result;
}
