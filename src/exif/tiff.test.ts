import { assertEquals } from '../../deps.ts';
import { extractExifFromTiff, formatGPSWithRef, parseTiff } from './tiff.ts';
import { TagDb } from '../tag-db.ts';


const encoder = new TextEncoder();
Deno.test('default DMS output unchanged (seconds present)', () => {
  assertEquals(formatGPSWithRef([43, 28, 2], 'N'), `43 deg 28' 2.00" N`);
});

Deno.test('default DMS output unchanged (no seconds)', () => {
  assertEquals(formatGPSWithRef([43, 28, 0], 'N'), `43 deg 28.0000' N`);
});

Deno.test('default DMS with missing ref omits trailing space', () => {
  assertEquals(formatGPSWithRef([43, 28, 2], ''), `43 deg 28' 2.00"`);
});

Deno.test('decimal unsigned format', () => {
  // 43 + 28/60 = 43.466666...
  assertEquals(formatGPSWithRef([43, 28, 0], 'N', '%.3f'), '43.467');
});

Deno.test('decimal signed format honors precision and N/E positive', () => {
  assertEquals(formatGPSWithRef([43, 28, 0], 'N', '%+.6f'), '+43.466667');
  assertEquals(formatGPSWithRef([10, 30, 0], 'E', '%+.6f'), '+10.500000');
});

Deno.test('decimal S/W negation', () => {
  assertEquals(formatGPSWithRef([43, 28, 0], 'S', '%+.6f'), '-43.466667');
  assertEquals(formatGPSWithRef([43, 28, 0], 'W', '%+.6f'), '-43.466667');
});

Deno.test('decimal without + flag omits explicit sign', () => {
  assertEquals(formatGPSWithRef([43, 28, 0], 'N', '%.6f'), '43.466667');
});

Deno.test('template tokens: %d %.2f %c', () => {
  // 43.463889 deg → 43 deg 27.83'
  assertEquals(
    formatGPSWithRef([43, 27.83334, 0], 'N', `%d deg %.2f' %c`),
    `43 deg 27.83' N`,
  );
});

Deno.test('template seconds token %.Ns', () => {
  // 43 deg 28 min 15.5 sec
  const out = formatGPSWithRef([43, 28, 15.5], 'E', '%d/%c %.2s');
  assertEquals(out, '43/E 15.50');
});

Deno.test('template unknown tokens pass through literally', () => {
  assertEquals(formatGPSWithRef([43, 28, 0], 'N', '%x %d'), '%x 43');
});

Deno.test('template %c with missing ref renders empty', () => {
  assertEquals(formatGPSWithRef([43, 28, 0], '', '%d%c'), '43');
});

Deno.test('unrecognized coord format falls back to default DMS', () => {
  assertEquals(formatGPSWithRef([43, 28, 2], 'N', 'nonsense'), `43 deg 28' 2.00" N`);
});

Deno.test('non-array value passes through for all formats', () => {
  assertEquals(formatGPSWithRef('oops', 'N'), 'oops');
  assertEquals(formatGPSWithRef('oops', 'N', '%+.6f'), 'oops');
});

// ---------------------------------------------------------------------------
// Synthetic TIFF fixtures
// ---------------------------------------------------------------------------

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 };

type Val =
  | { tag: number; type: number; raw: Uint8Array }
  | { tag: number; ptr: number }; // LONG inline pointer to IFD index

function ascii(s: string): Uint8Array {
  return new TextEncoder().encode(s + '\0');
}

function pack(vals: number[], width: 2 | 4, le: boolean): Uint8Array {
  const out = new Uint8Array(vals.length * width);
  const dv = new DataView(out.buffer);
  for (const [i, v] of vals.entries()) {
    if (width === 2) dv.setUint16(i * 2, v, le);
    else dv.setUint32(i * 4, v, le);
  }
  return out;
}

function rational(num: number, den: number, le: boolean): Uint8Array {
  return pack([num, den], 4, le);
}

/**
 * Assemble a full little/big-endian TIFF blob from IFD entry lists.
 * Entries may point at other IFDs by index; out-of-line values land in a pool.
 */
