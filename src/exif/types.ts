/**
 * EXIF type table: maps numeric type IDs to names and byte sizes.
 * Types 1-13 are standard TIFF/EXIF; 16-18 are BigTIFF (Long8/IFD8).
 */
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

/**
 * Returns the byte size of an EXIF type.
 * @param type - Numeric type ID
 * @returns Size in bytes (default 1 for unknown types)
 */
export function getExifTypeSize(type: number): number {
  return EXIF_TYPES[type]?.size ?? 1;
}

/**
 * Returns the name of an EXIF type.
 * @param type - Numeric type ID
 * @returns Type name (e.g., "RATIONAL", "LONG") or "UNKNOWN_N"
 */
export function getExifTypeName(type: number): string {
  return EXIF_TYPES[type]?.name ?? `UNKNOWN_${type}`;
}

/**
 * A single IFD entry (12 bytes in TIFF).
 * Contains tag ID, type, count, value offset, and raw value.
 */
export interface IfdEntry {
  /** Tag ID (2 bytes) */
  tag: number;
  /** Type ID (2 bytes) */
  type: number;
  /** Value count (4 bytes) */
  count: number;
  /** Offset to value data */
  offset: number;
  /** Raw value (inline or referenced by offset) */
  value: Uint8Array | number | number[];
}

/**
 * A parsed Image File Directory.
 */
export interface Ifd {
  /** Array of IFD entries */
  entries: IfdEntry[];
  /** Offset to next IFD (chained IFDs) */
  nextIfdOffset: number;
}

