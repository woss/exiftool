import type { TagValue } from '../types.js';

const textDecoder = new TextDecoder();

function readUint32BE(view: DataView, offset: number): number {
  return view.getUint32(offset, false);
}

function readUint16BE(view: DataView, offset: number): number {
  return view.getUint16(offset, false);
}

function readASCII(view: DataView, offset: number, length: number): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
  const end = bytes.indexOf(0);
  return textDecoder.decode(end >= 0 ? bytes.slice(0, end) : bytes);
}

function readFixed32BE(view: DataView, offset: number): number {
  return readUint32BE(view, offset) / 65536;
}

function formatS15Fixed16(v: number): string {
  let s = (Math.round(v * 100000) / 100000).toFixed(5);
  s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
}

function readXYZ(view: DataView, offset: number): string {
  return [
    formatS15Fixed16(readFixed32BE(view, offset)),
    formatS15Fixed16(readFixed32BE(view, offset + 4)),
    formatS15Fixed16(readFixed32BE(view, offset + 8)),
  ].join(" ");
}

function readUint8Array(view: DataView, offset: number, count: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < count; i++) {
    result.push(view.getUint8(offset + i));
  }
  return result;
}

export function parseICCProfile(data: Uint8Array): Record<string, TagValue> {
  const result: Record<string, TagValue> = {};
  if (data.length < 128) return result;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const profileSize = readUint32BE(view, 0);
  const cmmType = readASCII(view, 4, 4);
  const versionMajor = view.getUint8(8);
  const versionMinorNibble = view.getUint8(9);
  const versionMinor = (versionMinorNibble >> 4);
  const versionBugFix = (versionMinorNibble & 0x0F);
  const profileClass = readASCII(view, 12, 4);
  const dataColorSpace = readASCII(view, 16, 4);
  const pcs = readASCII(view, 20, 4);
  const creationDate = `${readUint16BE(view, 24)}:${String(readUint16BE(view, 26)).padStart(2, '0')}:${String(readUint16BE(view, 28)).padStart(2, '0')} ${String(readUint16BE(view, 30)).padStart(2, '0')}:${String(readUint16BE(view, 32)).padStart(2, '0')}:${String(readUint16BE(view, 34)).padStart(2, '0')}`;
  const platform = readASCII(view, 40, 4);
  const renderingIntent = readUint32BE(view, 64);
  const pcsIlluminant = readXYZ(view, 68);
  const profileCreator = readASCII(view, 80, 4);
  const profileID = readUint8Array(view, 84, 16).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();

  const CLASS_NAMES: Record<string, string> = {
    'scnr': 'Input Device Profile',
    'mntr': 'Display Device Profile',
    'prtr': 'Output Device Profile',
    'link': 'DeviceLink Profile',
    'spac': 'ColorSpace Conversion Profile',
    'abst': 'Abstract Profile',
    'nmcl': 'Named Color Profile',
  };

  const INTENT_NAMES: Record<number, string> = {
    0: 'Perceptual',
    1: 'Media-Relative Colorimetric',
    2: 'Saturation',
    3: 'ICC-Absolute Colorimetric',
  };

  const PLATFORM_NAMES: Record<string, string> = {
    'APPL': 'Apple Computer Inc.',
    'MSFT': 'Microsoft Corporation',
    'SGI ': 'Silicon Graphics Inc.',
    'SUNW': 'Sun Microsystems Inc.',
    'TGNT': 'Tailgent',
  };

  result['ProfileSize'] = profileSize;
  const CMM_TYPES: Record<string, string> = {
    "ADBE": "Adobe Systems Inc.",
    "APPL": "Apple Computer Inc.",
    "Lino": "Linotronic",
    "IEC ": "Hewlett-Packard",
  };
  result["ProfileCMMType"] = CMM_TYPES[cmmType] ?? cmmType.trim();
  result['CMMFlags'] = cmmType ? 'Not Embedded, Independent' : 'Embedded';
  result['ProfileVersion'] = `${versionMajor}.${versionMinor}.${versionBugFix}`;
  result['ProfileClass'] = CLASS_NAMES[profileClass] ?? profileClass;
  result['ColorSpaceData'] = dataColorSpace;
  result['ProfileConnectionSpace'] = pcs;
  result['ProfileDateTime'] = creationDate;
  result['ProfileFileSignature'] = readASCII(view, 36, 4);
  result['PrimaryPlatform'] = PLATFORM_NAMES[platform] ?? platform;
  result['RenderingIntent'] = INTENT_NAMES[renderingIntent] ?? renderingIntent;
  result['ConnectionSpaceIlluminant'] = pcsIlluminant;
  result["ProfileCreator"] = ICC_MANUFACTURERS[profileCreator] ?? profileCreator.trim();
  result['ProfileID'] = profileID === '00000000000000000000000000000000' ? 0 : profileID;
  const devMfg = readASCII(view, 48, 4);
  const devModel = readASCII(view, 52, 4);
  const attrLo = readUint32BE(view, 56);
  const attrHi = readUint32BE(view, 60);
  if (devMfg) result['DeviceManufacturer'] = ICC_MANUFACTURERS[devMfg] ?? devMfg.trim();
  if (devModel) result['DeviceModel'] = ICC_MODELS[devModel] ?? devModel.trim();
  const attrs: string[] = [];
  if (attrLo & 0x01) attrs.push('Transparency');
  else attrs.push('Reflective');
  if (attrLo & 0x02) attrs.push('Matte');
  else attrs.push('Glossy');
  if (attrHi & 0x01) attrs.push('Negative');
  else attrs.push('Positive');
  if (attrHi & 0x02) attrs.push('Monochrome');
  else attrs.push('Color');
  result['DeviceAttributes'] = attrs.join(', ');

  const numTags = readUint32BE(view, 128);
  let tagOffset = 132;

  for (let i = 0; i < numTags && tagOffset + 12 <= data.length; i++) {
    const tagSig = readASCII(view, tagOffset, 4);
    const tagDataOffset = readUint32BE(view, tagOffset + 4);
    const tagSize = readUint32BE(view, tagOffset + 8);
    tagOffset += 12;

    if (tagDataOffset + tagSize > data.length) continue;

    const tagView = new DataView(data.buffer, data.byteOffset + tagDataOffset, tagSize);
    let tagType = '';
    try {
      tagType = readASCII(tagView, 0, 4);
    } catch {
      continue;
    }
    const tagName = ICC_TAG_NAMES[tagSig] ?? tagSig;

    try {
      if (tagType === 'text') {
        result[tagName] = readASCII(tagView, 8, tagSize - 8);
      } else if (tagType === 'desc') {
        const descLen = readUint32BE(tagView, 8);
        result[tagName] = readASCII(tagView, 12, descLen);
      } else if (tagType === 'XYZ ') {
        result[tagName] = readXYZ(tagView, 8);
      } else if (tagType === 'curv') {
        const curveCount = readUint32BE(tagView, 8);
        if (curveCount === 0) {
          result[tagName] = '(Linear)';
        } else {
          // ExifTool reports the full tag-data block (including the 'curv'
          // signature and count) and keeps the bytes extractable via -b.
          result[tagName] = data.slice(tagDataOffset, tagDataOffset + tagSize);
        }
      } else if (tagType === 'sig ') {
        // Technology-style tags: data = 'sig ' + reserved + actual signature.
        const techNames: Record<string, string> = {
          'CRT ': 'Cathode Ray Tube Display',
          'LCD ': 'LCD Display',
          'PMD ': 'Passive Matrix Display',
          'FSCN': 'Film Scanner',
          'DCAM': 'Digital Camera',
          'DCP ': 'Digital Still Camera',
        };
        const techSig = readASCII(view, tagDataOffset + 8, 4);
        result[tagName] = techNames[techSig] ?? techSig.trim();
      } else if (tagType === 'mluc') {
        const langCount = readUint32BE(tagView, 8);
        if (langCount > 0) {
          const firstLen = readUint32BE(tagView, 20);
          const firstOffset = readUint32BE(tagView, 24);
          result[tagName] = readASCII(tagView, firstOffset, firstLen);
        }
      } else if (tagType === 'para') {
        result[tagName] = data.slice(tagDataOffset, tagDataOffset + tagSize);
      } else if (tagType === 'meas') {
        // Offsets calibrated empirically against ExifTool 13.55 output.
        if (tagSize >= 30) {
          const obs = readUint16BE(tagView, 10);
          const obsNames: Record<number, string> = { 0: 'Unknown', 1: 'CIE 1931', 2: 'CIE 1964' };
          result[`${tagName}Backing`] = readXYZ(tagView, 14);
          const geo = readUint16BE(tagView, 26);
          const geoNames: Record<number, string> = { 0: 'Unknown', 1: '0/45', 2: '45/0', 3: '0/d', 4: 'd/0' };
          result[`${tagName}Geometry`] = geoNames[geo] ?? 'Unknown';
          result[`${tagName}Flare`] = `${(readUint16BE(tagView, 30) / 65536 * 100).toFixed(3)}%`;
          const ill = readUint16BE(tagView, 34);
          const illNames: Record<number, string> = { 0: 'Unknown', 1: 'D50', 2: 'D65', 3: 'D55', 4: 'D5000', 5: 'D9300', 6: 'F2', 7: 'F7', 8: 'F11' };
          result[`${tagName}Illuminant`] = illNames[ill] ?? 'Unknown';
          result[`${tagName}Observer`] = obsNames[obs] ?? 'Unknown';
        }
      } else if (tagType === 'view') {
        // ICC v2 'view' layout: illum XYZ @8, surround XYZ @20, type u16 @32
        if (tagSize >= 34) {
          result[`${tagName}Illuminant`] = readXYZ(tagView, 8);
          result[`${tagName}Surround`] = readXYZ(tagView, 20);
          const illTypeNum = readUint16BE(tagView, 34);
          const illTypeNames: Record<number, string> = { 0: 'Unknown', 1: 'D50', 2: 'D65', 3: 'D55', 4: 'D5000', 5: 'D9300', 6: 'F2', 7: 'F7', 8: 'F11' };
          result[`${tagName}IlluminantType`] = illTypeNames[illTypeNum] ?? 'Unknown';
        }
      } else if (tagType === 'sf32') {
        const count = Math.min((tagSize - 8) / 4, 100);
        const vals: number[] = [];
        for (let j = 0; j < count; j++) {
          vals.push(tagView.getInt32(8 + j * 4, false) / 65536);
        }
        result[tagName] = vals.join(' ');
      } else {
        const dataLen = Math.max(tagSize - 8, 0);
        result[tagName] = `(Binary data ${dataLen} bytes, use -b option to extract)`;
      }
    } catch (e) {
      // skip tag on parse error
    }
  }

  return result;
}