function buildTiff(le: boolean, ifds: Val[][]): Uint8Array {
  let pos = 8;
  const ifdOffsets = ifds.map((es) => {
    const off = pos;
    pos += 2 + es.length * 12 + 4;
    return off;
  });
  const poolBase = pos;
  const ptrs: (number | undefined)[][] = ifds.map(() => []);
  const pool: Uint8Array[] = [];
  ifds.forEach((es, i) =>
    es.forEach((e, j) => {
      if ('raw' in e && e.raw.length > 4) {
        ptrs[i][j] = poolBase + pool.reduce((n, c) => n + c.length, 0);
        pool.push(e.raw);
      }
    })
  );
  const total = poolBase + pool.reduce((n, c) => n + c.length, 0);
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  buf[0] = le ? 0x49 : 0x4d;
  buf[1] = le ? 0x49 : 0x4d;
  dv.setUint16(2, 42, le);
  dv.setUint32(4, 8, le);
  const w16 = (o: number, v: number) => dv.setUint16(o, v, le);
  const w32 = (o: number, v: number) => dv.setUint32(o, v, le);
  ifds.forEach((es, i) => {
    w16(ifdOffsets[i], es.length);
    es.forEach((e, j) => {
      const eo = ifdOffsets[i] + 2 + j * 12;
      w16(eo, e.tag);
      if ('ptr' in e) {
        w16(eo + 2, 4); // LONG
        w32(eo + 4, 1);
        w32(eo + 8, ifdOffsets[e.ptr]);
        return;
      }
      w16(eo + 2, e.type);
      w32(eo + 4, Math.max(1, e.raw.length / TYPE_SIZE[e.type]));
      const p = ptrs[i][j];
      if (p === undefined) buf.set(e.raw, eo + 8);
      else w32(eo + 8, p);
    });
    w32(ifdOffsets[i] + 2 + es.length * 12, 0); // no next-IFD chain by default
  });
  let po = poolBase;
  for (const c of pool) {
    buf.set(c, po);
    po += c.length;
  }
  return buf;
}

Deno.test('parseTiff rejects short buffers and broken headers', () => {
  assertEquals(parseTiff(new Uint8Array(7)), {});
  assertEquals(parseTiff(encoder.encode('XXXXXXXX')), {}); // bad byte-order mark
  assertEquals(parseTiff(new Uint8Array([0x49, 0x49, 43, 0, 8, 0, 0, 0])), {}); // magic != 42
});

Deno.test('parseTiff rejects out-of-range IFD0 offset', () => {
  const bytes = new Uint8Array([0x49, 0x49, 42, 0, 0xff, 0xff, 0, 0]);
  assertEquals(parseTiff(bytes), {});
});

Deno.test('parseTiff reads little-endian IFD0 tags', () => {
  const bytes = buildTiff(true, [
    [
      { tag: 0x010f, type: 2, raw: ascii('CamCo') },
      { tag: 0x0110, type: 2, raw: ascii('ModelX') },
      { tag: 0x0100, type: 3, raw: pack([640], 2, true) },
    ],
  ]);
  const tags = parseTiff(bytes);
  assertEquals(tags['Make'], 'CamCo');
  assertEquals(tags['Model'], 'ModelX');
});

Deno.test('parseTiff reads big-endian IFD0 tags', () => {
  const bytes = buildTiff(false, [
    [
      { tag: 0x010f, type: 2, raw: ascii('BigEnd') },
      { tag: 0x0131, type: 2, raw: ascii('Software1') },
    ],
  ]);
  const tags = parseTiff(bytes);
  assertEquals(tags['Make'], 'BigEnd');
  assertEquals(tags['Software'], 'Software1');
});

Deno.test('parseTiff resolves names via TagDb then falls back to built-ins', () => {
  const db = new TagDb();
  db.register({ id: '65000', name: 'CustomTag', writable: false, groups: { family1: 'IFD0' } });
  const bytes = buildTiff(true, [
    [
      { tag: 65000, type: 3, raw: pack([7], 2, true) },
      { tag: 0x010f, type: 2, raw: ascii('DbCam') },
    ],
  ]);
  const tags = parseTiff(bytes, db);
  assertEquals(tags['CustomTag'], 7); // resolved through TagDb getById
  assertEquals(tags['Make'], 'DbCam'); // db miss falls back to built-in table
});

Deno.test('parseTiff skips entries whose db name is an IFD pointer name', () => {
  const db = new TagDb();
  db.register({ id: '65001', name: 'ExifIFD', writable: false, groups: { family1: 'IFD0' } });
  const bytes = buildTiff(true, [[{ tag: 65001, type: 3, raw: pack([9], 2, true) }]]);
  const tags = parseTiff(bytes, db);
  assertEquals('ExifIFD' in tags, false);
  assertEquals(9 in Object.values(tags), false);
});

Deno.test('parseTiff walks Exif sub-IFD for numeric pointers only', () => {
  const withPtr = buildTiff(true, [
    [{ tag: 0x8769, ptr: 1 }],
    [
      { tag: 0x9003, type: 2, raw: ascii('2024:01:02') },
      { tag: 0x8827, type: 3, raw: pack([200], 2, true) },
    ],
  ]);
  const ok = parseTiff(withPtr);
  assertEquals(ok['DateTimeOriginal'], '2024:01:02');
  assertEquals(ok['ISOSpeedRatings'], 200);

  // ASCII-valued pointer entry yields no numeric pointer -> Exif IFD skipped.
  const badPtr = buildTiff(true, [[{ tag: 0x8769, type: 2, raw: ascii('zz') }]]);
  const skipped = parseTiff(badPtr);
  assertEquals('DateTimeOriginal' in skipped, false);
});

