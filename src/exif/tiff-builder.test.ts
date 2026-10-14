import { test } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { assertEquals } from '../../src/test/asserts.js';
import { tempFile } from '../test/tmp.js';
import { buildTiff, encodeValue } from './tiff-builder.js';
import { extractExifFromTiff } from './tiff.js';

const execFileP = promisify(execFile);
const upstreamExifTool = new URL('../../vendor/exiftool/exiftool', import.meta.url).pathname;

test('buildTiff writes ASCII tags readable by the TIFF parser', () => {
  const { bytes } = buildTiff({ Make: 'Acme', Model: 'Model 1' });
  const tags = extractExifFromTiff(bytes);
  assertEquals(tags.Make, 'Acme');
  assertEquals(tags.Model, 'Model 1');
});

test('buildTiff approximates decimal rationals without thousandths truncation', async () => {
  const resolution = 3.14159265;
  const { bytes } = buildTiff({ XResolution: resolution });
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-XResolution', file]);
    assertEquals(Math.abs(JSON.parse(stdout)[0].XResolution - resolution) < 1e-8, true);
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff writes IFD0 Rating fields as SHORT values', async () => {
  const values = { Rating: 4, RatingPercent: 85 };
  const { bytes, written, skipped } = buildTiff(values);
  assertEquals(written, Object.keys(values));
  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-IFD0:Rating', '-IFD0:RatingPercent', file]);
    assertEquals(JSON.parse(stdout)[0], { SourceFile: file, ...values });
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff writes raw GeoTIFF directory and parameter fields', async () => {
  const values = {
    GeoTiffDirectory: [1, 1, 0, 0],
    GeoTiffDoubleParams: [1.5, 2.25],
    GeoTiffAsciiParams: 'Projected|WGS 84|',
  };
  const { bytes, written, skipped } = buildTiff(values);
  assertEquals(written, Object.keys(values));
  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout: directory } = await execFileP(upstreamExifTool, ['-b', '-GeoTiffDirectory', file], { encoding: 'buffer' });
    assertEquals(new Uint8Array(directory), new Uint8Array([1, 0, 1, 0, 0, 0, 0, 0, 0x49, 0x49]));
    const doubleParams = new Uint8Array(18);
    const view = new DataView(doubleParams.buffer);
    view.setFloat64(0, 1.5, true);
    view.setFloat64(8, 2.25, true);
    doubleParams.set([0x49, 0x49], 16);
    const { stdout: doubles } = await execFileP(upstreamExifTool, ['-b', '-GeoTiffDoubleParams', file], { encoding: 'buffer' });
    assertEquals(new Uint8Array(doubles), doubleParams);
    const { stdout: ascii } = await execFileP(upstreamExifTool, ['-b', '-GeoTiffAsciiParams', file], { encoding: 'buffer' });
    assertEquals(new Uint8Array(ascii), new TextEncoder().encode('Projected|WGS 84|\0'));
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff writes the writable IFD0 SEMInfo ASCII field', async () => {
  const { bytes, written, skipped } = buildTiff({ SEMInfo: 'Sensor model metadata' });
  assertEquals(written, ['SEMInfo']);
  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-IFD0:SEMInfo', file]);
    assertEquals(JSON.parse(stdout)[0].SEMInfo, 'Sensor model metadata');
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff writes additional writable IFD0 ASCII tags', async () => {
  const { bytes, written, skipped } = buildTiff({
    ProcessingSoftware: 'ACDSee',
    DocumentName: 'Archive scan',
    PageName: 'Page 4',
    HostComputer: 'Workstation',
    TargetPrinter: 'Press 2',
    XPosition: 12.5,
    YPosition: 22.75,
  });
  assertEquals(written, ['ProcessingSoftware', 'DocumentName', 'PageName', 'HostComputer', 'TargetPrinter', 'XPosition', 'YPosition']);
  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-ProcessingSoftware', '-DocumentName', '-PageName', '-HostComputer', '-TargetPrinter', '-XPosition', '-YPosition', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.ProcessingSoftware, 'ACDSee');
    assertEquals(tags.DocumentName, 'Archive scan');
    assertEquals(tags.PageName, 'Page 4');
    assertEquals(tags.HostComputer, 'Workstation');
    assertEquals(tags.TargetPrinter, 'Press 2');
    assertEquals(tags.XPosition, 12.5);
    assertEquals(tags.YPosition, 22.75);
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff writes IFD0 image dimensions as LONG values', async () => {
  const { bytes, written, skipped } = buildTiff({ ImageWidth: 4000, ImageHeight: 3000 });
  assertEquals(written, ['ImageWidth', 'ImageHeight']);
  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-ImageWidth', '-ImageHeight', file]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.ImageWidth, 4000);
    assertEquals(tags.ImageHeight, 3000);
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff writes DNG versions and camera model fields', async () => {
  const { bytes, written, skipped } = buildTiff({
    DNGVersion: '1.4.0.0',
    DNGBackwardVersion: '1.1.0.0',
    UniqueCameraModel: 'Acme Sensor',
    LocalizedCameraModel: 'München Sensor',
  });
  assertEquals(written, ['DNGVersion', 'DNGBackwardVersion', 'UniqueCameraModel', 'LocalizedCameraModel']);
  assertEquals(skipped, []);
  assertEquals(buildTiff({ DNGVersion: '1.4.0' }).skipped, ['DNGVersion']);
  assertEquals(buildTiff({ DNGVersion: '1.4.256.0' }).skipped, ['DNGVersion']);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', '-DNGVersion', '-DNGBackwardVersion', '-UniqueCameraModel', '-LocalizedCameraModel', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.DNGVersion, '1 4 0 0');
    assertEquals(tags.DNGBackwardVersion, '1 1 0 0');
    assertEquals(tags.UniqueCameraModel, 'Acme Sensor');
    assertEquals(tags.LocalizedCameraModel, 'München Sensor');
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff writes DNG rational calibration fields', async () => {
  const values = {
    ColorMatrix1: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    AsShotNeutral: [0.5, 2 / 3, 0.75],
    AsShotWhiteXY: [[3127, 10000], [329, 1000]],
    BaselineExposure: [-1, 2],
  };
  const { bytes, written, skipped } = buildTiff(values);
  assertEquals(written, Object.keys(values));
  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', '-ColorMatrix1', '-AsShotNeutral', '-AsShotWhiteXY', '-BaselineExposure', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.ColorMatrix1, '1 0 0 0 1 0 0 0 1');
    assertEquals(tags.AsShotNeutral, '0.5 0.6666666667 0.75');
    assertEquals(tags.AsShotWhiteXY, '0.3127 0.329');
    assertEquals(tags.BaselineExposure, -0.5);
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff writes DNG camera calibration and forward matrices', async () => {
  const identity = [[1, 1], [0, 1], [0, 1], [0, 1], [1, 1], [0, 1], [0, 1], [0, 1], [1, 1]];
  const values = {
    ColorMatrix2: identity,
    CameraCalibration1: [[1, 1], [0, 1], [0, 1], [1, 1]],
    CameraCalibration2: [[1, 1], [0, 1], [0, 1], [1, 1]],
    ReductionMatrix1: [[1, 1], [0, 1], [0, 1], [1, 1]],
    ReductionMatrix2: [[1, 1], [0, 1], [0, 1], [1, 1]],
    AnalogBalance: [[1, 1], [1, 1], [1, 1]],
    BaselineNoise: [1, 4],
    BaselineSharpness: [3, 2],
    LinearResponseLimit: [1, 1],
    ForwardMatrix1: identity,
    ForwardMatrix2: identity,
  };
  const { bytes, written, skipped } = buildTiff(values);
  assertEquals(written, Object.keys(values));
  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', ...Object.keys(values).map((name) => `-IFD0:${name}`), file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.ColorMatrix2, '1 0 0 0 1 0 0 0 1');
    assertEquals(tags.CameraCalibration1, '1 0 0 1');
    assertEquals(tags.CameraCalibration2, '1 0 0 1');
    assertEquals(tags.ReductionMatrix1, '1 0 0 1');
    assertEquals(tags.ReductionMatrix2, '1 0 0 1');
    assertEquals(tags.AnalogBalance, '1 1 1');
    assertEquals(tags.BaselineNoise, 0.25);
    assertEquals(tags.BaselineSharpness, 1.5);
    assertEquals(tags.LinearResponseLimit, 1);
    assertEquals(tags.ForwardMatrix1, '1 0 0 0 1 0 0 0 1');
    assertEquals(tags.ForwardMatrix2, '1 0 0 0 1 0 0 0 1');
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff writes DNG 1.4 size, profile, and preview fields', async () => {
  const values = {
    OriginalDefaultFinalSize: [4000, 3000],
    OriginalBestQualitySize: [2000, 1500],
    OriginalDefaultCropSize: [[1, 2], [3, 4]],
    BaselineExposureOffset: [-1, 4],
    RawToPreviewGain: 1.25,
    ProfileEmbedPolicy: 'No Restrictions',
    DefaultBlackRender: 'None',
    ReelName: 'Unit 7',
    CameraLabel: 'Front sensor',
  };
  const { bytes, written, skipped } = buildTiff(values);
  assertEquals(written, Object.keys(values));
  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', ...Object.keys(values).map((name) => `-IFD0:${name}`), file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.OriginalDefaultFinalSize, '4000 3000');
    assertEquals(tags.OriginalBestQualitySize, '2000 1500');
    assertEquals(tags.OriginalDefaultCropSize, '0.5 0.75');
    assertEquals(tags.BaselineExposureOffset, -0.25);
    assertEquals(tags.RawToPreviewGain, 1.25);
    assertEquals(tags.ProfileEmbedPolicy, 3);
    assertEquals(tags.DefaultBlackRender, 1);
    assertEquals(tags.ReelName, 'Unit 7');
    assertEquals(tags.CameraLabel, 'Front sensor');
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff writes DNG illuminant, pre-profile, and encoding fields', async () => {
  const values = {
    CalibrationIlluminant1: 'D65',
    CalibrationIlluminant2: 'Standard light A',
    OriginalRawFileName: 'capture.dng',
    AsShotPreProfileMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    CurrentPreProfileMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    FrameRate: [-24, 1],
    TStop: [[28, 10], [4, 1]],
    ProfileHueSatMapEncoding: 'sRGB',
    ProfileLookTableEncoding: 'Linear',
    ColorimetricReference: 'Scene-referred',
  };
  const { bytes, written, skipped } = buildTiff(values);
  assertEquals(written, Object.keys(values));
  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', ...Object.keys(values).map((name) => `-IFD0:${name}`), file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.CalibrationIlluminant1, 21);
    assertEquals(tags.CalibrationIlluminant2, 17);
    assertEquals(tags.OriginalRawFileName, 'capture.dng');
    assertEquals(tags.AsShotPreProfileMatrix, '1 0 0 0 1 0 0 0 1');
    assertEquals(tags.CurrentPreProfileMatrix, '1 0 0 0 1 0 0 0 1');
    assertEquals(tags.FrameRate, -24);
    assertEquals(tags.TStop, '2.8 4');
    assertEquals(tags.ProfileHueSatMapEncoding, 1);
    assertEquals(tags.ProfileLookTableEncoding, 0);
    assertEquals(tags.ColorimetricReference, 0);
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff converts DNG digest hex values to fixed UNDEFINED bytes', async () => {
  const values = {
    RawDataUniqueID: '00112233445566778899AABBCCDDEEFF',
    PreviewSettingsDigest: '1020304050607080',
    RawImageDigest: 'FFEEDDCCBBAA99887766554433221100',
    OriginalRawFileDigest: '0123456789ABCDEF0011223344556677',
    NewRawImageDigest: '89ABCDEF012345670011223344556677',
  };
  const { bytes, written, skipped } = buildTiff(values);
  assertEquals(written, Object.keys(values));
  assertEquals(skipped, []);
  assertEquals(buildTiff({ RawDataUniqueID: '1234' }).skipped, ['RawDataUniqueID']);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', ...Object.keys(values).map((name) => `-IFD0:${name}`), file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.RawDataUniqueID, '00112233445566778899AABBCCDDEEFF');
    assertEquals(tags.PreviewSettingsDigest, '1020304050607080');
    assertEquals(tags.RawImageDigest, 'ffeeddccbbaa99887766554433221100');
    assertEquals(tags.OriginalRawFileDigest, '0123456789abcdef0011223344556677');
    assertEquals(tags.NewRawImageDigest, '89abcdef012345670011223344556677');
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff writes DNG private bytes and MakerNoteSafety', async () => {
  const privateData = new Uint8Array([0x44, 0x4e, 0x47, 0x01, 0x00, 0xff]);
  const { bytes, written, skipped } = buildTiff({
    DNGPrivateData: privateData,
    MakerNoteSafety: 'Safe',
  });
  assertEquals(written, ['DNGPrivateData', 'MakerNoteSafety']);
  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout: raw } = await execFileP(upstreamExifTool, ['-b', '-DNGPrivateData', file], {
      encoding: 'buffer',
    });
    assertEquals(new Uint8Array(raw), privateData);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-MakerNoteSafety', file]);
    assertEquals(JSON.parse(stdout)[0].MakerNoteSafety, 1);
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff writes DNG profile and preview strings', async () => {
  const values = {
    CameraCalibrationSig: 'Camera Δ',
    ProfileCalibrationSig: 'Profile β',
    AsShotProfileName: 'Scene profile',
    ProfileName: 'Output profile',
    ProfileCopyright: 'Copyright © 2025',
    PreviewApplicationName: 'Renderer',
    PreviewApplicationVersion: '2.1',
    PreviewSettingsName: 'Soft proof',
    PreviewColorSpace: 'ProPhoto RGB',
    PreviewDateTime: '2024:01:02 03:04:05',
  };
  const { bytes, written, skipped } = buildTiff(values);
  assertEquals(written, Object.keys(values));
  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', ...Object.keys(values).map((name) => `-IFD0:${name}`), file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.CameraCalibrationSig, 'Camera Δ');
    assertEquals(tags.ProfileCalibrationSig, 'Profile β');
    assertEquals(tags.AsShotProfileName, 'Scene profile');
    assertEquals(tags.ProfileName, 'Output profile');
    assertEquals(tags.ProfileCopyright, 'Copyright © 2025');
    assertEquals(tags.PreviewApplicationName, 'Renderer');
    assertEquals(tags.PreviewApplicationVersion, 2.1);
    assertEquals(tags.PreviewSettingsName, 'Soft proof');
    assertEquals(tags.PreviewColorSpace, 4);
    assertEquals(tags.PreviewDateTime, '2024:01:02 03:04:05');
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff creates a SubIFD for DNG black-level and crop tags', async () => {
  const thumbnail = new Uint8Array(await readFile(new URL('../../assets/01.jpg', import.meta.url)));
  const values = {
    Make: 'DNG test body',
    'SubIFD:BestQualityScale': [3, 2],
    'SubIFD:ChromaBlurRadius': [1, 2],
    'SubIFD:AntiAliasStrength': [3, 4],
    'SubIFD:ActiveArea': [0, 0, 3000, 4000],
    'SubIFD:MaskedAreas': [0, 0, 10, 10],
    'SubIFD:NoiseReductionApplied': [1, 2],
    'SubIFD:DefaultUserCrop': [0, 0, 1, 1],
    'SubIFD:LinearizationTable': [0, 1, 2, 3],
    'SubIFD:BlackLevelRepeatDim': [2, 2],
    'SubIFD:BlackLevel': [[1, 16], [1, 16], [1, 16], [1, 16]],
    'SubIFD:BlackLevelDeltaH': [[-1, 100], [1, 100]],
    'SubIFD:BlackLevelDeltaV': [[-2, 100], [2, 100]],
    'SubIFD:WhiteLevel': [4095, 4095, 4095],
    'SubIFD:BayerGreenSplit': 2,
    'SubIFD:NoiseProfile': [0.001, 0.002, 0.003],
    ShadowScale: [1, 2],
    'SubIFD:DefaultScale': [[1, 1], [1, 1]],
    'SubIFD:DefaultCropOrigin': [0, 0],
    'SubIFD:DefaultCropSize': [4000, 3000],
    ThumbnailImage: thumbnail,
  };
  const { bytes, written, skipped } = buildTiff(values);
  assertEquals(written, [
    'Make', 'BestQualityScale', 'ChromaBlurRadius', 'AntiAliasStrength', 'ActiveArea', 'MaskedAreas',
    'NoiseReductionApplied',
    'DefaultUserCrop', 'LinearizationTable', 'BlackLevelRepeatDim', 'BlackLevel', 'BlackLevelDeltaH',
    'BlackLevelDeltaV', 'WhiteLevel', 'BayerGreenSplit', 'NoiseProfile', 'ShadowScale',
    'DefaultScale', 'DefaultCropOrigin', 'DefaultCropSize', 'ThumbnailImage',
  ]);
  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout: thumbnailBytes } = await execFileP(upstreamExifTool, ['-b', '-ThumbnailImage', file], {
      encoding: 'buffer',
      maxBuffer: 4 * 1024 * 1024,
    });
    assertEquals(new Uint8Array(thumbnailBytes), thumbnail);
    const { stdout: linearizationBytes } = await execFileP(
      upstreamExifTool,
      ['-b', '-SubIFD:LinearizationTable', file],
      { encoding: 'buffer' },
    );
    assertEquals(new Uint8Array(linearizationBytes), new TextEncoder().encode('0 1 2 3'));
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-G1', '-n', '-SubIFD:BlackLevelRepeatDim', '-SubIFD:BlackLevel',
      '-SubIFD:BlackLevelDeltaH', '-SubIFD:BlackLevelDeltaV', '-SubIFD:WhiteLevel', '-Make',
      '-SubIFD:BayerGreenSplit', '-SubIFD:NoiseProfile',
      '-SubIFD:BestQualityScale', '-SubIFD:ChromaBlurRadius', '-SubIFD:AntiAliasStrength',
      '-SubIFD:ActiveArea', '-SubIFD:MaskedAreas', '-SubIFD:DefaultUserCrop',
      '-SubIFD:NoiseReductionApplied', '-ShadowScale',
      '-SubIFD:DefaultScale', '-SubIFD:DefaultCropOrigin', '-SubIFD:DefaultCropSize', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags['IFD0:Make'], 'DNG test body');
    assertEquals(tags['IFD0:ShadowScale'], 0.5);
    assertEquals(tags['SubIFD:BestQualityScale'], 1.5);
    assertEquals(tags['SubIFD:ChromaBlurRadius'], 0.5);
    assertEquals(tags['SubIFD:AntiAliasStrength'], 0.75);
    assertEquals(tags['SubIFD:ActiveArea'], '0 0 3000 4000');
    assertEquals(tags['SubIFD:MaskedAreas'], '0 0 10 10');
    assertEquals(tags['SubIFD:NoiseReductionApplied'], 0.5);
    assertEquals(tags['SubIFD:DefaultUserCrop'], '0 0 1 1');
    assertEquals(tags['SubIFD:BlackLevelRepeatDim'], '2 2');
    assertEquals(tags['SubIFD:BlackLevel'], '0.0625 0.0625 0.0625 0.0625');
    assertEquals(tags['SubIFD:BlackLevelDeltaH'], '-0.01 0.01');
    assertEquals(tags['SubIFD:BlackLevelDeltaV'], '-0.02 0.02');
    assertEquals(tags['SubIFD:WhiteLevel'], '4095 4095 4095');
    assertEquals(tags['SubIFD:BayerGreenSplit'], 2);
    assertEquals(tags['SubIFD:NoiseProfile'], '0.001 0.002 0.003');
    assertEquals(tags['SubIFD:DefaultScale'], '1 1');
    assertEquals(tags['SubIFD:DefaultCropOrigin'], '0 0');
    assertEquals(tags['SubIFD:DefaultCropSize'], '4000 3000');
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff writes EXIF UNDEFINED byte enums', async () => {
  const { bytes, written, skipped } = buildTiff({
    FileSource: 'Digital Camera',
    SceneType: 'Directly photographed',
  });
  assertEquals(written, ['FileSource', 'SceneType', 'ExifVersion', 'ComponentsConfiguration', 'ColorSpace']);
  assertEquals(skipped, []);
  assertEquals(buildTiff({ FileSource: 'Sigma Digital Camera' }).written, [
    'FileSource', 'ExifVersion', 'ComponentsConfiguration', 'ColorSpace',
  ]);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-FileSource', '-SceneType', file]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.FileSource, 'Digital Camera');
    assertEquals(tags.SceneType, 'Directly photographed');
    const sigma = buildTiff({ FileSource: 'Sigma Digital Camera' });
    await writeFile(file, sigma.bytes);
    const { stdout: sigmaJson } = await execFileP(upstreamExifTool, ['-j', '-FileSource', file]);
    assertEquals(JSON.parse(sigmaJson)[0].FileSource, 'Sigma Digital Camera');
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff writes raw CFA pattern bytes', async () => {
  const pattern = '2 2 0 1 1 2';
  const { bytes, written, skipped } = buildTiff({ CFAPattern: pattern });
  assertEquals(written, ['CFAPattern', 'ExifVersion', 'ComponentsConfiguration', 'ColorSpace']);
  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-CFAPattern', file]);
    assertEquals(JSON.parse(stdout)[0].CFAPattern, pattern);
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff writes baseline sample and strip fields', async () => {
  const { bytes, written, skipped } = buildTiff({
    BitsPerSample: [8, 8, 8],
    SamplesPerPixel: 3,
    RowsPerStrip: 64,
    CellWidth: 2,
    CellLength: 2,
    MinSampleValue: 0,
    MaxSampleValue: 255,
  });
  assertEquals(written, ['BitsPerSample', 'SamplesPerPixel', 'RowsPerStrip', 'CellWidth', 'CellLength', 'MinSampleValue', 'MaxSampleValue']);
  assertEquals(skipped, []);
  assertEquals(buildTiff({ BitsPerSample: [] }).skipped, ['BitsPerSample']);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', '-BitsPerSample', '-SamplesPerPixel', '-RowsPerStrip', '-CellWidth', '-CellLength',
      '-MinSampleValue', '-MaxSampleValue', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.BitsPerSample, '8 8 8');
    assertEquals(tags.SamplesPerPixel, 3);
    assertEquals(tags.RowsPerStrip, 64);
    assertEquals(tags.CellWidth, 2);
    assertEquals(tags.CellLength, 2);
    assertEquals(tags.MinSampleValue, 0);
    assertEquals(tags.MaxSampleValue, 255);
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff writes raw IFD0 subfile types', async () => {
  const { bytes, written, skipped } = buildTiff({ SubfileType: 0, OldSubfileType: 1 });
  assertEquals(written, ['SubfileType', 'OldSubfileType']);
  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-SubfileType', '-OldSubfileType', file]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.SubfileType, 0);
    assertEquals(tags.OldSubfileType, 1);
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff inverse-converts SubfileType names', async () => {
  const { bytes, written, skipped } = buildTiff({ SubfileType: 'Full-resolution image' });
  assertEquals(written, ['SubfileType']);
  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-SubfileType', file]);
    assertEquals(JSON.parse(stdout)[0].SubfileType, 'Full-resolution image');
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff enforces fixed-count IFD0 rational colorimetry values', async () => {
  const { bytes, written, skipped } = buildTiff({
    WhitePoint: [3127, 10000, 3290, 10000],
    PrimaryChromaticities: [6400, 10000, 3300, 10000, 3000, 10000, 6000, 10000, 1500, 10000, 600, 10000],
    HalftoneHints: [0, 255],
    YCbCrCoefficients: [299, 1000, 587, 1000, 114, 1000],
    YCbCrSubSampling: [2, 2],
    ReferenceBlackWhite: [0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1],
  });
  assertEquals(written, ['WhitePoint', 'PrimaryChromaticities', 'HalftoneHints', 'YCbCrCoefficients', 'YCbCrSubSampling', 'ReferenceBlackWhite']);
  assertEquals(skipped, []);
  assertEquals(buildTiff({ WhitePoint: [0.3127] }).skipped, ['WhitePoint']);
  assertEquals(buildTiff({ WhitePoint: 0.3127 }).skipped, ['WhitePoint']);
  assertEquals(buildTiff({ PrimaryChromaticities: [1, 2, 3, 4] }).skipped, ['PrimaryChromaticities']);
  assertEquals(buildTiff({ HalftoneHints: [0] }).skipped, ['HalftoneHints']);
  assertEquals(buildTiff({ YCbCrCoefficients: [1, 2] }).skipped, ['YCbCrCoefficients']);
  assertEquals(buildTiff({ YCbCrSubSampling: [2] }).skipped, ['YCbCrSubSampling']);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', '-WhitePoint', '-PrimaryChromaticities', '-HalftoneHints', '-YCbCrCoefficients', '-YCbCrSubSampling', '-ReferenceBlackWhite', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.WhitePoint, '0.3127 0.329');
    assertEquals(tags.PrimaryChromaticities, '0.64 0.33 0.3 0.6 0.15 0.06');
    assertEquals(tags.HalftoneHints, '0 255');
    assertEquals(tags.YCbCrCoefficients, '0.299 0.587 0.114');
    assertEquals(tags.YCbCrSubSampling, '2 2');
    assertEquals(tags.ReferenceBlackWhite, '0 1 0 1 0 1');
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff writes TIFF FLOAT and DOUBLE values', async () => {
  const { bytes, written, skipped } = buildTiff({
    PixelScale: [0.5, 0.5, 1.25],
    ModelTiePoint: [0, 0, 0, 100, 200, 0],
    ModelTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    JXLDistance: 0.25,
  });
  assertEquals(written, ['PixelScale', 'ModelTiePoint', 'ModelTransform', 'JXLDistance']);
  assertEquals(skipped, []);
  assertEquals(buildTiff({ PixelScale: [0.5, 0.5] }).skipped, ['PixelScale']);
  assertEquals(buildTiff({ ModelTransform: [1, 0, 0] }).skipped, ['ModelTransform']);
  assertEquals(buildTiff({ JXLDistance: Number.POSITIVE_INFINITY }).skipped, ['JXLDistance']);
  assertEquals(buildTiff({ JXLDistance: Number.MAX_VALUE }).skipped, ['JXLDistance']);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', '-PixelScale', '-ModelTiePoint', '-ModelTransform', '-JXLDistance', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.PixelScale, '0.5 0.5 1.25');
    assertEquals(tags.ModelTiePoint, '0 0 0 100 200 0');
    assertEquals(tags.ModelTransform, '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1');
    assertEquals(tags.JXLDistance, 0.25);
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff writes signed LONG values with bounds', async () => {
  const { bytes, written, skipped } = buildTiff({ OffsetSchema: -123456789 });
  assertEquals(written, ['OffsetSchema']);
  assertEquals(skipped, []);
  assertEquals(buildTiff({ OffsetSchema: 0x80000000 }).skipped, ['OffsetSchema']);
  assertEquals(buildTiff({ OffsetSchema: -0x80000001 }).skipped, ['OffsetSchema']);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-OffsetSchema', file]);
    assertEquals(JSON.parse(stdout)[0].OffsetSchema, -123456789);
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff encodes SHORT and RATIONAL values', () => {
  const { bytes } = buildTiff({
    Orientation: 1,
    XResolution: [300, 1],
    YResolution: 72.5,
    ResolutionUnit: '2',
  });
  const tags = extractExifFromTiff(bytes);
  assertEquals(tags.Orientation, 'Horizontal (normal)');
  assertEquals(tags.ResolutionUnit, 'inches');
});

