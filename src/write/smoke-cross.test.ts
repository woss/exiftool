import { test } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { jpegMergeWriter } from './jpeg-merge.js';

test('cross', () => {
  const jpg = new Uint8Array(readFileSync('assets/raw/Olympus.jpg'));
  const out = jpegMergeWriter(jpg, {
    'IPTC:Keywords': ['kelp', 'forêt'],
    'XMP-dc:Subject': ['kelp', 'forêt'],
    'XMP-dc:Title': 'Cross check',
    Copyright: '2026 woss',
  });
  writeFileSync('/tmp/cross2.jpg', out.bytes);
});
