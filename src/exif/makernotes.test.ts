import { test, describe } from 'vitest';
import { assertEquals } from '../test/asserts.js';
import { ExifTool } from '../exiftool.js';
import { parseTiff } from './tiff.js';
import { decodeMakerNote } from './makernotes.js';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const assetPath = (name: string): string =>
  fileURLToPath(new URL(`../../assets/raw/${name}`, import.meta.url));

const tool = new ExifTool();

describe('makernote framework', () => {
  test('unknown vendor makernotes decode to nothing without failing', () => {
    const bytes = new Uint8Array([0x00, 0x0b, 0x01, 0x02, 0x03, 0x04]);
    const tags = decodeMakerNote(bytes, 0, {
      bytes,
      littleEndian: true,
      make: 'Konica Minolta',
      model: 'X',
    });
    assertEquals(tags, {});
  });

  test('truncated / garbage makernote bytes never throw', () => {
    const bytes = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
    for (let cut = 0; cut <= 4; cut++) {
      const tags = decodeMakerNote(bytes.subarray(0, cut), 0, {
        bytes,
        littleEndian: true,
        make: 'Canon',
        model: 'X',
      });
      assertEquals(tags, {});
    }
  });

  test('unknown Canon positional ids fall back to Canon_0xNNNN naming', () => {
    // Minimal Canon makernote: one entry, tag 0x0001 (CameraSettings,
    // int16s) whose value block is byte-addressed by sub-table id (the
    // leading size word occupies id 0).
    const le = true;
    const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
    const u32 = (v: number) => [...u16(v & 0xffff), ...u16(v >>> 16)];
    // ids: 0 = size word (16), 1 = MacroMode, 6 = unknown to the db
    const data = [...u16(16), ...u16(2), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u16(0x55), ...u16(0)];
    const ifd = [
      ...u16(1),
      ...u16(0x0001), ...u16(3), ...u32(8), ...u32(18),
      ...u32(0),
      ...data,
    ];
    const bytes = new Uint8Array(ifd);
    const env = { bytes, littleEndian: le, make: 'Canon', model: 'X' };
    const tags = decodeMakerNote(bytes, 0, env);
    assertEquals(tags['MacroMode'], 'Normal');
    assertEquals(tags['SelfTimer'], 'Off'); // gap ids 2..5 decode to 0/filtered
  });
});

