import type { TagValue } from '../types.js';

/**
 * Result of building a TIFF structure.
 * @property bytes - Serialized TIFF bytes
 * @property written - Tag names successfully written
 * @property skipped - Tag names that could not be encoded
 */
export interface BuildTiffResult {
  bytes: Uint8Array;
  written: string[];
  skipped: string[];
}

export interface BuildTiffOptions {
  byteOrder?: 'little' | 'big';
  inversePrintConv?: boolean;
  bigTiff?: boolean;
  noMandatory?: boolean;
}

export interface IfdTagSpec {
  id: number;
  type: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 16 | 17 | 18; // TIFF and BigTIFF field types
  name: string;
  /** Fixed element count in the tag's type units, or -1 for a bounded variable count. */
  count?: number | -1;
  values?: Record<number, string>;
}

const ORIENTATION_VALUES: Record<number, string> = {
  1: 'Horizontal (normal)',
  2: 'Mirror horizontal',
  3: 'Rotate 180',
  4: 'Mirror vertical',
  5: 'Mirror horizontal and rotate 270 CW',
  6: 'Rotate 90 CW',
  7: 'Mirror horizontal and rotate 90 CW',
  8: 'Rotate 270 CW',
};

const RESOLUTION_UNIT_VALUES: Record<number, string> = {
  1: 'None',
  2: 'inches',
  3: 'cm',
};

const THRESHOLDING_VALUES: Record<number, string> = {
  1: 'No dithering or halftoning',
  2: 'Ordered dither or halftone',
  3: 'Randomized dither',
};

const FILL_ORDER_VALUES: Record<number, string> = {
  1: 'Normal',
  2: 'Reversed',
};

export const PHOTOMETRIC_INTERPRETATION_VALUES: Record<number, string> = {
  0: 'WhiteIsZero',
  1: 'BlackIsZero',
  2: 'RGB',
  3: 'RGB Palette',
  4: 'Transparency Mask',
  5: 'CMYK',
  6: 'YCbCr',
  8: 'CIELab',
  9: 'ICCLab',
  10: 'ITULab',
  32803: 'Color Filter Array',
  32844: 'Pixar LogL',
  32845: 'Pixar LogLuv',
  32892: 'Sequential Color Filter',
  34892: 'Linear Raw',
  51177: 'Depth Map',
  52527: 'Semantic Mask',
};

export const COMPRESSION_VALUES: Record<number, string> = {
  1: 'Uncompressed',
  2: 'CCITT 1D',
  3: 'T4/Group 3 Fax',
  4: 'T6/Group 4 Fax',
  5: 'LZW',
  6: 'JPEG (old-style)',
  7: 'JPEG',
  8: 'Adobe Deflate',
  9: 'JBIG B&W',
  10: 'JBIG Color',
  99: 'JPEG',
  262: 'Kodak 262',
  32766: 'NeXt or Sony ARW Compressed 2',
  32767: 'Sony ARW Compressed',
  32769: 'Packed RAW',
  32770: 'Samsung SRW Compressed',
  32771: 'CCIRLEW',
  32772: 'Samsung SRW Compressed 2',
  32773: 'PackBits',
  32809: 'Thunderscan',
  32867: 'Kodak KDC Compressed',
  32895: 'IT8CTPAD',
  32896: 'IT8LW',
  32897: 'IT8MP',
  32898: 'IT8BL',
  32908: 'PixarFilm',
  32909: 'PixarLog',
  32946: 'Deflate',
  32947: 'DCS',
  33003: 'Aperio JPEG 2000 YCbCr',
  33005: 'Aperio JPEG 2000 RGB',
  34661: 'JBIG',
  34676: 'SGILog',
  34677: 'SGILog24',
  34712: 'JPEG 2000',
  34713: 'Nikon NEF Compressed',
  34715: 'JBIG2 TIFF FX',
  34718: 'Microsoft Document Imaging (MDI) Binary Level Codec',
  34719: 'Microsoft Document Imaging (MDI) Progressive Transform Codec',
  34720: 'Microsoft Document Imaging (MDI) Vector',
  34887: 'ESRI Lerc',
  34892: 'Lossy JPEG',
  34925: 'LZMA2',
  34926: 'Zstd (old)',
  34927: 'WebP (old)',
  34933: 'PNG',
  34934: 'JPEG XR',
  50000: 'Zstd',
  50001: 'WebP',
  50002: 'JPEG XL (old)',
  52546: 'JPEG XL',
  65000: 'Kodak DCR Compressed',
  65535: 'Pentax PEF Compressed',
};

const SUBFILE_TYPE_VALUES: Record<number, string> = {
  0: 'Full-resolution image',
  1: 'Reduced-resolution image',
  2: 'Single page of multi-page image',
  3: 'Single page of multi-page reduced-resolution image',
  4: 'Transparency mask',
  5: 'Transparency mask of reduced-resolution image',
  6: 'Transparency mask of multi-page image',
  7: 'Transparency mask of reduced-resolution multi-page image',
  8: 'Depth map',
  9: 'Depth map of reduced-resolution image',
  16: 'Enhanced image data',
  65537: 'Alternate reduced-resolution image',
  65540: 'Semantic Mask',
  4294967295: 'invalid',
};

const PLANAR_CONFIGURATION_VALUES: Record<number, string> = {
  1: 'Chunky',
  2: 'Planar',
};

const PREDICTOR_VALUES: Record<number, string> = {
  1: 'None',
  2: 'Horizontal differencing',
  3: 'Floating point',
  34892: 'Horizontal difference X2',
  34893: 'Horizontal difference X4',
  34894: 'Floating point X2',
  34895: 'Floating point X4',
};
const YCBCR_POSITIONING_VALUES: Record<number, string> = { 1: 'Centered', 2: 'Co-sited' };
const INK_SET_VALUES: Record<number, string> = { 1: 'CMYK', 2: 'Not CMYK' };

const EXPOSURE_PROGRAM_VALUES: Record<number, string> = {
  0: 'Not Defined',
  1: 'Manual',
  2: 'Program AE',
  3: 'Aperture-priority AE',
  4: 'Shutter speed priority AE',
  5: 'Creative (Slow speed)',
  6: 'Action (High speed)',
  7: 'Portrait',
  8: 'Landscape',
  9: 'Bulb',
};

const METERING_MODE_VALUES: Record<number, string> = {
  0: 'Unknown',
  1: 'Average',
  2: 'Center-weighted average',
  3: 'Spot',
  4: 'Multi-spot',
  5: 'Multi-segment',
  6: 'Partial',
  255: 'Other',
};

const LIGHT_SOURCE_VALUES: Record<number, string> = {
  0: 'Unknown',
  1: 'Daylight',
  2: 'Fluorescent',
  3: 'Tungsten (incandescent)',
  4: 'Flash',
  9: 'Fine weather',
  10: 'Cloudy',
  11: 'Shade',
  12: 'Daylight fluorescent',
  13: 'Day white fluorescent',
  14: 'Cool white fluorescent',
  15: 'White fluorescent',
  16: 'Warm white fluorescent',
  17: 'Standard light A',
  18: 'Standard light B',
  19: 'Standard light C',
  20: 'D55',
  21: 'D65',
  22: 'D75',
  23: 'D50',
  24: 'ISO studio tungsten',
  255: 'Other',
};

const SENSING_METHOD_VALUES: Record<number, string> = {
  1: 'Not defined',
  2: 'One-chip color area',
  3: 'Two-chip color area',
  4: 'Three-chip color area',
  5: 'Color sequential area',
  7: 'Trilinear',
  8: 'Color sequential linear',
};

const SENSITIVITY_TYPE_VALUES: Record<number, string> = {
  0: 'Unknown',
  1: 'Standard Output Sensitivity',
  2: 'Recommended Exposure Index',
  3: 'ISO Speed',
  4: 'Standard Output Sensitivity and Recommended Exposure Index',
  5: 'Standard Output Sensitivity and ISO Speed',
  6: 'Recommended Exposure Index and ISO Speed',
  7: 'Standard Output Sensitivity, Recommended Exposure Index and ISO Speed',
};

const CUSTOM_RENDERED_VALUES: Record<number, string> = {
  0: 'Normal',
  1: 'Custom',
  2: 'HDR (no original saved)',
  3: 'HDR (original saved)',
  4: 'Original (for HDR)',
  6: 'Panorama',
  7: 'Portrait HDR',
  8: 'Portrait',
};
const EXPOSURE_MODE_VALUES: Record<number, string> = { 0: 'Auto', 1: 'Manual', 2: 'Auto bracket' };
const WHITE_BALANCE_VALUES: Record<number, string> = { 0: 'Auto', 1: 'Manual' };
const SCENE_CAPTURE_TYPE_VALUES: Record<number, string> = {
  0: 'Standard', 1: 'Landscape', 2: 'Portrait', 3: 'Night scene', 4: 'Other',
};
const GAIN_CONTROL_VALUES: Record<number, string> = {
  0: 'None', 1: 'Low gain up', 2: 'High gain up', 3: 'Low gain down', 4: 'High gain down',
};
const CONTRAST_VALUES: Record<number, string> = { 0: 'Normal', 1: 'Low', 2: 'High' };
const SATURATION_VALUES: Record<number, string> = { 0: 'Normal', 1: 'Low', 2: 'High' };
const SHARPNESS_VALUES: Record<number, string> = { 0: 'Normal', 1: 'Soft', 2: 'Hard' };
const SUBJECT_DISTANCE_RANGE_VALUES: Record<number, string> = {
  0: 'Unknown', 1: 'Macro', 2: 'Close', 3: 'Distant',
};
const COMPOSITE_IMAGE_VALUES: Record<number, string> = {
  0: 'Unknown',
  1: 'Not a composite image',
  2: 'General composite image',
  3: 'Composite image captured while shooting',
};
const COLOR_SPACE_VALUES: Record<number, string> = {
  1: 'sRGB', 2: 'Adobe RGB', 0xFFFD: 'Wide Gamut RGB', 0xFFFE: 'ICC Profile', 0xFFFF: 'Uncalibrated',
};
const FOCAL_PLANE_RESOLUTION_UNIT_VALUES: Record<number, string> = {
  1: 'None', 2: 'inches', 3: 'cm', 4: 'mm', 5: 'um',
};
const GPS_DIFFERENTIAL_VALUES: Record<number, string> = {
  0: 'No Correction',
  1: 'Differential Corrected',
};
const FILE_SOURCE_VALUES: Record<number, string> = {
  1: 'Film Scanner',
  2: 'Reflection Print Scanner',
  3: 'Digital Camera',
};
const SCENE_TYPE_VALUES: Record<number, string> = { 1: 'Directly photographed' };