test('buildTiff inverse-converts unambiguous enum names', async () => {
  const { bytes, written, skipped } = buildTiff({
    Orientation: 'rotate 90',
    ResolutionUnit: 'cm',
    PhotometricInterpretation: 'RGB',
    Thresholding: 'ordered dither',
    FillOrder: 'rev',
    Compression: 'LZW',
    PlanarConfiguration: 'planar',
    Predictor: 'Horizontal differencing',
  });
  assertEquals(written, ['Orientation', 'ResolutionUnit', 'PhotometricInterpretation', 'Thresholding', 'FillOrder', 'Compression', 'PlanarConfiguration', 'Predictor']);
  assertEquals(skipped, []);
  assertEquals(buildTiff({ Orientation: 'Mirror horizontal' }).skipped, []);
  assertEquals(buildTiff({ Orientation: 'mirror' }).skipped, ['Orientation']);
  assertEquals(buildTiff({ Compression: 'JPEG' }).skipped, ['Compression']);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-Orientation', '-ResolutionUnit', '-PhotometricInterpretation', '-Thresholding', '-FillOrder',
      '-Compression', '-PlanarConfiguration', '-Predictor', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.Orientation, 'Rotate 90 CW');
    assertEquals(tags.ResolutionUnit, 'cm');
    assertEquals(tags.PhotometricInterpretation, 'RGB');
    assertEquals(tags.Thresholding, 'Ordered dither or halftone');
    assertEquals(tags.FillOrder, 'Reversed');
    assertEquals(tags.Compression, 'LZW');
    assertEquals(tags.PlanarConfiguration, 'Planar');
    assertEquals(tags.Predictor, 'Horizontal differencing');
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff inverse-converts common ExifIFD enum labels', async () => {
  const values = {
    ExposureProgram: 'Manual',
    MeteringMode: 'Spot',
    LightSource: 'Daylight',
    SensingMethod: 'Trilinear',
    SensitivityType: 'ISO Speed',
    CustomRendered: 'HDR (original saved)',
    ExposureMode: 'Auto bracket',
    WhiteBalance: 'Manual',
    SceneCaptureType: 'Landscape',
    GainControl: 'High gain up',
    Contrast: 'High',
    Saturation: 'Low',
    Sharpness: 'Soft',
    SubjectDistanceRange: 'Macro',
    CompositeImage: 'General composite image',
    ColorSpace: 'Uncalibrated',
    FocalPlaneResolutionUnit: 'mm',
    GPSDifferential: 'Differential Corrected',
    YCbCrPositioning: 'Co-sited',
  };
  const { bytes, written, skipped } = buildTiff(values);
  assertEquals(written, [
    ...Object.keys(values), 'GPSVersionID', 'ExifVersion', 'ComponentsConfiguration',
  ]);
  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-ExposureProgram', '-MeteringMode', '-LightSource', '-SensingMethod', '-SensitivityType',
      '-CustomRendered', '-ExposureMode', '-WhiteBalance', '-SceneCaptureType', '-GainControl',
      '-Contrast', '-Saturation', '-Sharpness', '-SubjectDistanceRange', '-CompositeImage',
      '-ColorSpace', '-FocalPlaneResolutionUnit', '-GPSDifferential', '-YCbCrPositioning', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.ExposureProgram, 'Manual');
    assertEquals(tags.MeteringMode, 'Spot');
    assertEquals(tags.LightSource, 'Daylight');
    assertEquals(tags.SensingMethod, 'Trilinear');
    assertEquals(tags.SensitivityType, 'ISO Speed');
    assertEquals(tags.CustomRendered, 'HDR (original saved)');
    assertEquals(tags.ExposureMode, 'Auto bracket');
    assertEquals(tags.WhiteBalance, 'Manual');
    assertEquals(tags.SceneCaptureType, 'Landscape');
    assertEquals(tags.GainControl, 'High gain up');
    assertEquals(tags.Contrast, 'High');
    assertEquals(tags.Saturation, 'Low');
    assertEquals(tags.Sharpness, 'Soft');
    assertEquals(tags.SubjectDistanceRange, 'Macro');
    assertEquals(tags.CompositeImage, 'General Composite Image');
    assertEquals(tags.ColorSpace, 'Uncalibrated');
    assertEquals(tags.FocalPlaneResolutionUnit, 'mm');
    assertEquals(tags.GPSDifferential, 'Differential Corrected');
    assertEquals(tags.YCbCrPositioning, 'Co-sited');
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff writes the ExifTool Wide Gamut RGB ColorSpace code', async () => {
  const { bytes, skipped } = buildTiff({ ColorSpace: 'Wide Gamut RGB' });
  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-ColorSpace', file]);
    assertEquals(JSON.parse(stdout)[0].ColorSpace, 65533);
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff honors # raw mode for enum-valued tags', async () => {
  const { bytes, written, skipped } = buildTiff({
    'Orientation#': '6',
    'ExifIFD:ExposureProgram#': 1,
  });
  assertEquals(written, ['Orientation', 'ExposureProgram', 'ExifVersion', 'ComponentsConfiguration', 'ColorSpace']);
  assertEquals(skipped, []);
  assertEquals(buildTiff({ 'Orientation#': 'Rotate 90 CW' }).skipped, ['Orientation#']);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-Orientation', '-ExposureProgram', file]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.Orientation, 'Rotate 90 CW');
    assertEquals(tags.ExposureProgram, 'Manual');
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff writes generated depth and DNG illuminant enums', async () => {
  const values = {
    DepthFormat: 'Linear',
    DepthUnits: 'Meters',
    DepthMeasureType: 'Optical Axis',
    CalibrationIlluminant3: 'D65',
  };
  const { bytes, written, skipped } = buildTiff(values);
  assertEquals(written, Object.keys(values));
  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', '-DepthFormat', '-DepthUnits', '-DepthMeasureType', '-CalibrationIlluminant3', file,
    ]);
    assertEquals(JSON.parse(stdout)[0], {
      SourceFile: file,
      DepthFormat: 1,
      DepthUnits: 1,
      DepthMeasureType: 1,
      CalibrationIlluminant3: 21,
    });
  } finally {
    await rm(file, { force: true });
  }
});
test('buildTiff accepts fraction strings for rational tags', () => {
  const { bytes } = buildTiff({ XResolution: '300/1' });
  assertEquals(extractExifFromTiff(bytes).XResolution, 300);
});

