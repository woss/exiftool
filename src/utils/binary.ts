const textDecoder = new TextDecoder();

export function readUint8(view: DataView, offset: number): number {
  return view.getUint8(offset);
}

export function readInt8(view: DataView, offset: number): number {
  return view.getInt8(offset);
}

export function readUint16(view: DataView, offset: number, littleEndian: boolean): number {
  return view.getUint16(offset, littleEndian);
}

export function readInt16(view: DataView, offset: number, littleEndian: boolean): number {
  return view.getInt16(offset, littleEndian);
}

export function readUint32(view: DataView, offset: number, littleEndian: boolean): number {
  return view.getUint32(offset, littleEndian);
}

export function readInt32(view: DataView, offset: number, littleEndian: boolean): number {
  return view.getInt32(offset, littleEndian);
}

export function readFloat64(view: DataView, offset: number, littleEndian: boolean): number {
  return view.getFloat64(offset, littleEndian);
}

export function readBytes(view: DataView, offset: number, length: number): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset + offset, length);
}

export function readString(view: DataView, offset: number, length: number): string {
  const bytes = readBytes(view, offset, length);
  const end = bytes.indexOf(0);
  return textDecoder.decode(end >= 0 ? bytes.slice(0, end) : bytes);
}

export function readASCII(view: DataView, offset: number, length: number): string {
  const bytes = readBytes(view, offset, length);
  const end = bytes.indexOf(0);
  const valid = end >= 0 ? bytes.slice(0, end) : bytes;
  return [...valid].map((b) => String.fromCharCode(b)).join('');
}

export function toHexString(bytes: Uint8Array, sep = ' '): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(sep);
}