export const IFD0_TAGS: Record<string, IfdTagSpec> = {
  processingsoftware: { id: 0x000B, type: 2, name: 'ProcessingSoftware' },
  imagewidth: { id: 0x0100, type: 4, name: 'ImageWidth' },
  imageheight: { id: 0x0101, type: 4, name: 'ImageHeight' },
  bitspersample: { id: 0x0102, type: 3, name: 'BitsPerSample', count: -1 },
    tilewidth: { id: 0x0142, type: 4, name: 'TileWidth' },
    tilelength: { id: 0x0143, type: 4, name: 'TileLength' },
  subfiletype: { id: 0x00FE, type: 4, name: 'SubfileType', values: SUBFILE_TYPE_VALUES },
  oldsubfiletype: { id: 0x00FF, type: 3, name: 'OldSubfileType' },
  compression: { id: 0x0103, type: 3, name: 'Compression', values: COMPRESSION_VALUES },
  documentname: { id: 0x010D, type: 2, name: 'DocumentName' },
  imagedescription: { id: 0x010E, type: 2, name: 'ImageDescription' },
  make: { id: 0x010F, type: 2, name: 'Make' },
  model: { id: 0x0110, type: 2, name: 'Model' },
  orientation: { id: 0x0112, type: 3, name: 'Orientation', values: ORIENTATION_VALUES },
  photometricinterpretation: { id: 0x0106, type: 3, name: 'PhotometricInterpretation', values: PHOTOMETRIC_INTERPRETATION_VALUES },
  thresholding: { id: 0x0107, type: 3, name: 'Thresholding', values: THRESHOLDING_VALUES },
  cellwidth: { id: 0x0108, type: 3, name: 'CellWidth' },
  celllength: { id: 0x0109, type: 3, name: 'CellLength' },
  minsamplevalue: { id: 0x0118, type: 3, name: 'MinSampleValue' },
  maxsamplevalue: { id: 0x0119, type: 3, name: 'MaxSampleValue' },
  fillorder: { id: 0x010A, type: 3, name: 'FillOrder', values: FILL_ORDER_VALUES },
  samplesperpixel: { id: 0x0115, type: 3, name: 'SamplesPerPixel' },
  rowsperstrip: { id: 0x0116, type: 4, name: 'RowsPerStrip' },
  planarconfiguration: { id: 0x011C, type: 3, name: 'PlanarConfiguration', values: PLANAR_CONFIGURATION_VALUES },
  pagename: { id: 0x011D, type: 2, name: 'PageName' },
  xresolution: { id: 0x011A, type: 5, name: 'XResolution' },
  yresolution: { id: 0x011B, type: 5, name: 'YResolution' },
  xposition: { id: 0x011E, type: 5, name: 'XPosition' },
  yposition: { id: 0x011F, type: 5, name: 'YPosition' },
  grayresponseunit: { id: 0x0122, type: 3, name: 'GrayResponseUnit' },
  inkset: { id: 0x014C, type: 3, name: 'InkSet', values: INK_SET_VALUES },
  pixelscale: { id: 0x830E, type: 12, name: 'PixelScale', count: 3 },
  offsetschema: { id: 0xEA1D, type: 9, name: 'OffsetSchema' },
  jxldistance: { id: 0xCD49, type: 11, name: 'JXLDistance' },
  modeltiepoint: { id: 0x8482, type: 12, name: 'ModelTiePoint', count: -1 },
  modeltransform: { id: 0x85D8, type: 12, name: 'ModelTransform', count: 16 },
  geotiffdirectory: { id: 0x87AF, type: 3, name: 'GeoTiffDirectory', count: -1 },
  geotiffdoubleparams: { id: 0x87B0, type: 12, name: 'GeoTiffDoubleParams', count: -1 },
  geotiffasciiparams: { id: 0x87B1, type: 2, name: 'GeoTiffAsciiParams' },
  colormatrix1: { id: 0xC621, type: 10, name: 'ColorMatrix1', count: -1 },
  colormatrix2: { id: 0xC622, type: 10, name: 'ColorMatrix2', count: -1 },
  cameracalibration1: { id: 0xC623, type: 10, name: 'CameraCalibration1', count: -1 },
  cameracalibration2: { id: 0xC624, type: 10, name: 'CameraCalibration2', count: -1 },
  reductionmatrix1: { id: 0xC625, type: 10, name: 'ReductionMatrix1', count: -1 },
  reductionmatrix2: { id: 0xC626, type: 10, name: 'ReductionMatrix2', count: -1 },
  analogbalance: { id: 0xC627, type: 5, name: 'AnalogBalance', count: -1 },
  asshotneutral: { id: 0xC628, type: 5, name: 'AsShotNeutral', count: -1 },
  asshotwhitexy: { id: 0xC629, type: 5, name: 'AsShotWhiteXY', count: 2 },
  baselineexposure: { id: 0xC62A, type: 10, name: 'BaselineExposure' },
  baselinenoise: { id: 0xC62B, type: 5, name: 'BaselineNoise' },
  baselinesharpness: { id: 0xC62C, type: 5, name: 'BaselineSharpness' },
  linearresponselimit: { id: 0xC62E, type: 5, name: 'LinearResponseLimit' },
  calibrationilluminant1: { id: 0xC65A, type: 3, name: 'CalibrationIlluminant1', values: LIGHT_SOURCE_VALUES },
  calibrationilluminant2: { id: 0xC65B, type: 3, name: 'CalibrationIlluminant2', values: LIGHT_SOURCE_VALUES },
  rawdatauniqueid: { id: 0xC65D, type: 7, name: 'RawDataUniqueID', count: 16 },
  shadowscale: { id: 0xC633, type: 5, name: 'ShadowScale' },
  dngprivatedata: { id: 0xC634, type: 7, name: 'DNGPrivateData', count: -1 },
  makernotesafety: { id: 0xC635, type: 3, name: 'MakerNoteSafety', values: { 0: 'Unsafe', 1: 'Safe' } },
  originalrawfilename: { id: 0xC68B, type: 2, name: 'OriginalRawFileName' },
  asshotpreprofilematrix: { id: 0xC690, type: 10, name: 'AsShotPreProfileMatrix', count: -1 },
  currentpreprofilematrix: { id: 0xC692, type: 10, name: 'CurrentPreProfileMatrix', count: -1 },
  colorimetricreference: {
    id: 0xC6BF,
    type: 3,
    name: 'ColorimetricReference',
    values: {
      0: 'Scene-referred',
      1: 'Output-referred (ICC Profile Dynamic Range)',
      2: 'Output-referred (High Dyanmic Range)',
    },
  },
  cameracalibrationsig: { id: 0xC6F3, type: 2, name: 'CameraCalibrationSig' },
  profilecalibrationsig: { id: 0xC6F4, type: 2, name: 'ProfileCalibrationSig' },
  asshotprofilename: { id: 0xC6F6, type: 2, name: 'AsShotProfileName' },
  previewsettingsdigest: { id: 0xC719, type: 7, name: 'PreviewSettingsDigest', count: -1 },
  rawimagedigest: { id: 0xC71C, type: 7, name: 'RawImageDigest', count: 16 },
  originalrawfiledigest: { id: 0xC71D, type: 7, name: 'OriginalRawFileDigest', count: 16 },
  previewapplicationname: { id: 0xC716, type: 2, name: 'PreviewApplicationName' },
  previewapplicationversion: { id: 0xC717, type: 2, name: 'PreviewApplicationVersion' },
  previewsettingsname: { id: 0xC718, type: 2, name: 'PreviewSettingsName' },
  previewcolorspace: {
    id: 0xC71A,
    type: 4,
    name: 'PreviewColorSpace',
    values: { 0: 'Unknown', 1: 'Gray Gamma 2.2', 2: 'sRGB', 3: 'Adobe RGB', 4: 'ProPhoto RGB' },
  },
  previewdatetime: { id: 0xC71B, type: 2, name: 'PreviewDateTime' },
  forwardmatrix1: { id: 0xC714, type: 10, name: 'ForwardMatrix1', count: -1 },
  forwardmatrix2: { id: 0xC715, type: 10, name: 'ForwardMatrix2', count: -1 },
  dngversion: { id: 0xC612, type: 1, name: 'DNGVersion', count: 4 },
  dngbackwardversion: { id: 0xC613, type: 1, name: 'DNGBackwardVersion', count: 4 },
  uniquecameramodel: { id: 0xC614, type: 2, name: 'UniqueCameraModel' },
  localizedcameramodel: { id: 0xC615, type: 2, name: 'LocalizedCameraModel' },
  cameraserialnumber: { id: 0xC62F, type: 2, name: 'CameraSerialNumber' },
  dnglensinfo: { id: 0xC630, type: 5, name: 'DNGLensInfo', count: 4 },
  depthformat: { id: 0xC7E9, type: 3, name: 'DepthFormat', values: { 0: 'Unknown', 1: 'Linear', 2: 'Inverse' } },
  depthunits: { id: 0xC7EC, type: 3, name: 'DepthUnits', values: { 0: 'Unknown', 1: 'Meters' } },
  depthmeasuretype: { id: 0xC7ED, type: 3, name: 'DepthMeasureType', values: { 0: 'Unknown', 1: 'Optical Axis', 2: 'Optical Ray' } },
  calibrationilluminant3: { id: 0xCD31, type: 3, name: 'CalibrationIlluminant3', values: LIGHT_SOURCE_VALUES },
  profilename: { id: 0xC6F8, type: 2, name: 'ProfileName' },
  profilecopyright: { id: 0xC6FE, type: 2, name: 'ProfileCopyright' },
  profileembedpolicy: {
    id: 0xC6FD,
    type: 4,
    name: 'ProfileEmbedPolicy',
    values: { 0: 'Allow Copying', 1: 'Embed if Used', 2: 'Never Embed', 3: 'No Restrictions' },
  },
  profilehuesatmapencoding: { id: 0xC7A3, type: 4, name: 'ProfileHueSatMapEncoding', values: { 0: 'Linear', 1: 'sRGB' } },
  profilelooktableencoding: { id: 0xC7A4, type: 4, name: 'ProfileLookTableEncoding', values: { 0: 'Linear', 1: 'sRGB' } },
  reelname: { id: 0xC789, type: 2, name: 'ReelName' },
  originaldefaultfinalsize: { id: 0xC791, type: 4, name: 'OriginalDefaultFinalSize', count: 2 },
  originalbestqualitysize: { id: 0xC792, type: 4, name: 'OriginalBestQualitySize', count: 2 },
  originaldefaultcropsize: { id: 0xC793, type: 5, name: 'OriginalDefaultCropSize', count: 2 },
  cameralabel: { id: 0xC7A1, type: 2, name: 'CameraLabel' },
  baselineexposureoffset: { id: 0xC7A5, type: 10, name: 'BaselineExposureOffset' },
  defaultblackrender: { id: 0xC7A6, type: 4, name: 'DefaultBlackRender', values: { 0: 'Auto', 1: 'None' } },
  newrawimagedigest: { id: 0xC7A7, type: 7, name: 'NewRawImageDigest', count: 16 },
  rawtopreviewgain: { id: 0xC7A8, type: 12, name: 'RawToPreviewGain' },
  framerate: { id: 0xC764, type: 10, name: 'FrameRate' },
  tstop: { id: 0xC772, type: 5, name: 'TStop', count: -1 },
  resolutionunit: { id: 0x0128, type: 3, name: 'ResolutionUnit', values: RESOLUTION_UNIT_VALUES },
  pagenumber: { id: 0x0129, type: 3, name: 'PageNumber', count: 2 },
  whitepoint: { id: 0x013E, type: 5, name: 'WhitePoint', count: 2 },
  primarychromaticities: { id: 0x013F, type: 5, name: 'PrimaryChromaticities', count: 6 },
  halftonehints: { id: 0x0141, type: 3, name: 'HalftoneHints', count: 2 },
  ycbcrcoefficients: { id: 0x0211, type: 5, name: 'YCbCrCoefficients', count: 3 },
  ycbcrsubsampling: { id: 0x0212, type: 3, name: 'YCbCrSubSampling', count: 2 },
  ycbcrpositioning: { id: 0x0213, type: 3, name: 'YCbCrPositioning', values: YCBCR_POSITIONING_VALUES },
  referenceblackwhite: { id: 0x0214, type: 5, name: 'ReferenceBlackWhite', count: 6 },
  software: { id: 0x0131, type: 2, name: 'Software' },
  datetime: { id: 0x0132, type: 2, name: 'DateTime' },
  modifydate: { id: 0x0132, type: 2, name: 'DateTime' },
  transferfunction: { id: 0x012D, type: 3, name: 'TransferFunction', count: 768 },
  artist: { id: 0x013B, type: 2, name: 'Artist' },
  hostcomputer: { id: 0x013C, type: 2, name: 'HostComputer' },
  copyright: { id: 0x8298, type: 2, name: 'Copyright' },
  rating: { id: 0x4746, type: 3, name: 'Rating' },
  ratingpercent: { id: 0x4749, type: 3, name: 'RatingPercent' },
  seminfo: { id: 0x8546, type: 2, name: 'SEMInfo' },
  targetprinter: { id: 0x0151, type: 2, name: 'TargetPrinter' },
  predictor: { id: 0x013D, type: 3, name: 'Predictor', values: PREDICTOR_VALUES },
};