test('buildTiff inverse-converts formatted EXIF units, APEX values, and LensInfo', async () => {
  const values = {
    FocalLength: '50 mm',
    SubjectDistance: '3.5 m',
    GPSHPositioningError: '5 m',
    ApertureValue: 4,
    MaxApertureValue: 2,
    ShutterSpeedValue: '1/32',
    LensInfo: '24-70mm f/2.8-4',
    CameraSerialNumber: 'DNG-1234',
    DNGLensInfo: '24-70mm f/2.8-4',
  };
  const { bytes, written, skipped } = buildTiff(values);
  assertEquals(written, [
    ...Object.keys(values), 'GPSVersionID', 'ExifVersion', 'ComponentsConfiguration', 'ColorSpace',
  ]);
  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', '-FocalLength', '-SubjectDistance', '-GPSHPositioningError',
      '-ApertureValue', '-MaxApertureValue', '-ShutterSpeedValue', '-LensInfo',
      '-CameraSerialNumber', '-DNGLensInfo', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.FocalLength, 50);
    assertEquals(tags.SubjectDistance, 3.5);
    assertEquals(tags.GPSHPositioningError, 5);
    assertEquals(tags.ApertureValue, 4);
    assertEquals(tags.MaxApertureValue, 2);
    assertEquals(tags.ShutterSpeedValue, 0.03125);
    assertEquals(tags.LensInfo, '24 70 2.8 4');
    assertEquals(tags.CameraSerialNumber, 'DNG-1234');
    assertEquals(tags.DNGLensInfo, '24 70 2.8 4');
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff skips rational components outside TIFF field bounds', () => {
  const unsigned = buildTiff({
    XResolution: [-1, 1],
    YResolution: [0x1_0000_0000, 1],
  });
  assertEquals(unsigned.skipped.sort(), ['XResolution', 'YResolution']);
  const signed = buildTiff({ ShutterSpeedValue: [0x8000_0000, 1] });
  assertEquals(signed.skipped, ['ShutterSpeedValue']);
});

