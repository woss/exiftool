export const EXIF_TYPES: Record<number, { name: string; size: number }> = {
  1: { name: 'BYTE', size: 1 },
  2: { name: 'ASCII', size: 1 },
  3: { name: 'SHORT', size: 2 },
  4: { name: 'LONG', size: 4 },
  5: { name: 'RATIONAL', size: 8 },
  6: { name: 'SBYTE', size: 1 },
  7: { name: 'UNDEFINED', size: 1 },
  8: { name: 'SSHORT', size: 2 },
  9: { name: 'SLONG', size: 4 },
  10: { name: 'SRATIONAL', size: 8 },
  11: { name: 'FLOAT', size: 4 },
  12: { name: 'DOUBLE', size: 8 },
  13: { name: 'IFD', size: 4 },
  16: { name: 'LONG8', size: 8 },
  17: { name: 'SLONG8', size: 8 },
  18: { name: 'IFD8', size: 8 },
};

export function getExifTypeSize(type: number): number {
  return EXIF_TYPES[type]?.size ?? 1;
}

export function getExifTypeName(type: number): string {
  return EXIF_TYPES[type]?.name ?? `UNKNOWN_${type}`;
}

export interface IfdEntry {
  tag: number;
  type: number;
  count: number;
  offset: number;
  value: Uint8Array | number | number[];
}

export interface Ifd {
  entries: IfdEntry[];
  nextIfdOffset: number;
}