const ICC_MANUFACTURERS: Record<string, string> = {
  'APPL': 'Apple Computer Inc.',
  'ADBE': 'Adobe Systems Inc.',
  'MSFT': 'Microsoft Corporation',
  'SGI ': 'Silicon Graphics Inc.',
  'SUNW': 'Sun Microsystems Inc.',
  'TGNT': 'Tailgent',
  'HEWL': 'Hewlett-Packard',
  'HP  ': 'Hewlett-Packard',
  'IEC ': 'Hewlett-Packard',
  'ICM ': 'Microsoft Corporation',
  'EK  ': 'Eastman Kodak Company',
  'CANO': 'Canon Inc.',
  'NIKO': 'Nikon Corporation',
  'SONY': 'Sony Corporation',
  'FUJI': 'Fuji Photo Film Co. Ltd.',
  'EPSO': 'Epson America Inc.',
  'MNLT': 'Minolta Co. Ltd.',
  'KODA': 'Eastman Kodak Company',
  'KYOC': 'Kyocera Corporation',
  'LEAF': 'Leaf Systems Inc.',
  'LEIC': 'Leica Camera AG',
  'MAMI': 'Mamiya Co. Ltd.',
  'OLYM': 'Olympus Corporation',
  'PENT': 'Pentax Corporation',
  'SAMS': 'Samsung Electronics Co. Ltd.',
  'SEIK': 'Seiko Epson Corporation',
  'SHAR': 'Sharp Corporation',
  'TRIP': 'Tripod Technology Corporation',
};