test('buildTiff enforces fixed-count SHORT arrays and component bounds', () => {
  assertEquals(buildTiff({ SubjectLocation: [100] }).skipped, ['SubjectLocation']);
  assertEquals(buildTiff({ SubjectLocation: [100, 0x1_0000] }).skipped, ['SubjectLocation']);
  assertEquals(buildTiff({ ComponentsConfiguration: [1, 2, 3] }).skipped, ['ComponentsConfiguration']);
  assertEquals(buildTiff({ ComponentsConfiguration: [1, 2, 3, 256] }).skipped, ['ComponentsConfiguration']);
  assertEquals(
    buildTiff({ ComponentsConfiguration: new Uint8Array([1, 2]) }).skipped,
    ['ComponentsConfiguration'],
  );
  assertEquals(
    buildTiff({ ComponentsConfiguration: new Uint8Array([1, 2, 3, 0]) }).skipped,
    [],
  );
  assertEquals(buildTiff({ ComponentsConfiguration: '123456' }).skipped, ['ComponentsConfiguration']);
});

test('buildTiff encodes negative decimal GPS coordinates as positive magnitudes with S/W refs', () => {
  const { bytes } = buildTiff({ GPSLatitude: '-43.5', GPSLongitude: -71.25 });
  const tags = extractExifFromTiff(bytes);
  assertEquals(String(tags.GPSLatitude).endsWith('S'), true);
  assertEquals(tags.GPSLongitudeRef, 'West');
  assertEquals(String(tags.GPSLongitude).endsWith('W'), true);
});

