import type { FormatParser } from './mod.ts';
import type { FileInfo } from '../types.ts';

export const jpegParser: FormatParser = {
  format: 'JPEG',
  extensions: ['.jpg', '.jpeg', '.jpe', '.jif', '.jfif', '.jfi'],
  canParse(bytes: Uint8Array): boolean {
    return bytes[0] === 0xff && bytes[1] === 0xd8;
  },
  async parse(bytes: Uint8Array, filePath: string): Promise<FileInfo> {
    const result: FileInfo = {
      path: filePath,
      format: 'JPEG',
      tags: {},
    };

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 2;

    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0x00 || marker === 0xd9) break;

      if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;

      if (marker === 0xda) {
        offset = bytes.length;
        break;
      }

      if (offset + 2 > bytes.length) break;
      const segLen = readUint16(view, offset);
      if (segLen < 2) break;
      offset += 2;

      if (marker === 0xe1) {
        const app1 = bytes.slice(offset, offset + segLen - 2);
        if (app1[0] === 0x45 && app1[1] === 0x78 && app1[2] === 0x69 && app1[3] === 0x66) {
          await parseExif(app1.slice(6));
        }
      }

      if (marker === 0xe2) {
        const app2 = bytes.slice(offset, offset + segLen - 2);
        if (
          app2[0] === 0x4d && app2[1] === 0x50 &&
          app2[2] === 0x46 && app2[3] === 0x00
        ) {
          result.tags['MPF'] = 'MPF data present';
        }
      }

      offset += segLen - 2;
    }

    return result;
  },
};

function readUint16(view: DataView, offset: number): number {
  return view.getUint16(offset, false);
}

function parseExif(bytes: Uint8Array): void {
  // placeholder: parse TIFF/IFD from EXIF APP1 segment
}

import { registerParser } from './mod.ts';
registerParser(jpegParser);
