const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeUTF8(str: string): Uint8Array {
  return encoder.encode(str);
}

export function decodeUTF8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

const ASCII_MAP: Record<string, string> = {
  '\\n': '\n',
  '\\r': '\r',
  '\\t': '\t',
  '\\\\': '\\',
  '\\"': '"',
};

export function escapeJSON(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

export function unescapeC(str: string): string {
  return str.replace(/\\(.)/g, (_, c) => ASCII_MAP[`\\${c}`] ?? c);
}

export function escapeXML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