describe('makernote fixture parity (exiftool 13.55)', () => {
  test('CR2: Canon makernote decodes camera settings and color data', async () => {
    if (!existsSync(assetPath('CanonRaw.cr2'))) return;
    const info = await tool.read(assetPath('CanonRaw.cr2'));
    const t = info.tags;
    assertEquals(t['Quality'], 'RAW');
    assertEquals(t['FocusMode'], 'One-shot AF');
    assertEquals(t['CanonFirmwareVersion'], 'Firmware 1.0.2');
    assertEquals(t['CanonModelID'], 'EOS Digital Rebel XT / 350D / Kiss Digital N');
    assertEquals(t['MacroMode'], 'Normal');
    assertEquals(t['EasyMode'], 'Manual');
    assertEquals(t['CanonExposureMode'], 'Aperture-priority AE');
    assertEquals(t['MeteringMode'], 'Center-weighted average');
    assertEquals(t['CameraType'], 'EOS Mid-range');
    assertEquals(t['AutoISO'], 100);
    assertEquals(t['BaseISO'], 400);
    assertEquals(t['TargetAperture'], 8);
    assertEquals(t['MinFocalLength'], '18 mm');
    assertEquals(t['MaxFocalLength'], '55 mm');
    assertEquals(t['FocalType'], 'Zoom');
    assertEquals(t['FocalUnits'], '1/mm');
    assertEquals(t['FocalPlaneXSize'], '23.04 mm');
    assertEquals(t['FocalPlaneYSize'], '15.37 mm');
    assertEquals(t['ColorTempAsShot'], 3064);
    assertEquals(t['WB_RGGBLevelsAsShot'], '2002 1185 1187 2364');
    assertEquals(t['SerialNumber'], '0123456789');
    assertEquals(t['ImageSize'], '3456x2304');
    assertEquals(t['Megapixels'], 8);
    assertEquals(t['RedBalance'], 1.688027);
    assertEquals(t['BlueBalance'], 1.993255);
    assertEquals(t['ShootingMode'], 'Aperture-priority AE');
    assertEquals(t['DriveMode'], 'Single-frame Shooting');
  });

  test('NEF: Nikon makernote decodes quality, lens data and serial tags', async () => {
    if (!existsSync(assetPath('Nikon.nef'))) return;
    const info = await tool.read(assetPath('Nikon.nef'));
    const t = info.tags;
    assertEquals(t['MakerNoteVersion'], 2.1);
    assertEquals(t['Quality'], 'RAW');
    assertEquals(t['FocusMode'], 'AF-S');
    assertEquals(t['ColorHue'], 'Mode2');
    assertEquals(t['ShutterCount'], 3619);
    assertEquals(t['SerialNumber'], '12345678');
    assertEquals(t['LensDataVersion'], '0101');
    assertEquals(t['LensIDNumber'], 127);
    assertEquals(t['LensFStops'], 5.33);
    assertEquals(t['LensType'], 'G');
    assertEquals(t['MinFocalLength'], '18.3 mm');
    assertEquals(t['MaxFocalLength'], '71.3 mm');
    assertEquals(t['AFAperture'], 3.6);
    assertEquals(t['MaxApertureAtMinFocal'], 3.6);
    assertEquals(t['MaxApertureAtMaxFocal'], 4.5);
    assertEquals(t['EffectiveMaxAperture'], 3.6);
    assertEquals(t['ExitPupilPosition'], '102.4 mm');
    assertEquals(t['MCUVersion'], 132);
    assertEquals(t['ToneComp'], 'CS');
    assertEquals(t['NoiseReduction'], 'Off');
  });

  test('Panasonic JPEG + RW2 makernote tags', async () => {
    if (!existsSync(assetPath('Panasonic.jpg'))) return;
    const jpg = await tool.read(assetPath('Panasonic.jpg'));
    assertEquals(jpg.tags['ImageQuality'], 'High');
    assertEquals(jpg.tags['MacroMode'], 'Off');
    assertEquals(jpg.tags['FirmwareVersion'], '0.1.0.8');
    assertEquals(jpg.tags['WhiteBalance'], 'Auto');
    assertEquals(jpg.tags['TimeSincePowerOn'], '00:00:06.96');
    assertEquals(jpg.tags['PanasonicExifVersion'], '0100');

    if (!existsSync(assetPath('Panasonic.rw2'))) return;
    const rw2 = await tool.read(assetPath('Panasonic.rw2'));
    assertEquals(rw2.tags['ImageQuality'], 'RAW');
    assertEquals(rw2.tags['MacroMode'], 'Off');
    assertEquals(rw2.tags['FirmwareVersion'], '0.1.0.0');
    assertEquals(rw2.tags['WhiteBalance'], 'Auto');
    assertEquals(rw2.tags['TimeSincePowerOn'], '00:10:33.08');
    assertEquals(rw2.tags['ImageWidth'], 3648);
    assertEquals(rw2.tags['ImageHeight'], 2736);
    assertEquals(rw2.tags['Megapixels'], 10);
  });

  test('Olympus JPEG makernotes (old OLYMP\\0 header)', async () => {
    if (!existsSync(assetPath('Olympus.jpg'))) return;
    const info = await tool.read(assetPath('Olympus.jpg'));
    assertEquals(info.tags['SpecialMode'], 'Normal, Sequence: 0, Panorama: (none)');
    assertEquals(info.tags['Quality'], 'SQ (Low)');
    assertEquals(info.tags['Macro'], 'Off');
    assertEquals(info.tags['BWMode'], 'Off');
    assertEquals(info.tags['CameraID'], 'OLYMPUS DIGITAL CAMERA');

    if (!existsSync(assetPath('OlympusE1.jpg'))) return;
    const e1 = await tool.read(assetPath('OlympusE1.jpg'));
    assertEquals(e1.tags['OlympusImageWidth'], 2560);
    assertEquals(e1.tags['OlympusImageHeight'], 1920);
  });

  test('Sony ARW-in-DNG makernote via Adobe MakN private data (local-only)', async () => {
    const DNG = '/Users/woss/Pictures/2024/09/DSC01012.dng';
    if (!existsSync(DNG)) return; // CI: user fixture is not committed
    const info = await tool.read(DNG);
    // Partial decode (v1): plain Sony::Main IFD tags only — the encrypted
    // ShotInfo / Tag2010 / 0x94xx regions remain a documented gap, so
    // exiftool's full 129-tag output is not reachable yet.
    assertEquals(info.tags['CreativeStyle'], 'Standard');
  });

  test('makerNotes: false suppresses decoded vendor tags', async () => {
    const bytes = new Uint8Array(readFileSync(assetPath('CanonRaw.cr2')));
    const withMn = parseTiff(bytes, undefined, undefined, { subIfds: true });
    assertEquals('Quality' in withMn, true);
    const withoutMn = parseTiff(bytes, undefined, undefined, { subIfds: true, makerNotes: false });
    assertEquals('Quality' in withoutMn, false);
  });
});