/** ExifIFD (0x8769) tags. Pointers (0x8769/0x8825/0xA005) and MakerNote (0x927C) are never written. */
export const EXIF_IFD_TAGS: Record<string, IfdTagSpec> = {
  exposuretime: { id: 0x829A, type: 5, name: 'ExposureTime' },
  fnumber: { id: 0x829D, type: 5, name: 'FNumber' },
  flashenergy: { id: 0xA20B, type: 5, name: 'FlashEnergy' },
  imagenumber: { id: 0x9211, type: 4, name: 'ImageNumber' },
  securityclassification: { id: 0x9212, type: 2, name: 'SecurityClassification' },
  imagehistory: { id: 0x9213, type: 2, name: 'ImageHistory' },
  compressedbitsperpixel: { id: 0x9102, type: 5, name: 'CompressedBitsPerPixel' },
  brightnessvalue: { id: 0x9203, type: 10, name: 'BrightnessValue' },
  exposureprogram: { id: 0x8822, type: 3, name: 'ExposureProgram', values: EXPOSURE_PROGRAM_VALUES },
  iso: { id: 0x8827, type: 3, name: 'ISOSpeedRatings', count: -1 },
  isospeedratings: { id: 0x8827, type: 3, name: 'ISOSpeedRatings', count: -1 },
    spectralsensitivity: { id: 0x8824, type: 2, name: 'SpectralSensitivity' },
  sensitivitytype: { id: 0x8830, type: 3, name: 'SensitivityType', values: SENSITIVITY_TYPE_VALUES },
  standardoutputsensitivity: { id: 0x8831, type: 4, name: 'StandardOutputSensitivity' },
  recommendedexposureindex: { id: 0x8832, type: 4, name: 'RecommendedExposureIndex' },
  isospeed: { id: 0x8833, type: 4, name: 'ISOSpeed' },
  isospeedlatitudeyyy: { id: 0x8834, type: 4, name: 'ISOSpeedLatitudeyyy' },
  isospeedlatitudezzz: { id: 0x8835, type: 4, name: 'ISOSpeedLatitudezzz' },
  selftimermode: { id: 0x882B, type: 3, name: 'SelfTimerMode' },
  timezoneoffset: { id: 0x882A, type: 8, name: 'TimeZoneOffset', count: -1 },
  exifversion: { id: 0x9000, type: 7, name: 'ExifVersion', count: 4 },
  datetimeoriginal: { id: 0x9003, type: 2, name: 'DateTimeOriginal' },
  createdate: { id: 0x9004, type: 2, name: 'CreateDate' },
  datetimedigitized: { id: 0x9004, type: 2, name: 'CreateDate' },
  offsettime: { id: 0x9010, type: 2, name: 'OffsetTime' },
  offsettimeoriginal: { id: 0x9011, type: 2, name: 'OffsetTimeOriginal' },
  offsettimedigitized: { id: 0x9012, type: 2, name: 'OffsetTimeDigitized' },
  componentsconfiguration: { id: 0x9101, type: 7, name: 'ComponentsConfiguration', count: 4 },
  shutterspeedvalue: { id: 0x9201, type: 10, name: 'ShutterSpeedValue' },
  aperturevalue: { id: 0x9202, type: 5, name: 'ApertureValue' },
  maxaperturevalue: { id: 0x9205, type: 5, name: 'MaxApertureValue' },
  subjectarea: { id: 0x9214, type: 3, name: 'SubjectArea', count: -1 },
  compositeimage: { id: 0xA460, type: 3, name: 'CompositeImage', values: COMPOSITE_IMAGE_VALUES },
  compositeimagecount: { id: 0xA461, type: 3, name: 'CompositeImageCount', count: 2 },
  exposurecompensation: { id: 0x9204, type: 10, name: 'ExposureCompensation' },
  subjectdistance: { id: 0x9206, type: 5, name: 'SubjectDistance' },
  meteringmode: { id: 0x9207, type: 3, name: 'MeteringMode', values: METERING_MODE_VALUES },
  lightsource: { id: 0x9208, type: 3, name: 'LightSource', values: LIGHT_SOURCE_VALUES },
  flash: { id: 0x9209, type: 3, name: 'Flash' },
  focallength: { id: 0x920A, type: 5, name: 'FocalLength' },
  usercomment: { id: 0x9286, type: 7, name: 'UserComment' },
  subsectime: { id: 0x9290, type: 2, name: 'SubSecTime' },
  subsectimeoriginal: { id: 0x9291, type: 2, name: 'SubSecTimeOriginal' },
  subsectimedigitized: { id: 0x9292, type: 2, name: 'SubSecTimeDigitized' },
  flashpixversion: { id: 0xA000, type: 7, name: 'FlashpixVersion', count: 4 },
  colorspace: { id: 0xA001, type: 3, name: 'ColorSpace', values: COLOR_SPACE_VALUES },
  exifimagewidth: { id: 0xA002, type: 3, name: 'ExifImageWidth' },
  exifimageheight: { id: 0xA003, type: 3, name: 'ExifImageHeight' },
  relatedsoundfile: { id: 0xA004, type: 2, name: 'RelatedSoundFile' },
  subjectlocation: { id: 0xA214, type: 3, name: 'SubjectLocation', count: 2 },
  exposureindex: { id: 0xA215, type: 5, name: 'ExposureIndex' },
  imagetitle: { id: 0xA436, type: 2, name: 'ImageTitle' },
  photographer: { id: 0xA437, type: 2, name: 'Photographer' },
  imageeditor: { id: 0xA438, type: 2, name: 'ImageEditor' },
  camerafirmware: { id: 0xA439, type: 2, name: 'CameraFirmware' },
  rawdevelopingsoftware: { id: 0xA43A, type: 2, name: 'RAWDevelopingSoftware' },
  imageeditingsoftware: { id: 0xA43B, type: 2, name: 'ImageEditingSoftware' },
  metadataeditingsoftware: { id: 0xA43C, type: 2, name: 'MetadataEditingSoftware' },
  customrendered: { id: 0xA401, type: 3, name: 'CustomRendered', values: CUSTOM_RENDERED_VALUES },
  exposuremode: { id: 0xA402, type: 3, name: 'ExposureMode', values: EXPOSURE_MODE_VALUES },
  whitebalance: { id: 0xA403, type: 3, name: 'WhiteBalance', values: WHITE_BALANCE_VALUES },
  digitalzoomratio: { id: 0xA404, type: 5, name: 'DigitalZoomRatio' },
  focallengthin35mmformat: { id: 0xA405, type: 3, name: 'FocalLengthIn35mmFormat' },
  scenecapturetype: { id: 0xA406, type: 3, name: 'SceneCaptureType', values: SCENE_CAPTURE_TYPE_VALUES },
  gaincontrol: { id: 0xA407, type: 3, name: 'GainControl', values: GAIN_CONTROL_VALUES },
  contrast: { id: 0xA408, type: 3, name: 'Contrast', values: CONTRAST_VALUES },
  saturation: { id: 0xA409, type: 3, name: 'Saturation', values: SATURATION_VALUES },
  sharpness: { id: 0xA40A, type: 3, name: 'Sharpness', values: SHARPNESS_VALUES },
  subjectdistancerange: { id: 0xA40C, type: 3, name: 'SubjectDistanceRange', values: SUBJECT_DISTANCE_RANGE_VALUES },
  focalplanexresolution: { id: 0xA20E, type: 5, name: 'FocalPlaneXResolution' },
  focalplaneyresolution: { id: 0xA20F, type: 5, name: 'FocalPlaneYResolution' },
  focalplaneresolutionunit: { id: 0xA210, type: 3, name: 'FocalPlaneResolutionUnit', values: FOCAL_PLANE_RESOLUTION_UNIT_VALUES },
  sensingmethod: { id: 0xA217, type: 3, name: 'SensingMethod', values: SENSING_METHOD_VALUES },
  filesource: { id: 0xA300, type: 7, name: 'FileSource', values: FILE_SOURCE_VALUES },
  scenetype: { id: 0xA301, type: 7, name: 'SceneType', values: SCENE_TYPE_VALUES },
  cfapattern: { id: 0xA302, type: 7, name: 'CFAPattern' },
  imageuniqueid: { id: 0xA420, type: 2, name: 'ImageUniqueID' },
  ownername: { id: 0xA430, type: 2, name: 'OwnerName' },
  serialnumber: { id: 0xA431, type: 2, name: 'SerialNumber' },
  lensinfo: { id: 0xA432, type: 5, name: 'LensInfo', count: 4 },
  lensmake: { id: 0xA433, type: 2, name: 'LensMake' },
  lensmodel: { id: 0xA434, type: 2, name: 'LensModel' },
  lensserialnumber: { id: 0xA435, type: 2, name: 'LensSerialNumber' },
};

