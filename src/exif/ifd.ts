import { getExifTypeSize } from './types.js';
import type { Ifd, IfdEntry } from './types.js';

export function parseIFD(
  view: DataView,
  offset: number,
  littleEndian: boolean,
  maxRecursion = 10,
): Ifd {
  if (maxRecursion <= 0) {
    return { entries: [], nextIfdOffset: 0 };
  }

  // Bounds guard: need 2 bytes for the entry count.
  if (offset + 2 > view.byteLength) {
    return { entries: [], nextIfdOffset: 0 };
  }

  const numEntries = view.getUint16(offset, littleEndian);
  const entries: IfdEntry[] = [];
  let entryOffset = offset + 2;

  for (let i = 0; i < numEntries; i++) {
    // Bounds guard: each entry is 12 bytes.
    if (entryOffset + 12 > view.byteLength) {
      return { entries, nextIfdOffset: 0 };
    }
    const tag = view.getUint16(entryOffset, littleEndian);
    const type = view.getUint16(entryOffset + 2, littleEndian);
    const count = view.getUint32(entryOffset + 4, littleEndian);
    const typeSize = getExifTypeSize(type);
    const dataSize = count * typeSize;
    let valueOffset = entryOffset + 8;

    let value: Uint8Array | number | number[];

    if (dataSize <= 4) {
      const raw = new Uint8Array(view.buffer, view.byteOffset + valueOffset, dataSize);
      value = raw;
    } else {
      // Out-of-line value: the last entry word is an offset to the data.
      valueOffset = view.getUint32(entryOffset + 8, littleEndian);
      if (valueOffset + dataSize > view.byteLength) {
        return { entries, nextIfdOffset: 0 };
      }
      value = new Uint8Array(view.buffer, view.byteOffset + valueOffset, dataSize);
    }

    entries.push({
      tag,
      type,
      count,
      offset: valueOffset,
      value,
    });

    entryOffset += 12;
  }

  // Bounds guard: need 4 bytes for the next-IFD pointer.
  const nextIfdOffset = entryOffset + 4 <= view.byteLength
    ? view.getUint32(entryOffset, littleEndian)
    : 0;

  return { entries, nextIfdOffset };
}
