/**
 * Shared TextEncoder/TextDecoder instances for performance.
 */
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Encodes a string to UTF-8 bytes.
 * @param str - String to encode
 * @returns UTF-8 byte array
 */
export function encodeUTF8(str: string): Uint8Array {
  return encoder.encode(str);
}

/**
 * Decodes UTF-8 bytes to a string.
 * @param bytes - UTF-8 byte array
 * @returns Decoded string
 */
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

/**
 * Escapes a string for JSON output.
 * @param str - String to escape
 * @returns JSON-escaped string
 */
export function escapeJSON(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * Unescapes C-style escape sequences in a string.
 * @param str - String with C escapes
 * @returns Unescaped string
 */
export function unescapeC(str: string): string {
  return str.replace(/\\(.)/g, (_, c) => ASCII_MAP[`\\${c}`] ?? c);
}
/**
 * Escapes a string for XML output.
 * @param str - String to escape
 * @returns XML-escaped string
 */
export function escapeXML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