/** GPS IFD (0x8825) tags. */
export const GPS_IFD_TAGS: Record<string, IfdTagSpec> = {
  gpsversionid: { id: 0x0000, type: 1, name: 'GPSVersionID', count: 4 },
  gpslatituderef: { id: 0x0001, type: 2, name: 'GPSLatitudeRef' },
  gpslatitude: { id: 0x0002, type: 5, name: 'GPSLatitude', count: 3 },
  gpslongituderef: { id: 0x0003, type: 2, name: 'GPSLongitudeRef' },
  gpslongitude: { id: 0x0004, type: 5, name: 'GPSLongitude', count: 3 },
  gpsaltituderef: { id: 0x0005, type: 1, name: 'GPSAltitudeRef' },
  gpsaltitude: { id: 0x0006, type: 5, name: 'GPSAltitude' },
  gpstimestamp: { id: 0x0007, type: 5, name: 'GPSTimeStamp', count: 3 },
  gpssatellites: { id: 0x0008, type: 2, name: 'GPSSatellites' },
  gpsstatus: { id: 0x0009, type: 2, name: 'GPSStatus' },
  gpsmeasuremode: { id: 0x000A, type: 2, name: 'GPSMeasureMode' },
  gpsdop: { id: 0x000B, type: 5, name: 'GPSDOP' },
  gpsspeedref: { id: 0x000C, type: 2, name: 'GPSSpeedRef' },
  gpsspeed: { id: 0x000D, type: 5, name: 'GPSSpeed' },
  gpstrackref: { id: 0x000E, type: 2, name: 'GPSTrackRef' },
  gpstrack: { id: 0x000F, type: 5, name: 'GPSTrack' },
  gpsimgdirectionref: { id: 0x0010, type: 2, name: 'GPSImgDirectionRef' },
  gpsimgdirection: { id: 0x0011, type: 5, name: 'GPSImgDirection' },
  gpsmapdatum: { id: 0x0012, type: 2, name: 'GPSMapDatum' },
  gpsdestlatituderef: { id: 0x0013, type: 2, name: 'GPSDestLatitudeRef' },
  gpsdestlatitude: { id: 0x0014, type: 5, name: 'GPSDestLatitude', count: 3 },
  gpsdestlongituderef: { id: 0x0015, type: 2, name: 'GPSDestLongitudeRef' },
  gpsdestlongitude: { id: 0x0016, type: 5, name: 'GPSDestLongitude', count: 3 },
  gpsdestbearingref: { id: 0x0017, type: 2, name: 'GPSDestBearingRef' },
  gpsdestbearing: { id: 0x0018, type: 5, name: 'GPSDestBearing' },
  gpsdestdistanceref: { id: 0x0019, type: 2, name: 'GPSDestDistanceRef' },
  gpsdestdistance: { id: 0x001A, type: 5, name: 'GPSDestDistance' },
  gpsprocessingmethod: { id: 0x001B, type: 7, name: 'GPSProcessingMethod' },
  gpsareainformation: { id: 0x001C, type: 7, name: 'GPSAreaInformation' },
  gpsdatestamp: { id: 0x001D, type: 2, name: 'GPSDateStamp' },
  gpsdifferential: { id: 0x001E, type: 3, name: 'GPSDifferential', values: GPS_DIFFERENTIAL_VALUES },
  gpshpositioningerror: { id: 0x001F, type: 5, name: 'GPSHPositioningError' },
};

export const INTEROP_IFD_TAGS: Record<string, IfdTagSpec> = {
  interopindex: { id: 0x0001, type: 2, name: 'InteropIndex' },
  interopversion: { id: 0x0002, type: 7, name: 'InteropVersion', count: 4 },
  relatedimagefileformat: { id: 0x1000, type: 2, name: 'RelatedImageFileFormat' },
  relatedimagewidth: { id: 0x1001, type: 3, name: 'RelatedImageWidth' },
  relatedimageheight: { id: 0x1002, type: 3, name: 'RelatedImageHeight' },
};

export const SUB_IFD_TAGS: Record<string, IfdTagSpec> = {
  bestqualityscale: { id: 0xC65C, type: 5, name: 'BestQualityScale' },
  chromablurradius: { id: 0xC631, type: 5, name: 'ChromaBlurRadius' },
  antialiasstrength: { id: 0xC632, type: 5, name: 'AntiAliasStrength' },
  activearea: { id: 0xC68D, type: 4, name: 'ActiveArea', count: 4 },
  maskedareas: { id: 0xC68E, type: 4, name: 'MaskedAreas', count: -1 },
  noisereductionapplied: { id: 0xC6F7, type: 5, name: 'NoiseReductionApplied' },
  defaultusercrop: { id: 0xC7B5, type: 5, name: 'DefaultUserCrop', count: 4 },
  linearizationtable: { id: 0xC618, type: 3, name: 'LinearizationTable', count: -1 },
  blacklevelrepeatdim: { id: 0xC619, type: 3, name: 'BlackLevelRepeatDim', count: 2 },
  blacklevel: { id: 0xC61A, type: 5, name: 'BlackLevel', count: -1 },
  blackleveldeltah: { id: 0xC61B, type: 10, name: 'BlackLevelDeltaH', count: -1 },
  blackleveldeltav: { id: 0xC61C, type: 10, name: 'BlackLevelDeltaV', count: -1 },
  whitelevel: { id: 0xC61D, type: 4, name: 'WhiteLevel', count: -1 },
  bayergreensplit: { id: 0xC62D, type: 4, name: 'BayerGreenSplit' },
  defaultscale: { id: 0xC61E, type: 5, name: 'DefaultScale', count: 2 },
  defaultcroporigin: { id: 0xC61F, type: 4, name: 'DefaultCropOrigin', count: 2 },
  defaultcropsize: { id: 0xC620, type: 4, name: 'DefaultCropSize', count: 2 },
  noiseprofile: { id: 0xC761, type: 12, name: 'NoiseProfile', count: -1 },
};

const IFD_TAG_GROUPS: Record<string, Record<string, IfdTagSpec>> = {
  ifd0: IFD0_TAGS,
  exififd: EXIF_IFD_TAGS,
  gps: GPS_IFD_TAGS,
  interopifd: INTEROP_IFD_TAGS,
  subifd: SUB_IFD_TAGS,
};

const HEX_UNDEFINED_TAGS = new Set([
  'RawDataUniqueID', 'PreviewSettingsDigest', 'RawImageDigest', 'OriginalRawFileDigest', 'NewRawImageDigest',
]);

function toAscii(value: TagValue): Uint8Array | undefined {
  const s = typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : undefined;
  if (s === undefined) return undefined;
  const bytes = new TextEncoder().encode(s);
  const out = new Uint8Array(bytes.length + 1);
  out.set(bytes);
  return out;
}

/** Accepts a number (scaled by 1000), [num, den], or 'num/den'. */
function toRational(value: TagValue): [number, number] | undefined {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? [value, 1] : approximateRational(value);
  }
  if (typeof value === 'string') {
    const m = value.match(/^(-?\d+)\/(-?\d+)$/);
    if (m) return [Number(m[1]), Number(m[2])];
    const n = Number(value);
    return Number.isFinite(n) ? toRational(n) : undefined;
  }
  if (Array.isArray(value) && value.length === 2) {
    const [a, b] = value as [unknown, unknown];
    if (typeof a === 'number' && typeof b === 'number') return [a, b];
  }
  return undefined;
}

function approximateRational(value: number): [number, number] {
  const sign = value < 0 ? -1 : 1;
  const absoluteValue = Math.abs(value);
  const maxComponent = 0xffffffff;
  if (absoluteValue > maxComponent) return [Math.round(value), 1];
  const maxDenominator = Math.min(1_000_000_000, Math.floor(maxComponent / absoluteValue));
  let remainder = absoluteValue;
  let numeratorBeforePrevious = 0;
  let numeratorPrevious = 1;
  let denominatorBeforePrevious = 1;
  let denominatorPrevious = 0;
  let bestNumerator = Math.floor(absoluteValue);
  let bestDenominator = 1;

  for (let iteration = 0; iteration < 64; iteration++) {
    const integerPart = Math.floor(remainder);
    const nextNumerator = integerPart * numeratorPrevious + numeratorBeforePrevious;
    const nextDenominator = integerPart * denominatorPrevious + denominatorBeforePrevious;
    if (
      nextDenominator > maxDenominator || nextNumerator > maxComponent ||
      !Number.isSafeInteger(nextNumerator) || !Number.isSafeInteger(nextDenominator)
    ) {
      const denominatorMultiplier = denominatorPrevious > 0
        ? Math.floor((maxDenominator - denominatorBeforePrevious) / denominatorPrevious)
        : 0;
      const numeratorMultiplier = numeratorPrevious > 0
        ? Math.floor((maxComponent - numeratorBeforePrevious) / numeratorPrevious)
        : 0;
      const multiplier = Math.min(denominatorMultiplier, numeratorMultiplier);
      if (multiplier > 0) {
        const boundedNumerator = multiplier * numeratorPrevious + numeratorBeforePrevious;
        const boundedDenominator = multiplier * denominatorPrevious + denominatorBeforePrevious;
        if (
          Math.abs(absoluteValue - boundedNumerator / boundedDenominator) <
          Math.abs(absoluteValue - bestNumerator / bestDenominator)
        ) {
          bestNumerator = boundedNumerator;
          bestDenominator = boundedDenominator;
        }
      }
      break;
    }
    bestNumerator = nextNumerator;
    bestDenominator = nextDenominator;
    numeratorBeforePrevious = numeratorPrevious;
    numeratorPrevious = nextNumerator;
    denominatorBeforePrevious = denominatorPrevious;
    denominatorPrevious = nextDenominator;
    const fractionalPart = remainder - integerPart;
    if (fractionalPart < Number.EPSILON) break;
    remainder = 1 / fractionalPart;
  }
  return [sign * bestNumerator, bestDenominator];
}

function encodeExifText(value: string, le: boolean): Uint8Array {
  const text = new TextEncoder().encode(value);
  if (text.every((byte) => byte < 0x80)) {
    const header = new TextEncoder().encode('ASCII\0\0\0');
    const data = new Uint8Array(header.length + text.length);
    data.set(header);
    data.set(text, header.length);
    return data;
  }
  const header = new TextEncoder().encode('UNICODE\0');
  const data = new Uint8Array(header.length + value.length * 2);
  data.set(header);
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    const offset = header.length + index * 2;
    data[offset + (le ? 0 : 1)] = codeUnit & 0xff;
    data[offset + (le ? 1 : 0)] = codeUnit >> 8;
  }
  return data;
}

/**
 * Parses a GPS coordinate into [deg, min, sec]. Accepts [deg, min, sec]
 * (or 6-element rational triplets), a decimal number of degrees, or the
 * reader-formatted DMS string (`43 deg 28' 2.00" N`).
 */
function toGpsCoordinate(value: TagValue): [number, number, number] | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const magnitude = Math.abs(value);
    const deg = Math.trunc(magnitude);
    const minFull = (magnitude - deg) * 60;
    const min = Math.trunc(minFull);
    const sec = Math.round((minFull - min) * 60 * 100) / 100;
    return [deg, min, sec];
  }
  if (typeof value === 'string') {
    const dms = value.match(/^(\d+) deg (\d+)' ([\d.]+)"\s*([NSEW])?/);
    if (dms) return [Number(dms[1]), Number(dms[2]), Number(dms[3])];
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return toGpsCoordinate(numeric);
    const r = toRational(value);
    return r ? [r[0], r[1], 0] : undefined;
  }
  if (Array.isArray(value)) {
    const nums = value.filter((v): v is number => typeof v === 'number');
    if (nums.length === 3 && nums.every(Number.isFinite)) {
      return [nums[0], nums[1], nums[2]];
    }
    if (nums.length === 6 && nums.every(Number.isFinite)) {
      const r = (i: number) => nums[i + 1] === 0 ? 0 : nums[i] / nums[i + 1];
      return [r(0), r(2), r(4)];
    }
    if (nums.length === 2 && nums.every(Number.isFinite)) {
      return [nums[0], nums[1], 0];
    }
  }
  return undefined;
}