test('buildTiff skips unknown tag names and reports them', () => {
  const { written, skipped } = buildTiff({ Make: 'A', NotARealTag: 100 });
  assertEquals(written.includes('Make'), true);
  assertEquals(skipped, ['NotARealTag']);
});

test('buildTiff matches names case-insensitively', () => {
  const { bytes, written } = buildTiff({ MAKE: 'Zeta' });
  assertEquals(written.includes('Make'), true);
  assertEquals(extractExifFromTiff(bytes).Make, 'Zeta');
});

test('buildTiff rejects out-of-range SHORT values as skipped', () => {
  const { skipped } = buildTiff({ Orientation: 70000 });
  assertEquals(skipped, ['Orientation']);
});

test('encodeValue supports TIFF BYTE arrays and signed BYTE bounds', () => {
  const byteSpec = { id: 65000, type: 1 as const, name: 'ByteArray', count: 3 };
  const bytes = new Uint8Array([0, 128, 255]);
  assertEquals(encodeValue(byteSpec, bytes)?.data, bytes);
  const signedSpec = { id: 65001, type: 6 as const, name: 'SignedByte' };
  assertEquals(Array.from(encodeValue(signedSpec, -128)!.data), [128]);
  assertEquals(Array.from(encodeValue(signedSpec, 127)!.data), [127]);
  assertEquals(encodeValue(signedSpec, -129), undefined);
  assertEquals(encodeValue(signedSpec, 128), undefined);
});

test('buildTiff rounds fractional values written to unsigned integer fields', () => {
  const { bytes, skipped } = buildTiff({ ExifImageWidth: 1.5, ExifImageHeight: 2.6 });
  assertEquals(skipped, []);
  const tags = extractExifFromTiff(bytes);
  assertEquals(tags.PixelXDimension, 2);
  assertEquals(tags.PixelYDimension, 3);
  assertEquals(buildTiff({ ExifImageWidth: 0x1_0000_0000 }).skipped, ['ExifImageWidth']);
});

test('buildTiff pads oversized odd-length values to even offsets', () => {
  // ImageDescription of 6 characters -> 7 bytes with NUL -> needs padding.
  const { bytes } = buildTiff({ ImageDescription: 'abcdef', Make: 'X' });
  assertEquals(bytes.length % 2, 0);
  assertEquals(extractExifFromTiff(bytes).ImageDescription, 'abcdef');
});

test('buildTiff maps ModifyDate onto the DateTime field', () => {
  const { written, bytes } = buildTiff({ ModifyDate: '2024:01:02 03:04:05' });
  assertEquals(written, ['DateTime']);
  assertEquals(extractExifFromTiff(bytes).DateTime, '2024:01:02 03:04:05');
});

test('buildTiff coerces booleans and plain numeric strings for ascii tags', () => {
  const { bytes } = buildTiff({ Make: true, Software: '7' });
  const tags = extractExifFromTiff(bytes);
  assertEquals(tags.Make, 'true');
  assertEquals(tags.Software, '7');
});

test('buildTiff accepts plain numeric strings for rational tags', () => {
  const { bytes } = buildTiff({ XResolution: '350' });
  assertEquals(extractExifFromTiff(bytes).XResolution, 350);
});

test('buildTiff skips values that cannot encode to the target type', () => {
  const { skipped } = buildTiff({
    Make: new Uint8Array([1]),
    Orientation: 'abc',
    XResolution: null,
    YResolution: [1, 'x'],
    Software: [],
  });
  assertEquals(skipped.sort(), [
    'Make',
    'Orientation',
    'Software',
    'XResolution',
    'YResolution',
  ]);
});

test('buildTiff writes ExifIFD and GPS IFDs readable by the TIFF parser', () => {
  const { bytes, written } = buildTiff({
    Make: 'Acme',
    DateTimeOriginal: '2024:01:02 03:04:05',
    ExposureTime: [1, 250],
    FNumber: 2.8,
    ISOSpeedRatings: 200,
    ExifVersion: '0231',
    UserComment: 'Hello world',
    ExifImageWidth: 4000,
    GPSLatitude: "43 deg 28' 2.00\" N",
    GPSLongitude: "11 deg 21' 0.00\" E",
    GPSAltitude: '12 m',
    GPSTimeStamp: '10:20:30',
  });
  assertEquals(written.includes('DateTimeOriginal'), true);
  assertEquals(written.includes('ExposureTime'), true);
  assertEquals(written.includes('GPSLatitudeRef'), true); // synthesized from the coordinate
  const tags = extractExifFromTiff(bytes);
  assertEquals(tags.Make, 'Acme');
  assertEquals(tags.DateTimeOriginal, '2024:01:02 03:04:05');
  assertEquals(tags.ExposureTime, '1/250');
  assertEquals(tags.FNumber, 2.8);
  assertEquals(tags.ISOSpeedRatings, 200);
  assertEquals(tags.PixelXDimension, 4000);
  assertEquals(tags.GPSLatitude, "43 deg 28' 2.00\" N");
  assertEquals(tags.GPSLatitudeRef, 'North');
  assertEquals(tags.GPSAltitude, '12 m');
});