Deno.test('parseTiff walks Interop IFD inside Exif IFD', () => {
  const bytes = buildTiff(true, [
    [{ tag: 0x8769, ptr: 1 }],
    [
      { tag: 0xa005, ptr: 2 },
      { tag: 0x9000, type: 7, raw: new Uint8Array([0x30, 0x32, 0x33, 0x30]) },
    ],
    [{ tag: 0x8827, type: 3, raw: pack([100], 2, true) }, { tag: 0x0001, type: 2, raw: ascii('R98') }],
  ]);
  const tags = parseTiff(bytes);
  // Known exif-table tags get the Interop_ prefix; unknown ones are dropped.
  assertEquals(tags['Interop_ISOSpeedRatings'], 100);
  assertEquals('Interop_R98' in tags, false);
});

Deno.test('parseTiff ignores out-of-range Interop pointer', () => {
  const bytes = buildTiff(true, [
    [{ tag: 0x8769, ptr: 1 }],
    [{ tag: 0xa005, type: 4, raw: pack([99999], 4, true) }],
  ]);
  const tags = parseTiff(bytes);
  assertEquals(Object.keys(tags).filter((k) => k.startsWith('Interop_')).length, 0);
});

Deno.test('parseTiff formats GPS latitude/longitude with refs', () => {
  const lat = [...rational(43, 1, true), ...rational(28, 1, true), ...rational(2, 1, true)];
  const lon = [...rational(11, 1, true), ...rational(21, 1, true), ...rational(0, 1, true)];
  const bytes = buildTiff(true, [
    [{ tag: 0x8825, ptr: 1 }],
    [
      { tag: 0x01, type: 2, raw: ascii('N') },
      { tag: 0x02, type: 5, raw: new Uint8Array(lat) },
      { tag: 0x03, type: 2, raw: ascii('W') },
      { tag: 0x04, type: 5, raw: new Uint8Array(lon) },
      { tag: 0x06, type: 5, raw: rational(120, 10, true) },
      { tag: 0x07, type: 5, raw: new Uint8Array([...rational(10, 1, true), ...rational(30, 1, true), ...rational(15, 1, true)]) },
      { tag: 0x00, type: 1, raw: new Uint8Array([2, 3, 0, 0]) },
      { tag: 0x08, type: 2, raw: ascii('8') },
    ],
  ]);
  const tags = parseTiff(bytes);
  assertEquals(tags['GPSLatitude'], `43 deg 28' 2.00" N`);
  assertEquals(tags['GPSLongitude'], `11 deg 21.0000' W`);
  assertEquals(tags['GPSAltitude'], 12);
  assertEquals(tags['GPSTimeStamp'], '10:30:15');
  assertEquals(tags['GPSVersionID'], '2.3.0.0');
  assertEquals(tags['GPSSatellites'], '8');

  const decimal = parseTiff(bytes, undefined, '%+.6f');
  assertEquals(decimal['GPSLatitude'], '+43.467222');
  assertEquals(decimal['GPSLongitude'], '-11.350000');
});

Deno.test('parseTiff renames IFD1 entries to Thumbnail* tags', () => {
  const bytes = buildTiff(true, [
    [],
    [
      { tag: 0x0103, type: 3, raw: pack([6], 2, true) },
      { tag: 0x0202, type: 4, raw: pack([512], 4, true) },
    ],
  ]);
  // Chain ifd0.nextIfdOffset to the second IFD.
  const dv = new DataView(bytes.buffer);
  dv.setUint32(10, 8 + 2 + 4, true); // next-IFD slot of an empty IFD0 -> IFD1
  const tags = parseTiff(bytes);
  assertEquals(tags['ThumbnailCompression'], 'JPEG');
  assertEquals(tags['ThumbnailLength'], 512);
});

Deno.test('parseTiff skips pointer-named entries in IFD1 via TagDb', () => {
  const db = new TagDb();
  db.register({ id: '65002', name: 'GPSInfo', writable: false, groups: { family1: 'IFD0' } });
  const bytes = buildTiff(true, [
    [],
    [{ tag: 65002, type: 3, raw: pack([3], 2, true) }],
  ]);
  const dv = new DataView(bytes.buffer);
  dv.setUint32(10, 8 + 2 + 4, true); // ifd0 next -> ifd1
  const tags = parseTiff(bytes, db);
  assertEquals(Object.keys(tags).length, 0);
});