const GPS_REF_MAP: Record<string, string> = {
  n: 'N', north: 'N', s: 'S', south: 'S',
  e: 'E', east: 'E', w: 'W', west: 'W',
};

/** Maps 'N'|'North'|'S'|'South'|'E'|'East'|'W'|'West' to the single ref letter. */
function toGpsRef(value: TagValue): string | undefined {
  if (typeof value !== 'string') return undefined;
  return GPS_REF_MAP[value.trim().toLowerCase()];
}

function refFromCoordinate(value: TagValue, fallback: string): string | undefined {
  if (typeof value === 'string') {
    const m = value.match(/([NSEW])\s*"?$/);
    if (m) return m[1];
  }
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (numeric < 0) return fallback === 'N' ? 'S' : fallback === 'E' ? 'W' : fallback;
  return fallback;
}

function rationals(pairs: [number, number][], signed: boolean, le: boolean): Uint8Array {
  const buf = new ArrayBuffer(pairs.length * 8);
  const dv = new DataView(buf);
  pairs.forEach(([num, den], i) => {
    if (signed) {
      dv.setInt32(i * 8, num, le);
      dv.setInt32(i * 8 + 4, den, le);
    } else {
      dv.setUint32(i * 8, num >>> 0, le);
      dv.setUint32(i * 8 + 4, den >>> 0, le);
    }
  });
  return new Uint8Array(buf);
}

export function encodeValue(
  spec: IfdTagSpec,
  value: TagValue,
  le = true,
): { data: Uint8Array; count: number } | undefined {
  if (
    spec.type === 7 && typeof value === 'string' &&
    (spec.name === 'GPSProcessingMethod' || spec.name === 'GPSAreaInformation')
  ) {
    const data = encodeExifText(value, le);
    return { data, count: data.length };
  }
  if (spec.type === 7 && spec.name === 'UserComment' && typeof value === 'string') {
    return encodeUserComment(value, le);
  }
  if (spec.type === 2) {
    const ascii = toAscii(value);
    return ascii ? { data: ascii, count: ascii.length } : undefined;
  }
  if (spec.type === 3 || spec.type === 8) {
    const values = Array.isArray(value)
      ? value
      : spec.count === -1 && typeof value === 'string'
      ? value.trim().split(/[\s,]+/)
      : [value];
    if (spec.count !== undefined && spec.count !== -1 && values.length !== spec.count) return undefined;
    if (Array.isArray(value) && spec.count === undefined) return undefined;
    if (spec.count === -1) {
      const minCount = spec.name === 'SubjectArea' ? 2 : 1;
      const maxCount = spec.name === 'TimeZoneOffset' ? 2 : spec.name === 'SubjectArea' ? 4 : Infinity;
      if (values.length < minCount || values.length > maxCount) return undefined;
    }
    const signed = spec.type === 8;
    const min = signed ? -0x8000 : 0;
    const max = signed ? 0x7FFF : 0xFFFF;
    const numbers = values.map((item) => {
      const numeric = typeof item === 'number' ? item : typeof item === 'string' ? Number(item) : NaN;
      return Number.isFinite(numeric) ? Math.round(numeric) : undefined;
    });
    if (numbers.some((n) => n === undefined || n < min || n > max)) return undefined;
    const data = new Uint8Array(numbers.length * 2);
    numbers.forEach((n, index) => {
      const offset = index * 2;
      data[offset + (le ? 0 : 1)] = n! & 255;
      data[offset + (le ? 1 : 0)] = (n! >> 8) & 255;
    });
    return { data, count: numbers.length };
  }
  if (spec.type === 16 || spec.type === 17 || spec.type === 18) {
    const values = Array.isArray(value) ? value : [value];
    if (Array.isArray(value) && spec.count === undefined) return undefined;
    if (spec.count !== undefined && spec.count !== -1 && values.length !== spec.count) return undefined;
    const signed = spec.type === 17;
    const encoded = values.map((item) => {
      const number = typeof item === 'number' ? item : typeof item === 'string' ? Number(item) : NaN;
      if (!Number.isSafeInteger(number) || !signed && number < 0) return undefined;
      return BigInt(number);
    });
    const min = signed ? -0x8000000000000000n : 0n;
    const max = signed ? 0x7FFFFFFFFFFFFFFFn : 0xFFFFFFFFFFFFFFFFn;
    if (encoded.some((number) => number === undefined || number < min || number > max)) return undefined;
    const buffer = new ArrayBuffer(encoded.length * 8);
    const view = new DataView(buffer);
    encoded.forEach((number, index) => {
      if (signed) view.setBigInt64(index * 8, number!, le);
      else view.setBigUint64(index * 8, number!, le);
    });
    return { data: new Uint8Array(buffer), count: encoded.length };
  }
  if (spec.type === 1 || spec.type === 4 || spec.type === 6 || spec.type === 7 || spec.type === 9) {
    if (
      (spec.type === 1 || spec.type === 4 || spec.type === 6 || spec.type === 9) &&
      (typeof value === 'number' || typeof value === 'string') &&
      Number.isFinite(typeof value === 'number' ? value : Number(value))
    ) {
      const numeric = Math.round(typeof value === 'number' ? value : Number(value));
      if (spec.type === 1) {
        if (numeric < 0 || numeric > 255) return undefined;
        return { data: new Uint8Array([numeric]), count: 1 };
      }
      if (spec.type === 6) {
        if (numeric < -128 || numeric > 127) return undefined;
        return { data: new Uint8Array([numeric & 0xff]), count: 1 };
      }
      if (spec.type === 4) {
        if (numeric < 0 || numeric > 0xFFFFFFFF) return undefined;
        const dv = new DataView(new ArrayBuffer(4));
        dv.setUint32(0, numeric, le);
        return { data: new Uint8Array(dv.buffer), count: 1 };
      }
      if (spec.type === 9) {
        if (numeric < -0x80000000 || numeric > 0x7FFFFFFF) return undefined;
        const dv = new DataView(new ArrayBuffer(4));
        dv.setInt32(0, numeric, le);
        return { data: new Uint8Array(dv.buffer), count: 1 };
      }
      return undefined;
    }
    if (typeof value === 'string') {
      if (spec.type !== 7) return undefined;
      const bytes = new TextEncoder().encode(value);
      if (spec.count !== undefined && spec.count !== -1 && bytes.length !== spec.count) return undefined;
      return { data: bytes, count: bytes.length };
    }
    if (value instanceof Uint8Array) {
      if (spec.type !== 1 && spec.type !== 7) return undefined;
      if (spec.count !== undefined && spec.count !== -1 && value.length !== spec.count) return undefined;
      return { data: value, count: value.length };
    }
    if (Array.isArray(value) && value.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      const nums = value as number[];
      if (spec.count !== undefined && spec.count !== -1 && nums.length !== spec.count) return undefined;
      if (spec.type === 1 || spec.type === 4 || spec.type === 6 || spec.type === 9) {
        const integers = nums.map(Math.round);
        if (spec.type === 1) {
          if (integers.some((n) => n < 0 || n > 255)) return undefined;
          return { data: new Uint8Array(integers), count: integers.length };
        }
        if (spec.type === 6) {
          if (integers.some((n) => n < -128 || n > 127)) return undefined;
          return { data: new Uint8Array(integers.map((n) => n & 0xff)), count: integers.length };
        }
        const buf = new ArrayBuffer(nums.length * 4);
        const dv = new DataView(buf);
        if (spec.type === 4) {
          if (integers.some((n) => n < 0 || n > 0xFFFFFFFF)) return undefined;
          integers.forEach((n, i) => dv.setUint32(i * 4, n, le));
        } else {
          if (integers.some((n) => n < -0x80000000 || n > 0x7FFFFFFF)) return undefined;
          integers.forEach((n, i) => dv.setInt32(i * 4, n, le));
        }
        return { data: new Uint8Array(buf), count: nums.length };
      }
      const bytes = nums.map(Math.round);
      if (bytes.some((n) => n < 0 || n > 255)) return undefined;
      return { data: new Uint8Array(bytes), count: bytes.length };
    }
    return undefined;
  }
  if (spec.type === 11 || spec.type === 12) {
    const values = Array.isArray(value) ? value : [value];
    if (Array.isArray(value) && spec.count === undefined) return undefined;
    if (spec.count !== undefined && spec.count !== -1 && values.length !== spec.count) return undefined;
    if (values.length === 0) return undefined;
    const numbers = values.map((item) => {
      if (typeof item === 'number') return Number.isFinite(item) ? item : undefined;
      if (typeof item === 'string') {
        const number = Number(item);
        return Number.isFinite(number) ? number : undefined;
      }
      return undefined;
    });
    if (numbers.some((number) => number === undefined)) return undefined;
    const bytesPerValue = spec.type === 11 ? 4 : 8;
    const buffer = new ArrayBuffer(numbers.length * bytesPerValue);
    const view = new DataView(buffer);
    numbers.forEach((number, index) => {
      if (spec.type === 11) view.setFloat32(index * bytesPerValue, Math.fround(number!), le);
      else view.setFloat64(index * bytesPerValue, number!, le);
    });
    if (spec.type === 11 && numbers.some((number) => !Number.isFinite(Math.fround(number!)))) return undefined;
    return { data: new Uint8Array(buffer), count: numbers.length };
  }
  // RATIONAL (5) / SRATIONAL (10)
  const signed = spec.type === 10;
  const encodePair = (r: [number, number]) => {
    const min = signed ? -0x80000000 : 0;
    const max = signed ? 0x7FFFFFFF : 0xFFFFFFFF;
    if (
      !Number.isInteger(r[0]) || !Number.isInteger(r[1]) ||
      r[0] < min || r[0] > max || r[1] < min || r[1] > max || r[1] === 0 ||
      !signed && r[1] < 0
    ) return undefined;
    return r;
  };
  if (Array.isArray(value)) {
    const pairs: [number, number][] = [];
    if (spec.count === -1 || (spec.count !== undefined && value.length === spec.count)) {
      // Counted lists encode each element as one rational (e.g. LensInfo).
      for (const v of value) {
        const r = toRational(v);
        if (!r || !encodePair(r)) return undefined;
        pairs.push(r);
      }
    } else {
      for (let i = 0; i + 1 < value.length; i += 2) {
        const r = toRational([value[i], value[i + 1]]);
        if (!r || !encodePair(r)) return undefined;
        pairs.push(r);
      }
    }
    if (spec.count !== undefined && spec.count !== -1 && pairs.length !== spec.count) return undefined;
    if (pairs.length === 0) return undefined;
    return { data: rationals(pairs, signed, le), count: pairs.length };
  }
  if (spec.count === -1 && typeof value === 'string' && /[\s,]/.test(value.trim())) {
    const values = value.trim().split(/[\s,]+/);
    const pairs: [number, number][] = [];
    for (const item of values) {
      const rational = toRational(item);
      if (!rational || !encodePair(rational)) return undefined;
      pairs.push(rational);
    }
    return pairs.length > 0 ? { data: rationals(pairs, signed, le), count: pairs.length } : undefined;
  }
  const r = toRational(value);
  if (!r || !encodePair(r)) return undefined;
  if (spec.count !== undefined && spec.count !== -1 && spec.count !== 1) return undefined;
  return { data: rationals([r], signed, le), count: 1 };
}

interface Prepared {
  spec: IfdTagSpec;
  data: Uint8Array;
  count: number;
}

function encodeUserComment(value: TagValue, le = true): { data: Uint8Array; count: number } | undefined {
  if (typeof value !== 'string') return undefined;
  const body = new TextEncoder().encode(value);
  if (
    body.length >= 8 &&
    body[0] === 0x41 && body[1] === 0x53 && body[2] === 0x43 && body[3] === 0x49 &&
    body[4] === 0x49 && body[5] === 0x00 && body[6] === 0x00 && body[7] === 0x00
  ) {
    return { data: body, count: body.length };
  }
  const data = encodeExifText(value, le);
  return { data, count: data.length };
}

function encodeVersion(value: TagValue): { data: Uint8Array; count: number } | undefined {
  if (typeof value !== 'string' || !/^\d{4}$/.test(value)) return undefined;
  const data = new TextEncoder().encode(value);
  return { data, count: data.length };
}

function encodeDngVersion(value: TagValue): { data: Uint8Array; count: number } | undefined {
  if (typeof value !== 'string') return undefined;
  const parts = value.trim().split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return undefined;
  }
  return { data: new Uint8Array(parts), count: 4 };
}