test('buildTiff routes group-qualified tags to their requested IFD', async () => {
  const { bytes, written, skipped } = buildTiff({
    'IFD0:Make': 'Acme',
    'IFD0:ProcessingSoftware': 'Acme Tools',
    'ExifIFD:DateTimeOriginal': '2024:01:02 03:04:05',
    'GPS:GPSDOP': 1.5,
    'GPS:GPSMapDatum': 'WGS-84',
    'GPS:GPSLatitude': '43.5',
    'GPS:GPSLatitudeRef': 'S',
  });
  assertEquals(written, [
    'Make', 'ProcessingSoftware', 'DateTimeOriginal', 'GPSDOP', 'GPSMapDatum', 'GPSLatitude', 'GPSLatitudeRef',
    'GPSVersionID', 'ExifVersion', 'ComponentsConfiguration', 'ColorSpace',
  ]);
  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', '-IFD0:Make', '-IFD0:ProcessingSoftware',
      '-ExifIFD:DateTimeOriginal', '-GPS:GPSDOP', '-GPS:GPSMapDatum', '-GPS:GPSLatitude', '-GPS:GPSLatitudeRef', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.Make, 'Acme');
    assertEquals(tags.ProcessingSoftware, 'Acme Tools');
    assertEquals(tags.DateTimeOriginal, '2024:01:02 03:04:05');
    assertEquals(tags.GPSDOP, 1.5);
    assertEquals(tags.GPSMapDatum, 'WGS-84');
    assertEquals(tags.GPSLatitudeRef, 'S');
  } finally {
    await rm(file, { force: true });
  }
  assertEquals(buildTiff({
    'ExifIFD:Make': 'wrong group',
    'IFD0:DateTimeOriginal': 'wrong group',
  }).skipped, ['ExifIFD:Make', 'IFD0:DateTimeOriginal']);
});

test('buildTiff writes a group-qualified InteropIFD through ExifIFD', async () => {
  const { bytes, written, skipped } = buildTiff({
    'IFD0:Make': 'Acme',
    'ExifIFD:DateTimeOriginal': '2024:01:02 03:04:05',
    'GPS:GPSMapDatum': 'WGS-84',
    InteropIndex: 'R98',
    'InteropIFD:InteropVersion': '0100',
    RelatedImageFileFormat: 'JPEG',
    'InteropIFD:RelatedImageWidth': 4000,
    'InteropIFD:RelatedImageHeight': 3000,
  });
  assertEquals(written, [
    'Make', 'DateTimeOriginal', 'GPSMapDatum', 'InteropIndex', 'InteropVersion',
    'RelatedImageFileFormat', 'RelatedImageWidth', 'RelatedImageHeight', 'GPSVersionID',
    'ExifVersion', 'ComponentsConfiguration', 'ColorSpace',
  ]);
  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', '-IFD0:Make', '-ExifIFD:DateTimeOriginal', '-GPS:GPSMapDatum',
      '-InteropIndex', '-InteropVersion', '-RelatedImageFileFormat', '-RelatedImageWidth', '-RelatedImageHeight', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.Make, 'Acme');
    assertEquals(tags.DateTimeOriginal, '2024:01:02 03:04:05');
    assertEquals(tags.GPSMapDatum, 'WGS-84');
    assertEquals(tags.InteropIndex, 'R98');
    assertEquals(tags.InteropVersion, '0100');
    assertEquals(tags.RelatedImageFileFormat, 'JPEG');
    assertEquals(tags.RelatedImageWidth, 4000);
    assertEquals(tags.RelatedImageHeight, 3000);
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff skips ordinary tags explicitly qualified to IFD1', () => {
  const { written, skipped } = buildTiff({ 'IFD1:Orientation': 3, 'IFD1:Artist': 'Wrong group' });
  assertEquals(written, []);
  assertEquals(skipped, ['IFD1:Orientation', 'IFD1:Artist']);
});

test('ExifTool resolves duplicate TIFF DateTime aliases in command-line order', async () => {
  const file = await tempFile('.tif');
  try {
    await writeFile(file, buildTiff({ Make: 'Alias probe' }).bytes);
    await execFileP(upstreamExifTool, [
      '-overwrite_original', '-DateTime=2024:01:02 03:04:05', '-ModifyDate=2025:06:07 08:09:10', file,
    ]);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-IFD0:ModifyDate', file]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.ModifyDate, '2025:06:07 08:09:10');
  } finally {
    await rm(file, { force: true });
  }
});

test('ExifTool creates mandatory GPSVersionID with a new GPS directory', async () => {
  const file = await tempFile('.tif');
  try {
    await writeFile(file, buildTiff({ Make: 'GPS mandatory probe' }).bytes);
    await execFileP(upstreamExifTool, ['-overwrite_original', '-GPS:GPSDOP=1.5', file]);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-GPS:GPSVersionID', '-GPS:GPSDOP', file]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.GPSDOP, 1.5);
    assertEquals(tags.GPSVersionID, '2 3 0 0');
  } finally {
    await rm(file, { force: true });
  }
});