Deno.test('formatGPSWithRef guards malformed coordinate arrays', () => {
  assertEquals(formatGPSWithRef([43], 'N', '%+.6f'), '43');
  assertEquals(formatGPSWithRef(['a', 'b'], 'N', '%+.6f'), 'a,b');
  assertEquals(formatGPSWithRef('oops', 'N', '%d %c'), 'oops');
});

Deno.test('extractExifFromTiff delegates to parseTiff', () => {
  const good = buildTiff(true, [[{ tag: 0x010f, type: 2, raw: ascii('Ext') }]]);
  assertEquals(extractExifFromTiff(good)['Make'], 'Ext');
  assertEquals(extractExifFromTiff(new Uint8Array(4)), {});
});

Deno.test('parseTiff skips ASCII-valued GPS pointer', () => {
  const bytes = buildTiff(true, [[{ tag: 0x8825, type: 2, raw: ascii('nope') }]]);
  const tags = parseTiff(bytes);
  assertEquals('GPSLatitude' in tags, false);
});

Deno.test('parseTiff formats GPS coordinates without ref tags', () => {
  const lat = new Uint8Array([...rational(43, 1, true), ...rational(28, 1, true), ...rational(2, 1, true)]);
  const bytes = buildTiff(true, [
    [{ tag: 0x8825, ptr: 1 }],
    [{ tag: 0x02, type: 5, raw: lat }],
  ]);
  const tags = parseTiff(bytes);
  assertEquals(tags['GPSLatitude'], `43 deg 28' 2.00"`);
});

Deno.test('parseTiff resolves GPS tag names through TagDb', () => {
  const db = new TagDb();
  db.register({ id: '65010', name: 'GPSCustom', writable: false, groups: { family1: 'GPS' } });
  const bytes = buildTiff(true, [
    [{ tag: 0x8825, ptr: 1 }],
    [{ tag: 65010, type: 3, raw: pack([42], 2, true) }],
  ]);
  const tags = parseTiff(bytes, db);
  assertEquals(tags['GPSCustom'], 42);
});

Deno.test('parseTiff skips pointer-named entries inside Exif IFD via TagDb', () => {
  const db = new TagDb();
  db.register({ id: '65011', name: 'InteropIFD', writable: false, groups: { family1: 'IFD0' } });
  const bytes = buildTiff(true, [
    [{ tag: 0x8769, ptr: 1 }],
    [{ tag: 65011, type: 3, raw: pack([8], 2, true) }],
  ]);
  const tags = parseTiff(bytes, db);
  assertEquals('InteropIFD' in tags, false);
  assertEquals(Object.keys(tags).length, 0);
});

Deno.test('bare %f coord format uses default precision', () => {
  assertEquals(formatGPSWithRef([43, 28, 0], 'N', '%f'), '43.466667');
});

Deno.test('GPS branches: zero pointer, refless longitude, southern template', () => {
  // Interop pointer value 0 is skipped.
  const zeroPtr = buildTiff(true, [
    [{ tag: 0x8769, ptr: 1 }],
    [{ tag: 0xa005, type: 4, raw: pack([0], 4, true) }],
  ]);
  assertEquals(Object.keys(parseTiff(zeroPtr)).filter((k) => k.startsWith('Interop_')).length, 0);

  // Longitude present but its Ref tag absent -> non-string ref arm.
  const lonOnly = new Uint8Array([...rational(11, 1, true), ...rational(21, 1, true), ...rational(0, 1, true)]);
  const noRef = buildTiff(true, [
    [{ tag: 0x8825, ptr: 1 }],
    [{ tag: 0x04, type: 5, raw: lonOnly }],
  ]);
  assertEquals(parseTiff(noRef)['GPSLongitude'], `11 deg 21.0000'`);

  // Southern hemisphere through the template renderer.
  assertEquals(formatGPSWithRef([43, 28, 0], 's', '%d %c'), '43 S');
});

Deno.test('parseTiff skips ASCII-valued Interop pointer', () => {
  const bytes = buildTiff(true, [
    [{ tag: 0x8769, ptr: 1 }],
    [{ tag: 0xa005, type: 2, raw: ascii('nope') }],
  ]);
  assertEquals(Object.keys(parseTiff(bytes)).filter((k) => k.startsWith('Interop_')).length, 0);
});

Deno.test('DMS fallback renders minute-only form without ref', () => {
  assertEquals(formatGPSWithRef([43, 28, 0], ''), `43 deg 28.0000'`);
});

Deno.test('DMS fallback handles deg/min pairs without seconds', () => {
  assertEquals(formatGPSWithRef([43, 28], 'N'), `43 deg 28.0000' N`);
});
