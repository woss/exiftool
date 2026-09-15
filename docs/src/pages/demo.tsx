import React, {
  useMemo,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import Layout from '@theme/Layout';
import type { ExifTool } from '../../../dist/browser.js';
import styles from './demo.module.css';

// Lazy singleton: the 5.1 MB browser bundle is code-split and only fetched
// when the user first picks a file. Never touched during SSR/render.
let toolPromise: Promise<ExifTool> | null = null;

function getTool(): Promise<ExifTool> {
  return (toolPromise ??= import('../../../dist/browser.js').then(
    (m) => new m.ExifTool(),
  ));
}

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Size in bytes of the embedded metadata container (EXIF block).
 * Handles JPEG APP1 (Exif\0\0), PNG eXIf, and WebP EXIF chunks.
 */
function findMetadataBytes(bytes: Uint8Array): number | null {
  // JPEG: scan APPn segments for APP1 with Exif\0\0 signature
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 4 < bytes.length) {
      if (bytes[i] === 0xff) {
        const marker = bytes[i + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          i += 2;
          continue;
        }
        const len = (bytes[i + 2] << 8) | bytes[i + 3];
        if (
          marker === 0xe1 &&
          len >= 6 &&
          String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7], bytes[i + 8], bytes[i + 9]) === 'Exif\0\0'
        ) {
          return len - 2;
        }
        i += 2 + len;
      } else {
        i++;
      }
    }
    return null;
  }

  // Generic: locate the Exif\0\0 signature and read the container size.
  // PNG: 4-byte big-endian length precedes the chunk type (12 overhead: len+type+crc).
  // WebP: 4-byte little-endian size follows the "EXIF" chunk type (8 overhead).
  const sig = 'Exif\0\0';
  const text = String.fromCharCode(...bytes.subarray(0, Math.min(bytes.length, 8192)));
  const idx = text.indexOf(sig);
  if (idx === -1) return null;

  const png = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (png === '\x89PNG') {
    const end = idx + sig.length;
    const len = (bytes[end - 8] << 24) | (bytes[end - 7] << 16) | (bytes[end - 6] << 8) | bytes[end - 5];
    return len > 0 && len < bytes.length ? len + 12 : null;
  }
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'RIFF') {
    const size = bytes[idx + sig.length] | (bytes[idx + sig.length + 1] << 8) | (bytes[idx + sig.length + 2] << 16) | (bytes[idx + sig.length + 3] << 24);
    return size > 0 && size < bytes.length - idx ? size + 8 : null;
  }
  return null;
}

/**
 * Size in bytes of the actual compressed pixel data.
 * JPEG: entropy-coded segment (SOS header end → EOI).
 * PNG:  sum of IDAT chunk payloads.
 * WebP: VP8/VP8L chunk payloads.
 * Falls back to an uncompressed width×height×3 estimate for other formats.
 */
function findPixelBytes(bytes: Uint8Array, width: number | null, height: number | null): number | null {
  // JPEG: entropy-coded segment between SOS (FF DA) header end and EOI (FF D9)
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    let sos = -1;
    while (i + 4 < bytes.length) {
      if (bytes[i] === 0xff) {
        const marker = bytes[i + 1];
        if (marker === 0xda) {
          sos = i;
          break;
        }
        if (marker === 0xd9) break;
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          i += 2;
          continue;
        }
        const len = (bytes[i + 2] << 8) | bytes[i + 3];
        i += 2 + len;
      } else {
        i++;
      }
    }
    if (sos === -1) return width && height ? width * height * 3 : null;
    const hdrEnd = sos + 2 + ((bytes[sos + 2] << 8) | bytes[sos + 3]);
    for (let j = hdrEnd; j + 1 < bytes.length; j++) {
      if (bytes[j] === 0xff && bytes[j + 1] === 0xd9) return j - hdrEnd;
    }
    return bytes.length - hdrEnd;
  }

  // PNG: sum IDAT chunk payloads
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === '\x89PNG') {
    let total = 0;
    let i = 8;
    while (i + 12 <= bytes.length) {
      const len = (bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3];
      const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
      if (type === 'IDAT') total += len;
      if (type === 'IEND' || len <= 0 || i + 12 + len > bytes.length) break;
      i += 12 + len;
    }
    return total > 0 ? total : width && height ? width * height * 3 : null;
  }

  // WebP: sum VP8/VP8L chunk payloads (little-endian sizes)
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'RIFF') {
    let total = 0;
    let i = 12;
    while (i + 8 <= bytes.length) {
      const type = String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]);
      const size = (bytes[i + 4] | (bytes[i + 5] << 8) | (bytes[i + 6] << 16) | (bytes[i + 7] << 24)) >>> 0;
      if (type === 'VP8 ' || type === 'VP8L') total += size;
      if (size === 0 || i + 8 + size > bytes.length) break;
      i += 8 + size + (size % 2);
    }
    return total > 0 ? total : width && height ? width * height * 3 : null;
  }

  return width && height ? width * height * 3 : null;
}

