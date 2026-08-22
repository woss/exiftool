import type { FormatParser } from './mod.ts';
import type { FileInfo, TagValue } from '../types.ts';
import type { TagDb } from '../tag-db.ts';
import { registerParser } from './mod.ts';
import { parseTiff } from '../exif/tiff.ts';
import { parseICCProfile } from '../exif/icc.ts';
import { parseXMP } from '../exif/xmp.ts';
import { computeCompositeTags } from '../exif/composite.ts';
import { parseAPP13 } from '../exif/app13.ts';

export const jpegParser: FormatParser = {
  format: 'JPEG',
  extensions: ['.jpg', '.jpeg', '.jpe', '.jif', '.jfif', '.jfi'],
  canParse(bytes: Uint8Array): boolean {
    return bytes[0] === 0xff && bytes[1] === 0xd8;
  },
  parse(bytes: Uint8Array, filePath: string, tagDb?: TagDb): Promise<FileInfo> {
    const result: Record<string, TagValue> = {};
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 2;

    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      while (offset < bytes.length && bytes[offset] === 0xff) offset++;
      if (offset >= bytes.length) break;
      const marker = bytes[offset++];
      if (marker === 0x00 || marker === 0xd9) break;

      if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
      if (marker === 0xda) {
        offset = bytes.length;
        break;
      }

      if (offset + 2 > bytes.length) break;
      const segLen = view.getUint16(offset, false);
      if (segLen < 2) break;
      offset += 2;
      const data = bytes.slice(offset, offset + segLen - 2);

      if (marker === 0xe1 && data.length >= 6) {
        const id = new TextDecoder().decode(data.slice(0, 6));
        if (id === 'Exif\0\0') {
          const tiffData = data.slice(6);
          // offset points to data[0] (APP1 payload start, after length field).
          // TIFF data starts at file position: offset (payload) + 6 (skip "Exif\0\0")
          const tiffFileOffset = offset + 6;
          result['ExifByteOrder'] = tiffData[0] === 0x49 ? 'Little-endian (Intel, II)' : 'Big-endian (Motorola, MM)';
          const tiff = parseTiff(tiffData, tagDb);
          for (const [k, v] of Object.entries(tiff)) {
            result[k] = v;
          }
          const thumbOff = result['ThumbnailOffset'];
          const thumbLen = result['ThumbnailLength'];
          if (typeof thumbOff === 'number' && typeof thumbLen === 'number') {
            const absOff = tiffFileOffset + thumbOff;
            result['ThumbnailOffset'] = absOff;
            result['ThumbnailImage'] = bytes.slice(absOff, absOff + thumbLen);
          }
        } else if (data[0] === 0x68) {
          const xmpIdent = 'http://ns.adobe.com/xap/1.0/\0';
          const xmpStart = data.length > 29 && new TextDecoder().decode(data.slice(0, 29)) === xmpIdent ? 29 : 0;
          const xmpStr = new TextDecoder().decode(data.slice(xmpStart));
          const xmpTags = parseXMP(xmpStr);
          for (const [k, v] of Object.entries(xmpTags)) {
            if (!(k in result)) {
              result[k] = v;
            }
          }
        }
      }

      if (marker === 0xe2 && data.length >= 4) {
        const id = new TextDecoder().decode(data.slice(0, 4));
        if (id === 'MPF\0') {
          result['MPF'] = 'present';
        }
      }

      if (marker === 0xe2 && data.length >= 14) {
        const id = new TextDecoder().decode(data.slice(0, 12));
        if (id === 'ICC_PROFILE\0') {
          try {
            const iccTags = parseICCProfile(data.slice(14));
            for (const [k, v] of Object.entries(iccTags)) {
              result[k] = v;
            }
          } catch (e) {
            console.error(`ICC parse error: ${(e as Error).message}`);
          }
        }
      }

      if (marker === 0xed && data.length >= 14) {
        const psId = new TextDecoder().decode(data.slice(0, 14));
        if (psId === 'Photoshop 3.0\0') {
          const app13 = parseAPP13(data.slice(14));
          for (const [k, v] of Object.entries(app13)) {
            result[k] = v;
          }
        }
      }

      if (marker === 0xee && data.length >= 12) {
        const adobeId = new TextDecoder().decode(data.slice(0, 5));
        if (adobeId === 'Adobe') {
          const dctEncode = (data[5] << 8) | data[6];
          const flags0 = (data[7] << 8) | data[8];
          const flags1 = (data[9] << 8) | data[10];
          const ct = data[11];
          result['DCTEncodeVersion'] = dctEncode;
          const f0bits: string[] = [];
          for (let b = 0; b < 15; b++) {
            if ((flags0 >> b) & 1) f0bits.push(String(b));
          }
          const f0desc: string[] = [];
          if (flags0 & (1 << 14)) f0desc.push('Encoded with Blend=1 downsampling');
          result['APP14Flags0'] = `[${f0bits.join(', ')}], ${f0desc.join(', ')}`;
          result['APP14Flags1'] = flags1 === 0 ? '(none)' : `[${flags1}]`;
          const ctNames: Record<number, string> = { 0: 'Unknown', 1: 'YCbCr', 2: 'YCCK' };
          result['ColorTransform'] = ctNames[ct] ?? 'Unknown';
        }
      }

      if (marker === 0xfe) {
        result['Comment'] = new TextDecoder().decode(data);
      }

      if (marker >= 0xc0 && marker <= 0xc3 && data.length >= 6) {
        const encodingNames: Record<number, string> = {
          0xc0: 'Baseline DCT, Huffman coding',
          0xc1: 'Extended sequential DCT, Huffman coding',
          0xc2: 'Progressive DCT, Huffman coding',
          0xc3: 'Lossless (sequential), Huffman coding',
        };
        result['EncodingProcess'] = encodingNames[marker] ?? `Unknown (${marker.toString(16)})`;
        result['BitsPerSample'] = data[0];
        result['ImageHeight'] = (data[1] << 8) | data[2];
        result['ImageWidth'] = (data[3] << 8) | data[4];
        const numComponents = data[5];
        result['ColorComponents'] = numComponents;
        if (data.length >= 6 + 3 * numComponents && numComponents >= 3) {
          const ySF = data[7];
          const cbSF = data[10];
          const crSF = data[13];
          const yH = (ySF >> 4) & 0x0f;
          const yV = ySF & 0x0f;
          const cbH = (cbSF >> 4) & 0x0f;
          const cbV = cbSF & 0x0f;
          const crH = (crSF >> 4) & 0x0f;
          const crV = crSF & 0x0f;
          if (yH === 1 && yV === 1 && cbH === 1 && cbV === 1 && crH === 1 && crV === 1) {
            result['YCbCrSubSampling'] = 'YCbCr4:4:4 (1 1)';
          } else if (yH === 2 && yV === 1 && cbH === 1 && cbV === 1) {
            result['YCbCrSubSampling'] = 'YCbCr4:2:2 (1 1)';
          } else if (yH === 2 && yV === 2 && cbH === 1 && cbV === 1) {
            result['YCbCrSubSampling'] = 'YCbCr4:2:0 (1 1)';
          } else {
            result['YCbCrSubSampling'] = `YCbCr4:${yH}:${yV} (${cbH} ${cbV})`;
          }
        }
      }

      offset += segLen - 2;
    }

    if (result['Subject'] && result['Keywords']) {
      const existing = (result['Keywords'] as string[]);
      const subject = result['Subject'];
      const subArr = Array.isArray(subject) ? subject : [subject as string];
      for (const s of subArr) {
        if (!existing.includes(s)) existing.push(s);
      }
    } else if (result['Subject'] && !result['Keywords']) {
      result['Keywords'] = result['Subject'];
    }

    if (!('DerivedFromInstanceID' in result) && result['HistoryInstanceID']) {
      const histIDs = result['HistoryInstanceID'];
      const first = Array.isArray(histIDs) ? histIDs[0] : histIDs;
      if (typeof first === 'string') {
        result['DerivedFromInstanceID'] = first;
        result['DerivedFromDocumentID'] = first.replace('xmp.iid:', 'xmp.did:');
      }
    }
    if (!('DerivedFromOriginalDocumentID' in result) && result['OriginalDocumentID']) {
      result['DerivedFromOriginalDocumentID'] = result['OriginalDocumentID'];
    }

    function fmtIPTCtime(raw: string): string {
      const h = raw.slice(0, 2);
      const m = raw.slice(2, 4);
      const rest = raw.slice(4);
      return `${h}:${m}:${rest}`;
    }
    function fmtIPTCDate(raw: string): string {
      return `${raw.slice(0, 4)}:${raw.slice(4, 6)}:${raw.slice(6, 8)}`;
    }
    const rawDTDate = result['_IPTCDateCreated'] as string | undefined;
    const rawDTTime = result['_IPTCTimeCreated'] as string | undefined;
    if (rawDTDate && rawDTTime) {
      result['DateTimeCreated'] = `${fmtIPTCDate(rawDTDate)} ${fmtIPTCtime(rawDTTime)}`;
      result['TimeCreated'] = fmtIPTCtime(rawDTTime);
    }
    delete result['_IPTCDateCreated'];
    delete result['_IPTCTimeCreated'];
    const rawDDDate = result['_IPTCDigitalCreationDate'] as string | undefined;
    const rawDDTime = result['_IPTCDigitalCreationTime'] as string | undefined;
    if (rawDDDate && rawDDTime) {
      result['DigitalCreationDateTime'] = `${fmtIPTCDate(rawDDDate)} ${fmtIPTCtime(rawDDTime)}`;
      result['DigitalCreationDate'] = fmtIPTCDate(rawDDDate);
      result['DigitalCreationTime'] = fmtIPTCtime(rawDDTime);
    }
    delete result['_IPTCDigitalCreationDate'];
    delete result['_IPTCDigitalCreationTime'];

    computeCompositeTags(result);
    addFileMetadata(result, filePath);
    result['ExifToolVersion'] = 13.55;
    delete result['ImageLength'];
    return Promise.resolve({ path: filePath, format: 'JPEG', tags: result });
  },
};