const ICC_MODELS: Record<string, string> = {
  'sRGB': 'sRGB',
  'IEC6': 'IEC 61966-2.1',
  'ROMM': 'ROMM RGB',
  'ADBE': 'Adobe RGB (1998)',
  'ACES': 'ACES',
  'ADCS': 'ADCS',
  'APL0': 'Apple RGB',
  'BG19': 'Bruce RGB',
  'CMP ': 'CIE 1931 XYZ',
  'CGMS': 'ColorMatch RGB',
  'CIER': 'CIE RGB',
  'CLID': 'ColorLCD',
  'CLR ': 'ColorMatch RGB',
  'CVTS': 'Calibrated RGB',
  'DCAP': 'DCAM',
  'DSNB': 'DCAM',
  'FL39': 'FL39',
  'FX15': 'FX15',
  'FX17': 'FX17',
  'FX19': 'FX19',
  'IDYA': 'Don RGB',
  'LSTD': 'LCD',
  'MATC': 'MAT',
  'MG01': 'MG01',
  'NONE': 'Uncalibrated',
  'RMM1': 'ROMM RGB',
  'RMLR': 'RIMM RGB',
  'SPCT': 'SPOT',
  'SRG0': 'sRGB',
  'SRGB': 'sRGB',
  'SYCC': 'sYCC',
  'UCLI': 'Uncalibrated',
  'WTGN': 'Wide Gamut RGB',
};