test('ExifTool creates mandatory ExifVersion with a new ExifIFD', async () => {
  const file = await tempFile('.tif');
  try {
    await writeFile(file, buildTiff({ Make: 'Exif mandatory probe' }).bytes);
    await execFileP(upstreamExifTool, [
      '-overwrite_original', '-DateTimeOriginal=2024:01:02 03:04:05', file,
    ]);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-ExifVersion', '-DateTimeOriginal', file]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.DateTimeOriginal, '2024:01:02 03:04:05');
    assertEquals(tags.ExifVersion, '0232');
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff writes IFD0 tile width and length fields', async () => {
  const values = { TileWidth: 256, TileLength: 128 };
  const { bytes, written, skipped } = buildTiff(values);
  assertEquals(written, Object.keys(values));
  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-TileWidth', '-TileLength', file]);
    assertEquals(JSON.parse(stdout)[0], { SourceFile: file, ...values });
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff synthesizes mandatory ExifIFD defaults', async () => {
  const { bytes, written, skipped } = buildTiff({ DateTimeOriginal: '2024:01:02 03:04:05' });
  assertEquals(written, [
    'DateTimeOriginal', 'ExifVersion', 'ComponentsConfiguration', 'ColorSpace',
  ]);

  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', '-ExifVersion', '-ComponentsConfiguration', '-ColorSpace', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.ExifVersion, '0232');
    assertEquals(tags.ComponentsConfiguration, '1 2 3 0');
    assertEquals(tags.ColorSpace, 65535);
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff noMandatory suppresses synthesized values but keeps explicit mandatory tags', async () => {
  const values = {
    DateTimeOriginal: '2026:10:14 12:34:56',
    GPSDOP: 1.5,
    InteropIndex: 'R98',
    ExifVersion: '0231',
  };
  const { bytes, written, skipped } = buildTiff(values, { noMandatory: true });
  assertEquals(written, Object.keys(values));
  assertEquals(skipped, []);
  const bigTiff = buildTiff(
    { DateTimeOriginal: '2026:10:14 12:34:56' },
    { bigTiff: true, noMandatory: true },
  );
  assertEquals(bigTiff.written, ['DateTimeOriginal']);
  assertEquals(bigTiff.skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', '-DateTimeOriginal', '-GPSDOP', '-GPS:GPSVersionID', '-InteropIndex',
      '-InteropVersion', '-ExifVersion', '-ComponentsConfiguration', '-ColorSpace', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.DateTimeOriginal, '2026:10:14 12:34:56');
    assertEquals(tags.GPSDOP, 1.5);
    assertEquals(tags.GPSVersionID, undefined);
    assertEquals(tags.InteropIndex, 'R98');
    assertEquals(tags.InteropVersion, undefined);
    assertEquals(tags.ExifVersion, '0231');
    assertEquals(tags.ComponentsConfiguration, undefined);
    assertEquals(tags.ColorSpace, undefined);
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff writes signed offsets and remaining standard ExifIFD scalar fields', async () => {
  const values = {
    'ExifIFD:TimeZoneOffset': [-7, 2],
    'ExifIFD:SelfTimerMode': 3,
    'ExifIFD:StandardOutputSensitivity': 100,
    'ExifIFD:RecommendedExposureIndex': 200,
    'ExifIFD:ISOSpeed': 400,
    'ExifIFD:ISOSpeedLatitudeyyy': 20,
    'ExifIFD:ISOSpeedLatitudezzz': 30,
    'ExifIFD:ExposureIndex': [2, 1],
    'ExifIFD:CompositeImageCount': [4, 3],
    'ExifIFD:RelatedSoundFile': 'voice.wav',
  };

  const { bytes, written, skipped } = buildTiff(values);
  assertEquals(written, [
    ...Object.keys(values).map((key) => key.slice('ExifIFD:'.length)),
    'ExifVersion', 'ComponentsConfiguration', 'ColorSpace',
  ]);
  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', ...Object.keys(values).map((key) => `-${key}`), file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.TimeZoneOffset, '-7 2');
    assertEquals(tags.SelfTimerMode, 3);
    assertEquals(tags.StandardOutputSensitivity, 100);
    assertEquals(tags.RecommendedExposureIndex, 200);
    assertEquals(tags.ISOSpeed, 400);
    assertEquals(tags.ISOSpeedLatitudeyyy, 20);
    assertEquals(tags.ISOSpeedLatitudezzz, 30);
    assertEquals(tags.ExposureIndex, 2);
    assertEquals(tags.CompositeImageCount, '4 3');
    assertEquals(tags.RelatedSoundFile, 'voice.wav');
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff writes ExifIFD flash, image history, and classification fields', async () => {
  const values = {
    'ExifIFD:FlashEnergy': [5, 2],
    'ExifIFD:CompressedBitsPerPixel': [3, 2],
    'ExifIFD:ImageNumber': 42,
    'ExifIFD:SecurityClassification': 'Confidential',
    'ExifIFD:ImageHistory': 'Color corrected',
  };

  const { bytes, written, skipped } = buildTiff(values);
  assertEquals(written, [
    'FlashEnergy', 'CompressedBitsPerPixel', 'ImageNumber', 'SecurityClassification', 'ImageHistory',
    'ExifVersion', 'ComponentsConfiguration', 'ColorSpace',
  ]);
  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', ...Object.keys(values).map((key) => `-${key}`), file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.FlashEnergy, 2.5);
    assertEquals(tags.CompressedBitsPerPixel, 1.5);
    assertEquals(tags.ImageNumber, 42);
    assertEquals(tags.SecurityClassification, 'Confidential');
    assertEquals(tags.ImageHistory, 'Color corrected');
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff inverse-converts GrayResponseUnit decimal labels', async () => {
  const { bytes, written, skipped } = buildTiff({ GrayResponseUnit: '0.001', InkSet: 'CMYK' });
  assertEquals(written, ['GrayResponseUnit', 'InkSet']);
  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-GrayResponseUnit', file]);
    assertEquals(JSON.parse(stdout)[0].GrayResponseUnit, 0.001);
    const { stdout: raw } = await execFileP(upstreamExifTool, ['-j', '-n', '-GrayResponseUnit', '-InkSet', file]);
    assertEquals(JSON.parse(raw)[0].GrayResponseUnit, 2);
    assertEquals(JSON.parse(raw)[0].InkSet, 1);
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff writes the fixed-count TIFF TransferFunction array', async () => {
  const values = Array.from({ length: 768 }, (_, index) => index % 256);
  const { bytes, written, skipped } = buildTiff({ TransferFunction: values });
  assertEquals(written, ['TransferFunction']);
  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-b', '-TransferFunction', file], {
      encoding: 'buffer',
    });
    assertEquals(new Uint8Array(stdout), new TextEncoder().encode(values.join(' ')));
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff synthesizes mandatory GPSVersionID for a fresh GPS IFD', async () => {
  const { bytes, written, skipped } = buildTiff({ GPSDOP: 1.5 });
  assertEquals(written, ['GPSDOP', 'GPSVersionID']);
  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-GPS:GPSVersionID', '-GPS:GPSDOP', file]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.GPSDOP, 1.5);
    assertEquals(tags.GPSVersionID, '2 3 0 0');
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff uses the last valid value for duplicate TIFF tag aliases', async () => {
  const values = {
    DateTime: '2024:01:02 03:04:05',
    ModifyDate: '2025:06:07 08:09:10',
  };
  const { bytes, written, skipped } = buildTiff(values);
  assertEquals(written, ['DateTime']);
  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-IFD0:ModifyDate', file]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.ModifyDate, '2025:06:07 08:09:10');
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff synthesizes mandatory InteropVersion when creating an InteropIFD', async () => {
  const { bytes, written, skipped } = buildTiff({ InteropIndex: 'R98' });
  assertEquals(written, [
    'InteropIndex', 'ExifVersion', 'ComponentsConfiguration', 'ColorSpace', 'InteropVersion',
  ]);
  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-InteropIndex', '-InteropVersion', file]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.InteropIndex, 'R98');
    assertEquals(tags.InteropVersion, '0100');
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff writes big-endian TIFF values and nested directories', async () => {
  const { bytes, written, skipped } = buildTiff({
    'IFD0:Make': 'Big endian body',
    'IFD0:ImageWidth': 4000,
    'IFD0:Orientation': 6,
    'ExifIFD:ExposureTime': '1/125',
    'GPS:GPSDOP': 1.5,
    InteropIndex: 'R98',
    InteropVersion: '0100',
  }, { byteOrder: 'big' });
  assertEquals(written, [
    'Make', 'ImageWidth', 'Orientation', 'ExposureTime', 'GPSDOP', 'InteropIndex', 'InteropVersion', 'GPSVersionID',
    'ExifVersion', 'ComponentsConfiguration', 'ColorSpace',
  ]);
  assertEquals(skipped, []);
  assertEquals([bytes[0], bytes[1]], [0x4D, 0x4D]);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-IFD0:Make', '-IFD0:ImageWidth', '-IFD0:Orientation', '-ExifIFD:ExposureTime',
      '-GPS:GPSDOP', '-InteropIndex', '-InteropVersion', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.Make, 'Big endian body');
    assertEquals(tags.ImageWidth, 4000);
    assertEquals(tags.Orientation, 'Rotate 90 CW');
    assertEquals(tags.ExposureTime, '1/125');
    assertEquals(tags.GPSDOP, 1.5);
    assertEquals(tags.InteropIndex, 'R98 - DCF basic file (sRGB)');
    assertEquals(tags.InteropVersion, '0100');
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff writes a BigTIFF IFD0 with 64-bit directory fields', async () => {
  const values = {
    Make: 'BigTIFF camera body',
    ImageDescription: 'Out-of-line description value',
    ImageWidth: 4000,
    Orientation: 'Rotate 90 CW',
  };
  const { bytes, written, skipped } = buildTiff(values, { bigTiff: true });
  assertEquals(written, Object.keys(values));
  assertEquals(skipped, []);
  assertEquals([bytes[0], bytes[1], bytes[2], bytes[3]], [0x49, 0x49, 43, 0]);
  assertEquals([bytes[4], bytes[5], bytes[6], bytes[7]], [8, 0, 0, 0]);
  assertEquals(new DataView(bytes.buffer).getBigUint64(8, true), 16n);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', '-IFD0:Make', '-IFD0:ImageDescription', '-IFD0:ImageWidth', '-IFD0:Orientation', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.Make, 'BigTIFF camera body');
    assertEquals(tags.ImageDescription, 'Out-of-line description value');
    assertEquals(tags.ImageWidth, 4000);
    assertEquals(tags.Orientation, 6);
  } finally {
    await rm(file, { force: true });
  }
});

test('encodeValue writes BigTIFF LONG8, SLONG8, and IFD8 integers', () => {
  const unsigned = encodeValue({ id: 65000, type: 16, name: 'Long8' }, 0x100000000);
  const signed = encodeValue({ id: 65001, type: 17, name: 'SLong8' }, -0x100000000);
  const ifd = encodeValue({ id: 65002, type: 18, name: 'Ifd8' }, 0x100000000);
  assertEquals(unsigned?.count, 1);
  assertEquals(signed?.count, 1);
  assertEquals(ifd?.count, 1);
  assertEquals(new DataView(unsigned!.data.buffer).getBigUint64(0, true), 0x100000000n);
  assertEquals(new DataView(signed!.data.buffer).getBigInt64(0, true), -0x100000000n);
  assertEquals(new DataView(ifd!.data.buffer).getBigUint64(0, true), 0x100000000n);
  assertEquals(encodeValue({ id: 65000, type: 16, name: 'Long8' }, Number.MAX_SAFE_INTEGER + 1), undefined);
});

