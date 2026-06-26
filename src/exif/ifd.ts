import { getExifTypeSize } from './types.ts';
import type { Ifd, IfdEntry } from './types.ts';

export function parseIFD(
  view: DataView,
  offset: number,
  littleEndian: boolean,
  maxRecursion = 10,
): Ifd {
  if (maxRecursion <= 0) {
    return { entries: [], nextIfdOffset: 0 };
  }

  const numEntries = view.getUint16(offset, littleEndian);
  const entries: IfdEntry[] = [];
  let entryOffset = offset + 2;

  for (let i = 0; i < numEntries; i++) {
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
      valueOffset = view.getUint32(entryOffset + 8, littleEndian);
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

  const nextIfdOffset = view.getUint32(entryOffset, littleEndian);

  return { entries, nextIfdOffset };
}