const ICC_TAG_NAMES: Record<string, string> = {
  'desc': 'ProfileDescription',
  'cprt': 'ProfileCopyright',
  'wtpt': 'MediaWhitePoint',
  'bkpt': 'MediaBlackPoint',
  'rXYZ': 'RedMatrixColumn',
  'gXYZ': 'GreenMatrixColumn',
  'bXYZ': 'BlueMatrixColumn',
  'rTRC': 'RedTRC',
  'gTRC': 'GreenTRC',
  'bTRC': 'BlueTRC',
  'kTRC': 'GrayTRC',
  'chad': 'ChromaticAdaptation',
  'gamt': 'Gamut',
  'lumi': 'Luminance',
  'meas': 'Measurement',
  'tech': 'Technology',
  'view': 'ViewingCond',
  'dscm': 'ProfileDescriptionML',
  'dmnd': 'DeviceMfgDesc',
  'dmdd': 'DeviceModelDesc',
  'vued': 'ViewingCondDesc',
  'scrd': 'ScreeningDescription',
  'psd0': 'PostScript2CRD0',
  'psd1': 'PostScript2CRD1',
  'psd2': 'PostScript2CRD2',
  'psd3': 'PostScript2CRD3',
  'ps2s': 'PostScript2CSA',
  'ps2i': 'PostScript2RenderingIntent',
  'ncl2': 'NamedColor2',
  'M0V1': 'M0toM1Transition',
  'M1M0': 'M1toM0Transition',
  'M2S0': 'M2toS0Transition',
  'S0M2': 'S0toM2Transition',
  'D50B': 'D50toBAdapt',
  'BFD0': 'BFDtoB0Adapt',
  'BFD1': 'BFDtoB1Adapt',
  'BFD2': 'BFDtoB2Adapt',
  'BFD3': 'BFDtoB3Adapt',
  'BFD4': 'BFDtoB4Adapt',
  'BFD5': 'BFDtoB5Adapt',
  'BFD6': 'BFDtoB6Adapt',
  'BFD7': 'BFDtoB7Adapt',
  'BFD8': 'BFDtoB8Adapt',
  'BFD9': 'BFDtoB9Adapt',
  'BFDA': 'BFDtoB10Adapt',
  'BFDB': 'BFDtoB11Adapt',
  'BFDC': 'BFDtoB12Adapt',
  'BFDD': 'BFDtoB13Adapt',
  'BFDE': 'BFDtoB14Adapt',
  'BFDF': 'BFDtoB15Adapt',
  'BA00': 'BToA0',
  'BA01': 'BToA1',
  'BA02': 'BToA2',
  'BA03': 'BToA3',
  'BA04': 'BToA4',
  'BA05': 'BToA5',
  'BA06': 'BToA6',
  'BA07': 'BToA7',
  'BA08': 'BToA8',
  'BA09': 'BToA9',
  'BA0A': 'BToA10',
  'BA0B': 'BToA11',
  'BA0C': 'BToA12',
  'BA0D': 'BToA13',
  'BA0E': 'BToA14',
  'BA0F': 'BToA15',
  'A2B0': 'AToB0',
  'A2B1': 'AToB1',
  'A2B2': 'AToB2',
  'A2B3': 'AToB3',
  'A2B4': 'AToB4',
  'A2B5': 'AToB5',
  'A2B6': 'AToB6',
  'A2B7': 'AToB7',
  'A2B8': 'AToB8',
  'A2B9': 'AToB9',
  'A2BA': 'AToB10',
  'A2BB': 'AToB11',
  'A2BC': 'AToB12',
  'A2BD': 'AToB13',
  'A2BE': 'AToB14',
  'A2BF': 'AToB15',
  'clro': 'ColorantOrder',
  'clrt': 'ColorantTable',
  'clot': 'ColorantTableOut',
  'ciis': 'ColorimetricIntentImageState',
  'pseq': 'ProfileSequenceDesc',
  'psid': 'ProfileSequenceIdentifier',
  'mmod': 'MakeAndModel',
  'MABK': 'MABk',
  'MRAK': 'MRBk',
  'MWBK': 'MWBk',
  'MDBK': 'MDBk',
  'rgbT': 'RGBToXYZ',
  'pre0': 'Preview0',
  'pre1': 'Preview1',
  'pre2': 'Preview2',
  'pre3': 'Preview3',
  'pre4': 'Preview4',
  'pre5': 'Preview5',
  'pre6': 'Preview6',
  'pre7': 'Preview7',
  'pre8': 'Preview8',
  'pre9': 'Preview9',
  'flex': 'FloatingPointMatrix',
  'flas': 'FloatingPointMatrix',
  'ri2d': 'RIColorSpace',
};