function addFileMetadata(result: Record<string, TagValue>, filePath: string): void {
  const parts = filePath.split('/');
  const fileName = parts[parts.length - 1];
  result['FileName'] = fileName;
  result['Directory'] = parts.slice(0, -1).join('/') || '/';
  result['SourceFile'] = filePath;
  result['FileType'] = 'JPEG';
  result['FileTypeExtension'] = 'jpg';
  result['MIMEType'] = 'image/jpeg';

  try {
    const stat = Deno.statSync(filePath);
    const size = stat.size;
    if (size >= 1048576) {
      result['FileSize'] = `${(size / 1048576).toFixed(1)} MB`;
    } else if (size >= 1024) {
      result['FileSize'] = `${(size / 1024).toFixed(1)} KiB`;
    } else {
      result['FileSize'] = `${size} B`;
    }
    const pad = (n: number) => String(n).padStart(2, '0');
    const fmtDate = (d: Date) =>
      `${d.getFullYear()}:${pad(d.getMonth()+1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    const mod = stat.mtime;
    if (mod) result['FileModifyDate'] = fmtDate(new Date(mod));
    const access = stat.atime;
    if (access) result['FileAccessDate'] = fmtDate(new Date(access));
    const inode = stat.ctime || stat.birthtime;
    if (inode) result['FileInodeChangeDate'] = fmtDate(new Date(inode));
    if (stat.mode !== null && stat.mode !== undefined) {
      const mode = stat.mode;
      const perms = (mode & 0o777).toString(8).padStart(3, '0');
      const type = (mode & 0o40000) ? 'd' : '-';
      const ur = (mode & 0o400) ? 'r' : '-';
      const uw = (mode & 0o200) ? 'w' : '-';
      const ux = (mode & 0o100) ? 'x' : '-';
      const gr = (mode & 0o040) ? 'r' : '-';
      const gw = (mode & 0o020) ? 'w' : '-';
      const gx = (mode & 0o010) ? 'x' : '-';
      const or = (mode & 0o004) ? 'r' : '-';
      const ow = (mode & 0o002) ? 'w' : '-';
      const ox = (mode & 0o001) ? 'x' : '-';
      result['FilePermissions'] = `${type}${ur}${uw}${ux}${gr}${gw}${gx}${or}${ow}${ox}`;
    }
  } catch {
    // stat failed
  }
}

registerParser(jpegParser);