function encodeCfaPattern(value: TagValue, le: boolean): { data: Uint8Array; count: number } | undefined {
  const values = typeof value === 'string'
    ? value.trim().split(/[\s,]+/).map(Number)
    : Array.isArray(value)
    ? value.map((item) => typeof item === 'number' ? item : NaN)
    : undefined;
  if (!values || values.length < 3 || values.some((item) => !Number.isInteger(item))) return undefined;
  const [columns, rows] = values;
  if (columns! < 1 || columns! > 0xffff || rows! < 1 || rows! > 0xffff) return undefined;
  if (values.length !== 2 + columns! * rows!) return undefined;
  const pattern = values.slice(2);
  if (pattern.some((item) => item < 0 || item > 0xff)) return undefined;
  const data = new Uint8Array(4 + pattern.length);
  const view = new DataView(data.buffer);
  view.setUint16(0, columns!, le);
  view.setUint16(2, rows!, le);
  data.set(pattern, 4);
  return { data, count: data.length };
}

function numericValue(value: TagValue): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const fraction = value.trim().match(/^([+-]?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (fraction) {
    const denominator = Number(fraction[2]);
    if (denominator === 0) return undefined;
    const result = Number(fraction[1]) / denominator;
    return Number.isFinite(result) ? result : undefined;
  }
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function inversePrintConv(spec: IfdTagSpec, value: TagValue, le: boolean): { data: Uint8Array; count: number } | undefined {
  if (spec.name === 'GrayResponseUnit') {
    const codes: Record<string, number> = {
      '0.1': 1,
      '0.001': 2,
      '0.0001': 3,
      '0.00001': 4,
      '0.000001': 5,
    };
    const code = codes[String(value).trim()];
    if (code !== undefined) return encodeValue(spec, code, le);
    if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5) {
      return encodeValue(spec, value, le);
    }
    return undefined;
  }
  if (spec.name === 'SecurityClassification' && typeof value === 'string') {
    const classes: Record<string, string> = {
      'top secret': 'T',
      secret: 'S',
      confidential: 'C',
      restricted: 'R',
      unclassified: 'U',
    };
    const code = classes[value.trim().toLowerCase()] ?? value.trim().toUpperCase();
    if (!/^[TSCRU]$/.test(code)) return undefined;
    return encodeValue(spec, code, le);
  }
  if ((spec.name === 'LensInfo' || spec.name === 'DNGLensInfo') && typeof value === 'string') {
    const match = value.match(/^([\d.]+)(?:-([\d.]+))?\s*mm.*?\bf\/?\s*([\d.]+)(?:-([\d.]+))?/i);
    if (match) {
      return encodeValue(spec, [Number(match[1]), Number(match[2] ?? match[1]), Number(match[3]), Number(match[4] ?? match[3])], le);
    }
  }
  if (HEX_UNDEFINED_TAGS.has(spec.name) && typeof value === 'string') {
    const hex = value.trim();
    if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) return undefined;
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (spec.count !== undefined && spec.count >= 0 && bytes.length !== spec.count) return undefined;
    return { data: bytes, count: bytes.length };
  }
  if (typeof value === 'string') {
    const suffix = spec.name === 'FocalLength' || spec.name === 'FocalLengthIn35mmFormat'
      ? 'mm'
      : spec.name === 'SubjectDistance' || spec.name === 'GPSHPositioningError'
      ? 'm'
      : undefined;
    if (suffix) value = value.trim().replace(new RegExp(`\\s*${suffix}$`, 'i'), '');
  }
  if (
    (spec.name === 'ApertureValue' || spec.name === 'MaxApertureValue' || spec.name === 'ShutterSpeedValue') &&
    (typeof value === 'number' || typeof value === 'string')
  ) {
    const display = numericValue(value);
    if (display === undefined) return undefined;
    const raw = spec.name === 'ShutterSpeedValue'
      ? display > 0 ? -Math.log2(display) : -100
      : display > 0 ? 2 * Math.log2(display) : 0;
    return encodeValue(spec, raw, le);
  }
  return encodeValue(spec, value, le);
}

function encodeGpsVersionId(value: TagValue, le: boolean): { data: Uint8Array; count: number } | undefined {
  if (typeof value === 'string') {
    const parts = value.trim().split(/\s*[.\s]\s*/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      return { data: new Uint8Array(parts), count: 4 };
    }
    return undefined;
  }
  return encodeValue(GPS_IFD_TAGS.gpsversionid, value, le);
}

function encodeGpsAltitude(value: TagValue, le: boolean): { data: Uint8Array; count: number } | undefined {
  if (typeof value === 'string') {
    const stripped = value.trim().replace(/\s*m$/, '');
    const n = Number(stripped);
    if (Number.isFinite(n)) return encodeValue(GPS_IFD_TAGS.gpsaltitude, n, le);
    return undefined;
  }
  return encodeValue(GPS_IFD_TAGS.gpsaltitude, value, le);
}

function encodeGpsAltitudeRef(value: TagValue): { data: Uint8Array; count: number } | undefined {
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    const labels: Record<string, number> = {
      'above sea level': 0,
      'below sea level': 1,
      'positive sea level (sea-level ref)': 2,
      'negative sea level (sea-level ref)': 3,
    };
    const labelValue = labels[s];
    if (labelValue !== undefined) return { data: new Uint8Array([labelValue]), count: 1 };
    const numeric = Number(s);
    if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 3) {
      return { data: new Uint8Array([numeric]), count: 1 };
    }
    return undefined;
  }
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 3) {
    return { data: new Uint8Array([value]), count: 1 };
  }
  return undefined;
}

function encodeGpsTimeStamp(value: TagValue, le: boolean): { data: Uint8Array; count: number } | undefined {
  if (typeof value === 'string') {
    const m = value.match(/^(\d{1,2}):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
    if (!m) return undefined;
    const parts = [Number(m[1]), Number(m[2]), Number(m[3])];
    return encodeValue(GPS_IFD_TAGS.gpstimestamp, parts, le);
  }
  return encodeValue(GPS_IFD_TAGS.gpstimestamp, value, le);
}

function encodeGpsDateStamp(value: TagValue, le: boolean): { data: Uint8Array; count: number } | undefined {
  if (typeof value !== 'string') return undefined;
  const m = value.trim().match(/^(\d{4})[:-](\d{2})[:-](\d{2})$/);
  if (!m) return undefined;
  return encodeValue(GPS_IFD_TAGS.gpsdatestamp, `${m[1]}:${m[2]}:${m[3]}`, le);
}

const COORD_TAG_NAMES = new Set(['GPSLatitude', 'GPSLongitude', 'GPSDestLatitude', 'GPSDestLongitude']);

export function prepareGpsCoordinateValue(
  name: string,
  value: TagValue,
  tags: Record<string, TagValue>,
): { coordinate: [number, number, number]; refName: string; refValue: string | undefined } | undefined {
  if (!COORD_TAG_NAMES.has(name)) return undefined;
  const coordinate = toGpsCoordinate(value);
  if (!coordinate) return undefined;
  const refName = name.replace(/Latitude$/, 'LatitudeRef').replace(/Longitude$/, 'LongitudeRef');
  const refEntry = Object.entries(tags).find(([key]) => key.toLowerCase() === refName.toLowerCase());
  const refValue = refEntry?.[1] !== undefined
    ? toGpsRef(refEntry[1])
    : refFromCoordinate(value, name.includes('Longitude') ? 'E' : 'N');
  return { coordinate, refName, refValue };
}

function encodeUndefinedBytes(
  name: string,
  value: TagValue,
): { data: Uint8Array; count: number } | undefined {
  const values = value instanceof Uint8Array
    ? Array.from(value)
    : Array.isArray(value)
    ? value
    : [value];
  if (name === 'SceneType' && values.length !== 1) return undefined;
  if (name === 'FileSource' && values.length !== 1 && values.length !== 4) return undefined;
  const bytes: number[] = [];
  for (const item of values) {
    const numeric = typeof item === 'number' ? item : typeof item === 'string' ? Number(item) : NaN;
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 255) return undefined;
    bytes.push(numeric);
  }
  return { data: new Uint8Array(bytes), count: bytes.length };
}

/**
 * Encodes one tag. GPS coordinate tags may synthesize their ref entry
 * (`GPSLatitudeRef`/…) when the tag map does not carry an explicit one.
 */