test('buildTiff writes linked ExifIFD and Interop directories in BigTIFF', async () => {
  const { bytes, written, skipped } = buildTiff({
    Make: 'BigTIFF nested body',
    DateTimeOriginal: '2024:01:02 03:04:05',
    GPSDOP: 1.5,
    InteropIndex: 'R98',
  }, { bigTiff: true });
  assertEquals(written, [
    'Make', 'DateTimeOriginal', 'InteropIndex',
    'ExifVersion', 'ComponentsConfiguration', 'ColorSpace', 'InteropVersion',
  ]);
  assertEquals(skipped, ['GPSDOP']);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', '-IFD0:Make', '-ExifOffset:DateTimeOriginal', '-InteropIndex', '-InteropVersion', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.Make, 'BigTIFF nested body');
    assertEquals(tags.DateTimeOriginal, '2024:01:02 03:04:05');
    assertEquals(tags.InteropIndex, 'R98');
    assertEquals(tags.InteropVersion, '0100');
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff writes big-endian BigTIFF directories', async () => {
  const { bytes, written, skipped } = buildTiff({
    Make: 'Big-endian BigTIFF',
    ImageWidth: 3000,
    DateTimeOriginal: '2024:02:03 04:05:06',
  }, { bigTiff: true, byteOrder: 'big' });
  assertEquals(written, ['Make', 'ImageWidth', 'DateTimeOriginal', 'ExifVersion', 'ComponentsConfiguration', 'ColorSpace']);
  assertEquals(skipped, []);
  assertEquals([bytes[0], bytes[1], bytes[2], bytes[3]], [0x4D, 0x4D, 0, 43]);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', '-IFD0:Make', '-IFD0:ImageWidth', '-ExifOffset:DateTimeOriginal', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.Make, 'Big-endian BigTIFF');
    assertEquals(tags.ImageWidth, 3000);
    assertEquals(tags.DateTimeOriginal, '2024:02:03 04:05:06');
  } finally {
    await rm(file, { force: true });
  }
});

test('buildTiff stores ThumbnailImage in a linked IFD1 with repaired offsets', async () => {
  const thumbnail = new Uint8Array(await readFile(new URL('../../assets/01.jpg', import.meta.url)));
  const { bytes, written, skipped } = buildTiff({
    Make: 'Thumbnail camera',
    DateTimeOriginal: '2024:01:02 03:04:05',
    GPSDOP: 1.5,
    InteropIndex: 'R98',
    InteropVersion: '0100',
    ThumbnailImage: thumbnail,
  });
  assertEquals(written, [
    'Make', 'DateTimeOriginal', 'GPSDOP', 'InteropIndex', 'InteropVersion', 'ThumbnailImage', 'GPSVersionID',
    'ExifVersion', 'ComponentsConfiguration', 'ColorSpace',
  ]);
  assertEquals(skipped, []);
  const file = await tempFile('.tif');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-b', '-ThumbnailImage', file], {
      encoding: 'buffer',
      maxBuffer: 4 * 1024 * 1024,
    });
    assertEquals(new Uint8Array(stdout), thumbnail);
    const { stdout: json } = await execFileP(upstreamExifTool, [
      '-j', '-Make', '-DateTimeOriginal', '-GPSDOP', '-InteropIndex', '-InteropVersion', file,
    ]);
    const tags = JSON.parse(json)[0];
    assertEquals(tags.Make, 'Thumbnail camera');
    assertEquals(tags.DateTimeOriginal, '2024:01:02 03:04:05');
    assertEquals(tags.GPSDOP, 1.5);
    assertEquals(tags.InteropIndex, 'R98 - DCF basic file (sRGB)');
    assertEquals(tags.InteropVersion, '0100');
  } finally {
    await rm(file, { force: true });
  }
});

test('UserComment and ExifVersion encode as UNDEFINED with exact bytes', () => {
  const { bytes } = buildTiff({ UserComment: 'Hi', ExifVersion: '0231' });
  const header = [0x41, 0x53, 0x43, 0x49, 0x49, 0, 0, 0]; // 'ASCII\0\0\0'
  const headerPos = bytes.length >= 8
    ? [...bytes.keys()].find((i) => header.every((b, j) => bytes[i + j] === b))
    : undefined;
  assertEquals(headerPos !== undefined, true);
  // '0231' raw bytes appear somewhere in the value area.
  const ver = [0x30, 0x32, 0x33, 0x31];
  assertEquals(ver.every((b) => bytes.includes(b)), true);
  const tags = extractExifFromTiff(bytes);
  assertEquals(tags.UserComment, '[65, 83, 67, 73, 73, 0, 0, 0, 72, 105]');
  assertEquals(tags.ExifVersion, '0231');
});

test('buildTiff rejects malformed EXIF and Flashpix version payloads', () => {
  const { skipped } = buildTiff({ ExifVersion: '12345', FlashpixVersion: '010' });
  assertEquals(skipped.sort(), ['ExifVersion', 'FlashpixVersion']);
});

test('ExifIFD pointer is synthesized only when the ExifIFD has tags', () => {
  const dv = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pointerIds = (bytes: Uint8Array) => {
    const view = dv(bytes);
    const count = view.getUint16(8, true);
    const ids: number[] = [];
    for (let i = 0; i < count; i++) ids.push(view.getUint16(10 + i * 12, true));
    return ids;
  };
  assertEquals(pointerIds(buildTiff({ Make: 'A' }).bytes).includes(0x8769), false);
  assertEquals(
    pointerIds(buildTiff({ DateTimeOriginal: '2024:01:02 03:04:05' }).bytes).includes(0x8769),
    true,
  );
  assertEquals(pointerIds(buildTiff({ GPSAltitude: 12 }).bytes).includes(0x8825), true);
});

test('skipped reporting covers unknown names and unencodable GPS values', () => {
  const { skipped } = buildTiff({ Make: 'A', NotARealTag: 1, GPSLatitude: 'not a coordinate' });
  assertEquals(skipped.sort(), ['GPSLatitude', 'NotARealTag']);
});

test('GPSLatitudeRef supplied explicitly suppresses the synthesized ref', () => {
  const { written } = buildTiff({ GPSLatitude: "10 deg 0' 0.00\" E", GPSLatitudeRef: 'South' });
  assertEquals(written.filter((n) => n === 'GPSLatitudeRef').length, 1);
  const tags = extractExifFromTiff(
    buildTiff({ GPSLatitude: "10 deg 0' 0.00\" S", GPSLatitudeRef: 'South' }).bytes,
  );
  assertEquals(tags.GPSLatitudeRef, 'South');
});
test('SRATIONAL tags encode negative exposure compensation', () => {
  const { bytes } = buildTiff({ ExposureCompensation: [-1, 3] });
  assertEquals(extractExifFromTiff(bytes).ExposureBiasValue, -1 / 3);
});

test('ShutterSpeedValue encodes as SRATIONAL APEX', () => {
  const { bytes } = buildTiff({ ShutterSpeedValue: [5, 1] });
  assertEquals(extractExifFromTiff(bytes).ShutterSpeedValue, '1/32');
});

test('GPSVersionID, GPSDateStamp, GPSTimeStamp, GPSAltitudeRef coerce', () => {
  const { bytes, skipped } = buildTiff({
    GPSVersionID: '2 3 0 0',
    GPSDateStamp: '2024-01-02',
    GPSTimeStamp: [10, 20, 30],
    GPSAltitudeRef: 'Above Sea Level',
    ExifImageHeight: 3000,
    LensInfo: [24, 70, 2.8, 4],
  });
  assertEquals(skipped, []);
  const tags = extractExifFromTiff(bytes);
  assertEquals(tags.GPSVersionID, '2.3.0.0');
  assertEquals(tags.GPSDateStamp, '2024:01:02');
  assertEquals(tags.GPSTimeStamp, '10:20:30');
  assertEquals(tags.GPSAltitudeRef, 'Above Sea Level');
  assertEquals(tags.LensSpecification, [24, 70, 2.8, 4]);
});