function formatBytes(n: number | null): string {
  if (n === null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Uint8Array) {
    return `[Binary data: ${value.length} bytes]`;
  }
  if (Array.isArray(value)) {
    return value.map(formatValue).join(', ');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

/** Stable hue per tag-group name — drives the accent border and dot color. */
function groupHue(group: string): number {
  let h = 0;
  for (let i = 0; i < group.length; i++) h = (h * 31 + group.charCodeAt(i)) % 360;
  return h;
}

/** Fixed hue per metadata group — one color per group, no per-tag hashing. */
const GROUP_HUES: Record<string, number> = {
  EXIF: 210,
  XMP: 280,
  File: 30,
  Composite: 340,
  MakerNotes: 55,
  IPTC: 185,
  Photoshop: 320,
  GPS: 95,
  ICC_Profile: 260,
  Other: 0,
};

const GROUP_ORDER = Object.keys(GROUP_HUES);

/** Tool-injected parity keys (jpeg.ts addFileMetadata) — never real file metadata. */
const PARITY_KEYS = new Set(['ExifToolVersion', 'FileName', 'SourceFile']);

/**
 * Bare tag names collide across groups in the tag DB (XMP registers exif:Make
 * under "Make", ZIP registers "ModifyDate"...), and getByName keeps only the
 * last registration. Resolve by scanning groups in exiftool's output
 * precedence order — first group containing the name wins.
 */

const GROUP_PRIORITY = ['EXIF', 'GPS', 'IPTC', 'Photoshop', 'ICC_Profile', 'Composite', 'MakerNotes', 'File', 'XMP'];

function buildGroupIndex(tool: ExifTool): Map<string, string> {
  const index = new Map<string, string>();
  for (const group of GROUP_PRIORITY) {
    for (const entry of tool.tagDb.getByGroup(group)) {
      const key = entry.name.toLowerCase();
      if (!index.has(key)) index.set(key, group);
    }
  }
  return index;
}

/** Metadata group a tag belongs to, via the tag DB; 'Other' fallback. */
function tagGroup(index: Map<string, string> | null, key: string): string {
  return index?.get(key.toLowerCase()) ?? 'Other';
}

/** Hue for a group: fixed palette entry, hash fallback for unlisted groups. */
function hueFor(group: string): number {
  return GROUP_HUES[group] ?? groupHue(group);
}



export default function Demo(): React.ReactElement {
  const [file, setFile] = useState<File | null>(null);
  const [tags, setTags] = useState<Record<string, unknown> | null>(null);
  const [format, setFormat] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parseTimeMs, setParseTimeMs] = useState<number | null>(null);
  const [metadataBytes, setMetadataBytes] = useState<number | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [pixelBytes, setPixelBytes] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [query, setQuery] = useState('');

  const [tool, setTool] = useState<ExifTool | null>(null);
  const groupIndex = useMemo(() => (tool ? buildGroupIndex(tool) : null), [tool]);
  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const f = input.files[0];
    setFile(f);
    setLoading(true);
    setError(null);
    setTags(null);
    setFormat(null);
    setParseTimeMs(null);
    setMetadataBytes(null);
    setWidth(null);
    setHeight(null);
    setPixelBytes(null);
    setQuery('');

    try {
      const arrayBuffer = await f.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const t = await getTool();
      // Measure the parse only — getTool() may fetch the 5 MB bundle on first
      // use, which is load time, not parse time.
      const t0 = performance.now();
      const info = await t.readBytes(bytes);
      setParseTimeMs(performance.now() - t0);
      setTool(t);
      setTags(info.tags);
      setFormat(info.format);
      setMetadataBytes(findMetadataBytes(bytes));
      const w = toNumber(info.tags.ImageWidth);
      const h = toNumber(info.tags.ImageHeight);
      setWidth(w);
      setHeight(h);
      setPixelBytes(findPixelBytes(bytes, w, h));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to read EXIF data');
    } finally {
      setLoading(false);
    }
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(true);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    if (!event.dataTransfer?.files?.length) return;
    const input = document.getElementById('file-input') as HTMLInputElement | null;
    if (input) {
      input.files = event.dataTransfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  return (
    <Layout title="Demo" description="Browser-based EXIF reader demo — parse EXIF metadata entirely in your browser">
      <div className={styles.container}>
        <div
          className={`${styles.uploadArea} ${dragOver ? styles.dragOver : ''}`}
          role="button"
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            id="file-input"
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            disabled={loading}
          />
          <label htmlFor="file-input" className={styles.uploadLabel}>
            <svg className={styles.uploadIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h1.2a2 2 0 0 0 1.7-.95l.4-.6A2 2 0 0 1 11.5 2.5h1a2 2 0 0 1 1.7.95l.4.6A2 2 0 0 0 16.3 5h1.2A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9Z" />
              <circle cx="12" cy="12" r="3.25" />
            </svg>
            <p className={styles.hint}>Click or drag an image file here (JPEG, PNG, WebP, TIFF, DNG, AVIF, HEIC)</p>
          </label>
        </div>

        {loading && <div className={styles.loading}>Reading EXIF data...</div>}

        {error && <div className={styles.error}>{error}</div>}

        {tags && format && (
          <div className={styles.results}>
            <div className={styles.hero}>
              <div>
                <h2 className={styles.fileName}>{file?.name}</h2>
                <div className={styles.heroMeta}>
                  <span className={styles.formatBadge}>{format}</span>
                  <span className={styles.heroMetaNote}>
                    {Object.keys(tags).filter((k) => !PARITY_KEYS.has(k)).length} tags
                  </span>
                </div>
              </div>
            </div>

            <div className={styles.statBar}>
              <div className={styles.stat}>
                <span className={styles.statLabel}>Parse time</span>
                <span className={styles.statValue}>{parseTimeMs !== null ? `${parseTimeMs.toFixed(1)} ms` : '—'}</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statLabel}>Metadata</span>
                <span className={styles.statValue}>{formatBytes(metadataBytes)}</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statLabel}>Image</span>
                <span className={styles.statValue}>{width && height ? `${width}×${height}` : '—'}</span>
                {pixelBytes !== null && <span className={styles.statSub}>{formatBytes(pixelBytes)} pixel data</span>}
              </div>
            </div>

            <div className={styles.groups}>
              {(() => {
                const all = Object.entries(tags).filter(([key]) => !PARITY_KEYS.has(key));
                const q = query.trim().toLowerCase();
                const visible = q
                  ? all.filter(
                      ([key, value]) =>
                        key.toLowerCase().includes(q) ||
                        formatValue(value).toLowerCase().includes(q),
                    )
                    : all;
                const groups = [...new Set(visible.map(([k]) => tagGroup(groupIndex, k)))].sort((a, b) => {
                  const rank = (g: string) => {
                    const i = GROUP_ORDER.indexOf(g);
                    return i === -1 ? GROUP_ORDER.length : i;
                  };
                  return rank(a) - rank(b) || a.localeCompare(b);
                });
                return (
                  <>
                    <div className={styles.filterBar}>
                      <svg className={styles.filterIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="11" cy="11" r="7" />
                        <path d="m21 21-4.3-4.3" />
                      </svg>
                      <input
                        className={styles.filterInput}
                        type="search"
                        placeholder={`Filter ${all.length} tags…`}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        aria-label="Filter tags"
                      />
                      {query && (
                        <>
                          <span className={styles.filterCount}>
                            {visible.length} / {all.length}
                          </span>
                          <button
                            type="button"
                            className={styles.filterClear}
                            onClick={() => setQuery('')}
                            aria-label="Clear filter"
                          >
                            ×
                          </button>
                        </>
                      )}
                    </div>

                    <div className={styles.legend}>
                      {groups.map((g) => (
                        <span key={g} className={styles.legendItem}>
                          <span className={styles.flatDot} style={{ '--hue': hueFor(g) } as React.CSSProperties} aria-hidden="true" />
                          {g}
                        </span>
                      ))}
                    </div>
                    {visible.length === 0 ? (
                      <div className={styles.empty}>
                        No tags match “{query.trim()}”.
                      </div>
                    ) : (
                      <div className={styles.flat}>
                        {visible.map(([key, value], i) => (
                          <div
                            key={key}
                            className={styles.row}
                            style={{ '--hue': hueFor(tagGroup(groupIndex, key)), '--stagger': i } as React.CSSProperties}
                          >
                            <span className={styles.tagName}>
                              <span className={styles.flatDot} aria-hidden="true" />
                              {key}
                            </span>
                            <span className={styles.tagValue}>{formatValue(value)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