function encodeTag(
  spec: IfdTagSpec,
  value: TagValue,
  tags: Record<string, TagValue>,
  le: boolean,
  raw = false,
  applyInversePrintConv = true,
): { data: Uint8Array; count: number; extra?: Prepared[] } | undefined {
  if (raw) return encodeValue(spec, value, le);
  if (spec.name === 'FileSource' && typeof value === 'string' && value.trim().toLowerCase() === 'sigma digital camera') {
    return { data: new Uint8Array([3, 0, 0, 0]), count: 4 };
  }
  if (spec.values && typeof value === 'string') {
    const rawValue = resolveEnumValue(spec.values, value);
    if (rawValue === undefined) return undefined;
    value = rawValue;
  }
  switch (spec.name) {
    case 'FileSource':
    case 'SceneType':
      return encodeUndefinedBytes(spec.name, value);
    case 'UserComment':
      return encodeUserComment(value, le);
    case 'ExifVersion':
    case 'FlashpixVersion':
      return encodeVersion(value);
    case 'DNGVersion':
    case 'DNGBackwardVersion':
      return typeof value === 'string' ? encodeDngVersion(value) : encodeValue(spec, value);
    case 'CFAPattern':
      return encodeCfaPattern(value, le);
    case 'GPSVersionID':
      return encodeGpsVersionId(value, le);
    case 'GPSAltitude':
      return encodeGpsAltitude(value, le);
    case 'GPSAltitudeRef':
      return encodeGpsAltitudeRef(value);
    case 'GPSTimeStamp':
      return encodeGpsTimeStamp(value, le);
    case 'GPSDateStamp':
      return encodeGpsDateStamp(value, le);
    case 'GPSLatitudeRef':
    case 'GPSLongitudeRef':
    case 'GPSDestLatitudeRef':
    case 'GPSDestLongitudeRef': {
      const ref = toGpsRef(value);
      if (!ref) return undefined;
      return { data: new TextEncoder().encode(ref + '\0'), count: 2 };
    }
    case 'GPSLatitude':
    case 'GPSLongitude':
    case 'GPSDestLatitude':
    case 'GPSDestLongitude': {
      const prepared = prepareGpsCoordinateValue(spec.name, value, tags);
      if (!prepared) return undefined;
      const encoded = encodeValue(spec, prepared.coordinate, le);
      if (!encoded) return undefined;
      const extra: Prepared[] = [];
      if (prepared.refValue) {
        const refSpec = GPS_IFD_TAGS[prepared.refName.toLowerCase()];
        const refBytes = new TextEncoder().encode(prepared.refValue + '\0');
        extra.push({ spec: refSpec, data: refBytes, count: refBytes.length });
      }
      return { ...encoded, extra };
    }
    default:
      return applyInversePrintConv ? inversePrintConv(spec, value, le) : encodeValue(spec, value, le);
  }
}

function resolveEnumValue(values: Record<number, string>, value: string): number | undefined {
  const input = value.trim();
  if (input.length === 0) return undefined;
  const numeric = Number(input);
  if (Number.isFinite(numeric)) return numeric;
  const normalized = input.toLowerCase();
  const entries = Object.entries(values);
  const exact = entries.filter(([, label]) => label.toLowerCase() === normalized);
  if (exact.length === 1) return Number(exact[0]![0]);
  if (exact.length > 1) return undefined;
  const matches = entries.filter(([, label]) => label.toLowerCase().startsWith(normalized));
  return matches.length === 1 ? Number(matches[0]![0]) : undefined;
}

/**
 * Serializes the writable subset of `tags` into a TIFF in the selected byte order
 * structure: IFD0, ExifIFD (0x8769), GPS (0x8825), and InteropIFD (0xa005).
 * Names are resolved through the corresponding IFD tag maps;
 * unrecognized or unencodable names are reported as skipped. Sub-IFD
 * pointer entries are synthesized only when the respective IFD has tags.
 */
export function buildTiff(tags: Record<string, TagValue>, options: BuildTiffOptions = {}): BuildTiffResult {
  if (options.bigTiff) return buildBigTiffIfd0(tags, options);
  const le = options.byteOrder !== 'big';
  const written: string[] = [];
  const skipped: string[] = [];
  const prepared0: Prepared[] = [];
  const preparedE: Prepared[] = [];
  const preparedG: Prepared[] = [];
  const preparedI: Prepared[] = [];
  const prepared1: Prepared[] = [];
  const preparedS: Prepared[] = [];
  let thumbnailImage: Uint8Array | undefined;
  const seenIds = new Map<Record<string, IfdTagSpec>, Set<number>>([
    [IFD0_TAGS, new Set()],
    [EXIF_IFD_TAGS, new Set()],
    [GPS_IFD_TAGS, new Set()],
    [INTEROP_IFD_TAGS, new Set()],
    [SUB_IFD_TAGS, new Set()],
  ]);
  const synthRefs = new Map<number, Prepared>();

  for (const [name, value] of Object.entries(tags)) {
    const raw = name.endsWith('#');
    const key = (raw ? name.slice(0, -1) : name).toLowerCase();
    if (key === 'thumbnailimage' || key === 'ifd1:thumbnailimage') {
      if (!(value instanceof Uint8Array) || value.length < 4 || value[0] !== 0xff || value[1] !== 0xd8) {
        skipped.push(name);
      } else if (!thumbnailImage) {
        thumbnailImage = value;
        written.push('ThumbnailImage');
      }
      continue;
    }
    const separator = key.indexOf(':');
    const hasGroup = separator !== -1;
    const tagKey = hasGroup ? key.slice(separator + 1) : key;
    const requestedGroup = hasGroup ? IFD_TAG_GROUPS[key.slice(0, separator)] : undefined;
    const selectedGroup = hasGroup
      ? requestedGroup
      : IFD0_TAGS[tagKey]
      ? IFD0_TAGS
      : EXIF_IFD_TAGS[tagKey]
      ? EXIF_IFD_TAGS
      : GPS_IFD_TAGS[tagKey]
      ? GPS_IFD_TAGS
      : INTEROP_IFD_TAGS[tagKey]
      ? INTEROP_IFD_TAGS
      : SUB_IFD_TAGS[tagKey]
      ? SUB_IFD_TAGS
      : undefined;
    const spec = selectedGroup?.[tagKey];
    if (!spec) {
      skipped.push(name);
      continue;
    }
    const groupSeenIds = seenIds.get(selectedGroup)!;
    const encoded = encodeTag(spec, value, tags, le, raw, options.inversePrintConv !== false);
    if (!encoded) {
      skipped.push(name);
      continue;
    }
    const target = selectedGroup === EXIF_IFD_TAGS
      ? preparedE
      : selectedGroup === GPS_IFD_TAGS
      ? preparedG
      : selectedGroup === INTEROP_IFD_TAGS
      ? preparedI
      : selectedGroup === SUB_IFD_TAGS
      ? preparedS
      : prepared0;
    if (groupSeenIds.has(spec.id)) {
      const previous = target.find((entry) => entry.spec.id === spec.id);
      if (previous) {
        previous.data = encoded.data;
        previous.count = encoded.count;
      }
      continue;
    }
    groupSeenIds.add(spec.id);
    target.push({ spec, data: encoded.data, count: encoded.count });
    if (encoded.extra) {
      for (const e of encoded.extra) {
        if (!synthRefs.has(e.spec.id)) synthRefs.set(e.spec.id, e);
      }
    }
    written.push(spec.name);
  }

  if (thumbnailImage) {
    const compressionSpec: IfdTagSpec = { id: 0x0103, type: 3, name: 'Compression' };
    const offsetSpec: IfdTagSpec = { id: 0x0201, type: 4, name: 'ThumbnailOffset' };
    const lengthSpec: IfdTagSpec = { id: 0x0202, type: 4, name: 'ThumbnailLength' };
    const compression = encodeValue(compressionSpec, 6, le)!;
    const length = encodeValue(lengthSpec, thumbnailImage.length, le)!;
    prepared1.push(
      { spec: compressionSpec, data: compression.data, count: compression.count },
      { spec: offsetSpec, data: new Uint8Array(4), count: 1 },
      { spec: lengthSpec, data: length.data, count: length.count },
    );
  }

  // Explicit GPS references win over synthesized ones.
  const gpsSeenIds = seenIds.get(GPS_IFD_TAGS)!;
  for (const [id, e] of synthRefs) {
    if (!gpsSeenIds.has(id)) {
      gpsSeenIds.add(id);
      preparedG.push(e);
      written.push(e.spec.name);
    }
  }
  if (!options.noMandatory && preparedG.length && !gpsSeenIds.has(GPS_IFD_TAGS.gpsversionid!.id)) {
    const spec = GPS_IFD_TAGS.gpsversionid!;
    gpsSeenIds.add(spec.id);
    preparedG.push({ spec, data: new Uint8Array([2, 3, 0, 0]), count: 4 });
    written.push(spec.name);
  }

  const exifSeenIds = seenIds.get(EXIF_IFD_TAGS)!;
  if (!options.noMandatory && (preparedE.length || preparedI.length)) {
    const mandatoryExif = [
      { spec: EXIF_IFD_TAGS.exifversion!, data: new TextEncoder().encode('0232'), count: 4 },
      { spec: EXIF_IFD_TAGS.componentsconfiguration!, data: new Uint8Array([1, 2, 3, 0]), count: 4 },
      { spec: EXIF_IFD_TAGS.colorspace!, data: encodeValue(EXIF_IFD_TAGS.colorspace!, 0xffff, le)!.data, count: 1 },
    ];
    for (const entry of mandatoryExif) {
      if (!exifSeenIds.has(entry.spec.id)) {
        exifSeenIds.add(entry.spec.id);
        preparedE.push(entry);
        written.push(entry.spec.name);
      }
    }
  }

  const interopSeenIds = seenIds.get(INTEROP_IFD_TAGS)!;
  if (!options.noMandatory && preparedI.length && !interopSeenIds.has(INTEROP_IFD_TAGS.interopversion!.id)) {
    const spec = INTEROP_IFD_TAGS.interopversion!;
    interopSeenIds.add(spec.id);
    preparedI.push({ spec, data: new TextEncoder().encode('0100'), count: 4 });
    written.push(spec.name);
  }

  const hasExifIfd = preparedE.length > 0 || preparedI.length > 0;
  const hasSubIfd = preparedS.length > 0;
  const exifEntries = [...preparedE];
  if (preparedI.length) {
    exifEntries.push({ spec: { id: 0xA005, type: 4, name: 'InteropIFDPointer' }, data: new Uint8Array(4), count: 1 });
  }
  const ifd0Size = 2 + (prepared0.length + (hasExifIfd ? 1 : 0) + (preparedG.length ? 1 : 0) + (hasSubIfd ? 1 : 0)) * 12 + 4;
  const subIfdOff = 8 + ifd0Size;
  const subIfdSize = 2 + preparedS.length * 12 + 4;
  const ifd1Off = subIfdOff + (hasSubIfd ? subIfdSize : 0);
  const ifd1Size = 2 + prepared1.length * 12 + 4;
  const exifOff = ifd1Off + (prepared1.length ? ifd1Size : 0);
  const exifSize = 2 + exifEntries.length * 12 + 4;
  const interopOff = exifOff + (hasExifIfd ? exifSize : 0);
  const interopSize = 2 + preparedI.length * 12 + 4;
  const gpsOff = interopOff + (preparedI.length ? interopSize : 0);
  const gpsSize = 2 + preparedG.length * 12 + 4;
  const valuesOffset = gpsOff + (preparedG.length ? gpsSize : 0);

  // IFD0 entries plus synthesized sub-IFD pointers, sorted by tag id.
  const ifd0Entries = [...prepared0];
  if (hasExifIfd) {
    ifd0Entries.push({ spec: { id: 0x8769, type: 4, name: 'ExifIFDPointer' }, data: new Uint8Array(4), count: 1 });
  }
  if (preparedG.length) {
    ifd0Entries.push({ spec: { id: 0x8825, type: 4, name: 'GPSIFDPointer' }, data: new Uint8Array(4), count: 1 });
  }
  if (hasSubIfd) {
    ifd0Entries.push({ spec: { id: 0x014A, type: 4, name: 'SubIFDs' }, data: new Uint8Array(4), count: 1 });
  }
  ifd0Entries.sort((a, b) => a.spec.id - b.spec.id);
  exifEntries.sort((a, b) => a.spec.id - b.spec.id);
  preparedI.sort((a, b) => a.spec.id - b.spec.id);
  preparedG.sort((a, b) => a.spec.id - b.spec.id);

  // Lay out oversized values first so offsets are known.
  const valueBlobs: Uint8Array[] = [];
  const valueOffsets = new Map<Prepared, number>();
  let cursor = valuesOffset;
  const layoutBlobs = (prepared: Prepared[]) => {
    for (const p of prepared) {
      if (p.data.length > 4) {
        valueOffsets.set(p, cursor);
        valueBlobs.push(p.data);
        cursor += p.data.length;
        if (cursor % 2) {
          valueBlobs.push(new Uint8Array([0]));
          cursor++;
        }
      }
    }
  };
  layoutBlobs(ifd0Entries);
  layoutBlobs(preparedS);
  layoutBlobs(prepared1);
  layoutBlobs(exifEntries);
  layoutBlobs(preparedI);
  layoutBlobs(preparedG);
  const thumbnailOffset = cursor;
  if (thumbnailImage) {
    valueBlobs.push(thumbnailImage);
    cursor += thumbnailImage.length;
  }

  const total = cursor;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out[0] = le ? 0x49 : 0x4D;
  out[1] = le ? 0x49 : 0x4D;
  dv.setUint16(2, 0x2A, le);
  dv.setUint32(4, 8, le);
  dv.setUint16(8, ifd0Entries.length, le);

  const writeIfd = (offset: number, entries: Prepared[], nextIfd: number, pointerValues: Map<number, number>) => {
    dv.setUint16(offset, entries.length, le);
    let entryPos = offset + 2;
    for (const p of entries) {
      dv.setUint16(entryPos, p.spec.id, le);
      dv.setUint16(entryPos + 2, p.spec.type, le);
      dv.setUint32(entryPos + 4, p.count, le);
      const pointer = pointerValues.get(p.spec.id);
      if (pointer !== undefined) {
        dv.setUint32(entryPos + 8, pointer, le);
      } else if (p.data.length <= 4) {
        out.set(p.data, entryPos + 8);
      } else {
        dv.setUint32(entryPos + 8, valueOffsets.get(p)!, le);
      }
      entryPos += 12;
    }
    dv.setUint32(entryPos, nextIfd, le);
  };

  const pointerValues = new Map<number, number>();
  if (hasExifIfd) pointerValues.set(0x8769, exifOff);
  if (preparedG.length) pointerValues.set(0x8825, gpsOff);
  if (hasSubIfd) pointerValues.set(0x014A, subIfdOff);

  writeIfd(8, ifd0Entries, prepared1.length ? ifd1Off : 0, pointerValues);
  if (hasSubIfd) writeIfd(subIfdOff, preparedS, 0, new Map());
  if (prepared1.length) {
    writeIfd(ifd1Off, prepared1, 0, new Map([[0x0201, thumbnailOffset]]));
  }
  if (hasExifIfd) {
    const exifPointerValues = new Map<number, number>();
    if (preparedI.length) exifPointerValues.set(0xA005, interopOff);
    writeIfd(exifOff, exifEntries, 0, exifPointerValues);
  }
  if (preparedI.length) writeIfd(interopOff, preparedI, 0, new Map());
  if (preparedG.length) writeIfd(gpsOff, preparedG, 0, new Map());

  let blobPos = valuesOffset;
  for (const blob of valueBlobs) {
    out.set(blob, blobPos);
    blobPos += blob.length;
  }

  return { bytes: out, written, skipped };
}

function buildBigTiffIfd0(tags: Record<string, TagValue>, options: BuildTiffOptions): BuildTiffResult {
  const le = options.byteOrder !== 'big';
  const written: string[] = [];
  const skipped: string[] = [];
  const prepared0: Prepared[] = [];
  const preparedE: Prepared[] = [];
  const preparedI: Prepared[] = [];
  const seenIds = new Map<Record<string, IfdTagSpec>, Set<number>>([
    [IFD0_TAGS, new Set()],
    [EXIF_IFD_TAGS, new Set()],
    [INTEROP_IFD_TAGS, new Set()],
  ]);
  const preparedByGroup = new Map<Record<string, IfdTagSpec>, Prepared[]>([
    [IFD0_TAGS, prepared0],
    [EXIF_IFD_TAGS, preparedE],
    [INTEROP_IFD_TAGS, preparedI],
  ]);
  const synthRefs = new Map<number, Prepared>();

  for (const [name, inputValue] of Object.entries(tags)) {
    const raw = name.endsWith('#');
    const key = (raw ? name.slice(0, -1) : name).toLowerCase();
    const separator = key.indexOf(':');
    const tagKey = separator === -1 ? key : key.slice(separator + 1);
    const requestedGroup = separator === -1 ? undefined : IFD_TAG_GROUPS[key.slice(0, separator)];
    const selectedGroup = separator !== -1
      ? requestedGroup
      : IFD0_TAGS[tagKey]
      ? IFD0_TAGS
      : EXIF_IFD_TAGS[tagKey]
      ? EXIF_IFD_TAGS
      : INTEROP_IFD_TAGS[tagKey]
      ? INTEROP_IFD_TAGS
      : undefined;
    const spec = selectedGroup?.[tagKey];
    const target = selectedGroup ? preparedByGroup.get(selectedGroup) : undefined;
    if (!spec || !target) {
      skipped.push(name);
      continue;
    }
    const encoded = encodeTag(spec, inputValue, tags, le, raw, options.inversePrintConv !== false);
    if (!encoded) {
      skipped.push(name);
      continue;
    }
    const groupSeenIds = seenIds.get(selectedGroup)!;
    const existing = groupSeenIds.has(spec.id) ? target.find((entry) => entry.spec.id === spec.id) : undefined;
    if (existing) {
      existing.data = encoded.data;
      existing.count = encoded.count;
      continue;
    }
    groupSeenIds.add(spec.id);
    target.push({ spec, data: encoded.data, count: encoded.count });
    for (const extra of encoded.extra ?? []) {
      if (!synthRefs.has(extra.spec.id)) synthRefs.set(extra.spec.id, extra);
    }
    written.push(spec.name);
  }

  const exifSeenIds = seenIds.get(EXIF_IFD_TAGS)!;
  if (!options.noMandatory && (preparedE.length || preparedI.length)) {
    const defaults: Prepared[] = [
      { spec: EXIF_IFD_TAGS.exifversion!, data: new TextEncoder().encode('0232'), count: 4 },
      { spec: EXIF_IFD_TAGS.componentsconfiguration!, data: new Uint8Array([1, 2, 3, 0]), count: 4 },
      {
        spec: EXIF_IFD_TAGS.colorspace!,
        data: encodeValue(EXIF_IFD_TAGS.colorspace!, 0xffff, le)!.data,
        count: 1,
      },
    ];
    for (const entry of defaults) {
      if (!exifSeenIds.has(entry.spec.id)) {
        exifSeenIds.add(entry.spec.id);
        preparedE.push(entry);
        written.push(entry.spec.name);
      }
    }
  }
  const interopSeenIds = seenIds.get(INTEROP_IFD_TAGS)!;
  if (!options.noMandatory && preparedI.length && !interopSeenIds.has(INTEROP_IFD_TAGS.interopversion!.id)) {
    const spec = INTEROP_IFD_TAGS.interopversion!;
    interopSeenIds.add(spec.id);
    preparedI.push({ spec, data: new TextEncoder().encode('0100'), count: 4 });
    written.push(spec.name);
  }

  const exifEntries = [...preparedE];
  if (preparedI.length) {
    exifEntries.push({
      spec: { id: 0xA005, type: 18, name: 'InteropIFDPointer' },
      data: new Uint8Array(8),
      count: 1,
    });
  }
  const ifd0Entries = [...prepared0];
  if (exifEntries.length) {
    ifd0Entries.push({ spec: { id: 0x8769, type: 18, name: 'ExifIFDPointer' }, data: new Uint8Array(8), count: 1 });
  }
  for (const groupEntries of [ifd0Entries, exifEntries, preparedI]) {
    groupEntries.sort((left, right) => left.spec.id - right.spec.id);
  }

  const directories: Array<{ entries: Prepared[]; offset: number }> = [];
  let directoryCursor = 16;
  const addDirectory = (entries: Prepared[]) => {
    if (entries.length === 0) return -1;
    const offset = directoryCursor;
    directories.push({ entries, offset });
    directoryCursor += 8 + entries.length * 20 + 8;
    return offset;
  };
  const ifd0Offset = addDirectory(ifd0Entries);
  const exifOffset = addDirectory(exifEntries);
  const interopOffset = addDirectory(preparedI);
  const valuesOffset = directoryCursor;
  const valueOffsets = new Map<Prepared, number>();
  let cursor = valuesOffset;
  for (const directory of directories) {
    for (const entry of directory.entries) {
      if (entry.data.length > 8) {
        valueOffsets.set(entry, cursor);
        cursor += entry.data.length;
        if (cursor % 8) cursor += 8 - (cursor % 8);
      }
    }
  }

  const out = new Uint8Array(cursor);
  const dv = new DataView(out.buffer);
  out[0] = le ? 0x49 : 0x4D;
  out[1] = le ? 0x49 : 0x4D;
  dv.setUint16(2, 43, le);
  dv.setUint16(4, 8, le);
  dv.setUint16(6, 0, le);
  dv.setBigUint64(8, 16n, le);

  const pointerValues = new Map<number, number>();
  if (exifOffset >= 0) pointerValues.set(0x8769, exifOffset);
  const exifPointerValues = new Map<number, number>();
  if (interopOffset >= 0) exifPointerValues.set(0xA005, interopOffset);

  const writeIfd = (offset: number, ifdEntries: Prepared[], pointers: Map<number, number>) => {
    dv.setBigUint64(offset, BigInt(ifdEntries.length), le);
    let entryOffset = offset + 8;
    for (const entry of ifdEntries) {
      dv.setUint16(entryOffset, entry.spec.id, le);
      dv.setUint16(entryOffset + 2, entry.spec.type, le);
      dv.setBigUint64(entryOffset + 4, BigInt(entry.count), le);
      const pointer = pointers.get(entry.spec.id);
      if (pointer !== undefined) {
        dv.setBigUint64(entryOffset + 12, BigInt(pointer), le);
      } else if (entry.data.length <= 8) {
        out.set(entry.data, entryOffset + 12);
      } else {
        dv.setBigUint64(entryOffset + 12, BigInt(valueOffsets.get(entry)!), le);
      }
      entryOffset += 20;
    }
    dv.setBigUint64(entryOffset, 0n, le);
  };
  for (const directory of directories) {
    const pointers = directory.offset === ifd0Offset
      ? pointerValues
      : directory.offset === exifOffset
      ? exifPointerValues
      : new Map<number, number>();
    writeIfd(directory.offset, directory.entries, pointers);
  }

  for (const directory of directories) {
    for (const entry of directory.entries) {
      const offset = valueOffsets.get(entry);
      if (offset !== undefined) out.set(entry.data, offset);
    }
  }

  return { bytes: out, written, skipped };
}
