import type { TagValue } from '../types.js';

function renameContextProperties(xml: string): string {
  let r = xml;
  r = r.replace(/<crs:Look[\s\S]*?<\/crs:Look>/g, (m) => {
    let s = m;
    s = s.replace(/\bcrs:Version\b/g, 'crs:LookVersion');
    s = s.replace(/\bcrs:ProcessVersion\b/g, 'crs:LookProcessVersion');
    s = s.replace(/\bcrs:ConvertToGrayscale\b/g, 'crs:LookConvertToGrayscale');
    s = s.replace(/\bcrs:CameraProfile\b/g, 'crs:LookCameraProfile');
    s = s.replace(/\bcrs:LookTable\b/g, 'crs:LookLookTable');
    s = s.replace(/\bcrs:ToneCurvePV2012\b(?!Blue|Green|Red)/g, 'crs:LookToneCurvePV2012');
    s = s.replace(/\bcrs:ToneCurvePV2012Blue\b/g, 'crs:LookToneCurvePV2012Blue');
    s = s.replace(/\bcrs:ToneCurvePV2012Green\b/g, 'crs:LookToneCurvePV2012Green');
    s = s.replace(/\bcrs:ToneCurvePV2012Red\b/g, 'crs:LookToneCurvePV2012Red');
    return s;
  });
  r = r.replace(/<crs:CorrectionMasks[\s\S]*?<\/crs:CorrectionMasks>/g, (m) => {
    let s = m;
    s = s.replace(/\bcrs:Version\b/g, 'crs:MaskVersion');
    s = s.replace(/\bcrs:What\b/g, 'crs:MaskWhat');
    return s;
  });

  return r;
}

export function parseXMP(_xml: string): Record<string, TagValue> {
  const xml = renameContextProperties(_xml);
  const result: Record<string, TagValue> = {};

  const TAG_REMAP: Record<string, string> = {
    'dc:creator': 'Creator',
    'dc:description': 'Description',
    'dc:format': 'Format',
    'dc:rights': 'Rights',
    'dc:subject': 'Subject',
    'dc:title': 'Title',
    'exif:ApertureValue': 'ApertureValue',
    'exif:BrightnessValue': 'BrightnessValue',
    'exif:ColorSpace': 'ColorSpace',
    'exif:CustomRendered': 'CustomRendered',
    'exif:DateTimeDigitized': 'CreateDate',
    'exif:DateTimeOriginal': 'DateTimeOriginal',
    'exif:DigitalZoomRatio': 'DigitalZoomRatio',
    'exif:ExifVersion': 'ExifVersion',
    'exif:ExposureCompensation': 'ExposureCompensation',
    'exif:ExposureMode': 'ExposureMode',
    'exif:ExposureProgram': 'ExposureProgram',
    'exif:ExposureTime': 'ExposureTime',
    'exif:FNumber': 'FNumber',
    'exif:FileSource': 'FileSource',
    'exif:Flash': 'Flash',
    'exif:FocalLength': 'FocalLength',
    'exif:FocalLengthIn35mmFilm': 'FocalLengthIn35mmFormat',
    'exif:FocalPlaneResolutionUnit': 'FocalPlaneResolutionUnit',
    'exif:FocalPlaneXResolution': 'FocalPlaneXResolution',
    'exif:FocalPlaneYResolution': 'FocalPlaneYResolution',
    'exif:GPSVersionID': 'GPSVersionID',
    'exif:ISOSpeedRatings': 'ISO',
    'exif:LightSource': 'LightSource',
    'exif:MaxApertureValue': 'MaxApertureValue',
    'exif:MeteringMode': 'MeteringMode',
    'exif:RecommendedExposureIndex': 'RecommendedExposureIndex',
    'exif:Saturation': 'Saturation',
    'exif:SceneCaptureType': 'SceneCaptureType',
    'exif:SceneType': 'SceneType',
    'exif:SensitivityType': 'SensitivityType',
    'exif:Sharpness': 'Sharpness',
    'exif:ShutterSpeedValue': 'ShutterSpeedValue',
    'exif:WhiteBalance': 'WhiteBalance',
    'tiff:Artist': 'Artist',
    'tiff:Copyright': 'Copyright',
    'tiff:DateTime': 'ModifyDate',
    'tiff:ImageDescription': 'ImageDescription',
    'tiff:Make': 'Make',
    'tiff:Model': 'Model',
    'tiff:Orientation': 'Orientation',
    'tiff:ResolutionUnit': 'ResolutionUnit',
    'tiff:Software': 'Software',
    'tiff:XResolution': 'XResolution',
    'tiff:YResolution': 'YResolution',
    'tiff:ImageWidth': 'ImageWidth',
    'tiff:ImageLength': 'ImageHeight',
    'tiff:BitsPerSample': 'BitsPerSample',
    'tiff:Compression': 'Compression',
    'xmp:CreateDate': 'CreateDate',
    'xmp:CreatorTool': 'CreatorTool',
    'xmp:MetadataDate': 'MetadataDate',
    'xmp:ModifyDate': 'ModifyDate',
    'xmp:Rating': 'Rating',
    'xmpMM:DocumentID': 'DocumentID',
    'xmpMM:InstanceID': 'InstanceID',
    'xmpMM:OriginalDocumentID': 'OriginalDocumentID',
    'xmpRights:Marked': 'Marked',
    'xmpRights:WebStatement': 'WebStatement',
    'xmpRights:UsageTerms': 'UsageTerms',
    'photoshop:DateCreated': 'DateCreated',
    'photoshop:CaptionWriter': 'CaptionWriter',
    'photoshop:DisplayedUnitsX': 'DisplayedUnitsX',
    'photoshop:DisplayedUnitsY': 'DisplayedUnitsY',
    'Iptc4xmpCore:CreatorContactInfo': 'CreatorContactInfo',
    'plus:CopyrightOwner': 'CopyrightOwnerName',
    'plus:Version': 'PLUSVersion',
    'crs:Name': 'LookName',
    'crs:Amount': 'LookAmount',
    'crs:UUID': 'LookUUID',
    'crs:Group': 'LookGroup',
    'crs:SupportsAmount': 'LookSupportsAmount',
    'crs:SupportsMonochrome': 'LookSupportsMonochrome',
    'crs:SupportsOutputReferred': 'LookSupportsOutputReferred',
    'crs:CameraProfile': 'CameraProfile',
    'crs:Version': 'Version',
    'crs:ProcessVersion': 'ProcessVersion',
    'crs:ConvertToGrayscale': 'ConvertToGrayscale',
    'crs:LookTable': 'LookTable',
    'crs:Clarity2012': 'Clarity2012',
    'crs:Texture': 'Texture',
    'crs:Temperature': 'ColorTemperature',
    'crs:CorrectionName': 'MaskGroupBasedCorrCorrectionName',
    'crs:CorrectionAmount': 'MaskGroupBasedCorrAmount',
    'crs:CorrectionActive': 'MaskGroupBasedCorrActive',
    'crs:CorrectionSyncID': 'MaskGroupBasedCorrCorrectionSyncID',
    'crs:What': 'MaskGroupBasedCorrWhat',
    'crs:MaskWhat': 'MaskGroupBasedCorrMaskWhat',
    'crs:LocalBlacks2012': 'MaskGroupBasedCorrBlacks2012',
    'crs:LocalBrightness': 'MaskGroupBasedCorrBrightness',
    'crs:LocalClarity': 'MaskGroupBasedCorrClarity',
    'crs:LocalClarity2012': 'MaskGroupBasedCorrClarity2012',
    'crs:LocalContrast': 'MaskGroupBasedCorrContrast',
    'crs:LocalContrast2012': 'MaskGroupBasedCorrContrast2012',
    'crs:LocalCurveRefineSaturation': 'MaskGroupBasedCorrLocalCurveRefineSaturation',
    'crs:LocalDefringe': 'MaskGroupBasedCorrDefringe',
    'crs:LocalDehaze': 'MaskGroupBasedCorrDehaze',
    'crs:LocalExposure': 'MaskGroupBasedCorrExposure',
    'crs:LocalExposure2012': 'MaskGroupBasedCorrExposure2012',
    'crs:LocalGrain': 'MaskGroupBasedCorrLocalGrain',
    'crs:LocalHighlights2012': 'MaskGroupBasedCorrHighlights2012',
    'crs:LocalHue': 'MaskGroupBasedCorrHue',
    'crs:LocalLuminanceNoise': 'MaskGroupBasedCorrLuminanceNoise',
    'crs:LocalMoire': 'MaskGroupBasedCorrMoire',
    'crs:LocalSaturation': 'MaskGroupBasedCorrSaturation',
    'crs:LocalShadows2012': 'MaskGroupBasedCorrShadows2012',
    'crs:LocalSharpness': 'MaskGroupBasedCorrSharpness',
    'crs:LocalTemperature': 'MaskGroupBasedCorrTemperature',
    'crs:LocalTexture': 'MaskGroupBasedCorrTexture',
    'crs:LocalTint': 'MaskGroupBasedCorrTint',
    'crs:LocalToningHue': 'MaskGroupBasedCorrToningHue',
    'crs:LocalToningSaturation': 'MaskGroupBasedCorrToningSaturation',
    'crs:LocalWhites2012': 'MaskGroupBasedCorrWhites2012',
    'crs:MaskActive': 'MaskGroupBasedCorrMaskMaskActive',
    'crs:MaskBlendMode': 'MaskGroupBasedCorrMaskMaskBlendMode',
    'crs:MaskInverted': 'MaskGroupBasedCorrMaskMaskInverted',
    'crs:MaskName': 'MaskGroupBasedCorrMaskMaskName',
    'crs:MaskSyncID': 'MaskGroupBasedCorrMaskMaskSyncID',
    'crs:MaskValue': 'MaskGroupBasedCorrMaskValue',
    'crs:Top': 'MaskGroupBasedCorrMaskTop',
    'crs:Left': 'MaskGroupBasedCorrMaskLeft',
    'crs:Bottom': 'MaskGroupBasedCorrMaskBottom',
    'crs:Right': 'MaskGroupBasedCorrMaskRight',
    'crs:Angle': 'MaskGroupBasedCorrMaskAngle',
    'crs:Flipped': 'MaskGroupBasedCorrMaskFlipped',
    'crs:Feather': 'MaskGroupBasedCorrMaskFeather',
    'crs:Midpoint': 'MaskGroupBasedCorrMaskMidpoint',
    'crs:Roundness': 'MaskGroupBasedCorrMaskRoundness',
    'crs:X': 'MaskGroupBasedCorrMaskX',
    'crs:Y': 'MaskGroupBasedCorrMaskY',
    'crs:Radius': 'MaskGroupBasedCorrMaskRadius',
    'crs:FullX': 'MaskGroupBasedCorrMaskFullX',
    'crs:FullY': 'MaskGroupBasedCorrMaskFullY',
    'crs:MaskVersion': 'MaskGroupBasedCorrMaskVersion',
    'crs:LookVersion': 'LookParametersVersion',
    'crs:LookProcessVersion': 'LookParametersProcessVersion',
    'crs:LookConvertToGrayscale': 'LookParametersConvertToGrayscale',
    'crs:LookCameraProfile': 'LookParametersCameraProfile',
    'crs:LookLookTable': 'LookParametersLookTable',
    'crs:LookToneCurvePV2012': 'LookParametersToneCurvePV2012',
    'crs:LookToneCurvePV2012Blue': 'LookParametersToneCurvePV2012Blue',
    'crs:LookToneCurvePV2012Green': 'LookParametersToneCurvePV2012Green',
    'crs:LookToneCurvePV2012Red': 'LookParametersToneCurvePV2012Red',
    'xmpDM:pick': 'Pick',
    'crs:weightedFlatSubject': 'WeightedFlatSubject',
    'lr:weightedFlatSubject': 'WeightedFlatSubject',
    'stRef:documentID': 'DerivedFromDocumentID',
    'stRef:instanceID': 'DerivedFromInstanceID',
    'stRef:originalDocumentID': 'DerivedFromOriginalDocumentID',
    'stEvt:action': 'HistoryAction',
    'stEvt:changed': 'HistoryChanged',
    'stEvt:instanceID': 'HistoryInstanceID',
    'stEvt:parameters': 'HistoryParameters',
    'stEvt:softwareAgent': 'HistorySoftwareAgent',
    'stEvt:when': 'HistoryWhen',
  };

  function lookupPrefix(attrName: string): { prefix: string; local: string } {
    const colonIdx = attrName.indexOf(':');
    return { prefix: attrName.slice(0, colonIdx), local: attrName.slice(colonIdx + 1) };
  }

  function mapTagName(prefix: string, local: string): string {
    const fullKey = `${prefix}:${local}`;
    if (TAG_REMAP[fullKey]) return TAG_REMAP[fullKey];
    return local;
  }

  const docPattern = /<rdf:Description[^>]*>([\s\S]*?)<\/rdf:Description>/g;
  let docMatch: RegExpExecArray | null;
  while ((docMatch = docPattern.exec(xml)) !== null) {
    const openTag = docMatch[0].slice(0, docMatch[0].indexOf('>') + 1);
    const attrPattern = /(\w+:\w+)\s*=\s*"([^"]*)"/g;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrPattern.exec(openTag)) !== null) {
      const [_, fullName, value] = attrMatch;
      if (fullName.startsWith('xmlns:')) continue;
      if (fullName.startsWith('rdf:')) continue;
      if (fullName.startsWith('x:')) continue;

      const parsed = lookupPrefix(fullName);
      const tagName = mapTagName(parsed.prefix, parsed.local);
      const cleanValue = value.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
        String.fromCodePoint(parseInt(hex, 16))
      );
      result[tagName] = cleanValue;
    }

    const childContent = docMatch[1];
    const listPattern = /<(\w+:\w+)[^>]*>[\s\S]*?<\/\1>/g;
    let listMatch: RegExpExecArray | null;
    while ((listMatch = listPattern.exec(childContent)) !== null) {
      const [childXml, childName] = listMatch;
      const parsed = lookupPrefix(childName);
      if (parsed.prefix === 'rdf') continue;

      const tagName = mapTagName(parsed.prefix, parsed.local);

      const textContent = childXml.replace(/<[^>]*>/g, '').trim();

      const liPattern = /<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/g;
      const items: string[] = [];
      let liMatch: RegExpExecArray | null;
      while ((liMatch = liPattern.exec(childXml)) !== null) {
        items.push(liMatch[1].trim());
      }

      if (items.length > 0) {
        const langAlt: Record<string, string> = {};
        const xmlLangPattern = /<rdf:li\s+xml:lang="([^"]*)"\s*>([\s\S]*?)<\/rdf:li>/g;
        let langMatch: RegExpExecArray | null;
        let hasLang = false;
        while ((langMatch = xmlLangPattern.exec(childXml)) !== null) {
          langAlt[langMatch[1]] = langMatch[2].trim();
          hasLang = true;
        }
        if (hasLang) {
          const defaultVal = langAlt['x-default'] ?? Object.values(langAlt)[0];
          if (defaultVal) result[tagName] = defaultVal;
        } else {
          if (items.length === 1) {
            result[tagName] = items[0];
          } else {
            const existing = result[tagName];
            if (existing) {
              const existingArr = Array.isArray(existing) ? existing : [existing];
              result[tagName] = [...existingArr, ...items];
            } else {
              result[tagName] = items;
            }
          }
        }
      }
    }
  }

  const structPattern = /<rdf:Description\s+([^>]*)\/>/g;
  let structMatch: RegExpExecArray | null;
  while ((structMatch = structPattern.exec(xml)) !== null) {
    const attrPattern2 = /(\w+:\w+)\s*=\s*"([^"]*)"/g;
    let attrMatch2: RegExpExecArray | null;
    while ((attrMatch2 = attrPattern2.exec(structMatch[1])) !== null) {
      const [_, fullName, value] = attrMatch2;
      if (fullName.startsWith('rdf:')) continue;

      const parsed = lookupPrefix(fullName);
      const tagName = mapTagName(parsed.prefix, parsed.local);

      const existing = result[tagName];
      if (tagName.startsWith('History') || tagName === 'WeightedFlatSubject') {
        if (existing) {
          const arr = Array.isArray(existing) ? existing : [existing];
          arr.push(value);
          result[tagName] = arr;
        } else {
          result[tagName] = value;
        }
      } else {
        result[tagName] = value;
      }
    }
  }

  const allDescPattern = /<rdf:Description\s+([^>]*?)>/g;
  let allDescMatch: RegExpExecArray | null;
  while ((allDescMatch = allDescPattern.exec(xml)) !== null) {
    const attrPatternDesc = /(\w+:\w+)\s*=\s*"([^"]*)"/g;
    let attrDescMatch: RegExpExecArray | null;
    while ((attrDescMatch = attrPatternDesc.exec(allDescMatch[1])) !== null) {
      const [_, fullName, value] = attrDescMatch;
      if (fullName.startsWith('xmlns:')) continue;
      if (fullName.startsWith('rdf:')) continue;
      if (fullName.startsWith('x:')) continue;
      const parsed = lookupPrefix(fullName);
      const tagName = mapTagName(parsed.prefix, parsed.local);
      if (!tagName.startsWith('rdf:')) {
        result[tagName] = value;
      }
    }
  }

  const liAttrPattern = /<rdf:li\s+([^>]*?)\/>/g;
  let liMatch: RegExpExecArray | null;
  while ((liMatch = liAttrPattern.exec(xml)) !== null) {
    const attrPattern3 = /(\w+:\w+)\s*=\s*"([^"]*)"/g;
    let attrMatch3: RegExpExecArray | null;
    while ((attrMatch3 = attrPattern3.exec(liMatch[1])) !== null) {
      const [_, fullName, value] = attrMatch3;
      if (fullName.startsWith('rdf:')) continue;
      const parsed = lookupPrefix(fullName);
      const tagName = mapTagName(parsed.prefix, parsed.local);

      const existing = result[tagName];
      if (existing) {
        const arr = Array.isArray(existing) ? existing : [existing];
        arr.push(value);
        result[tagName] = arr;
      } else {
        result[tagName] = value;
      }
    }
  }

  const childElPattern = /<(\w+:\w+)\b[^>]*>([^<]+)<\/\1>/g;
  let childElMatch: RegExpExecArray | null;
  while ((childElMatch = childElPattern.exec(xml)) !== null) {
    const [_, fullName, value] = childElMatch;
    if (fullName.startsWith('rdf:')) continue;
    const parsed = lookupPrefix(fullName);
    const tagName = mapTagName(parsed.prefix, parsed.local);
    if (!tagName.startsWith('rdf:')) {
      const existing = result[tagName];
      if (tagName.startsWith('History') || tagName.startsWith('DerivedFrom') || tagName.endsWith('CorrWhat')) {
        if (existing) {
          const arr = Array.isArray(existing) ? existing : [existing];
          arr.push(value);
          result[tagName] = arr;
        } else {
          result[tagName] = value;
        }
      } else {
        result[tagName] = value;
      }
    }
  }

  const xmptkMatch = /x:xmptk="([^"]+)"/.exec(xml);
  if (xmptkMatch) result['XMPToolkit'] = xmptkMatch[1];

  if ('WebStatement' in result) result['URL'] = result['WebStatement'];
  if ('Marked' in result) result['CopyrightFlag'] = result['Marked'] === 'True';
  if ('Rights' in result) result['CopyrightNotice'] = result['Rights'];
  if ('Version' in result) result['Version'] = Number(result['Version']);
  if ('Pick' in result) result['Pick'] = Number(result['Pick']);
  if ('ExifToolVersion' in result) result['ExifToolVersion'] = Number(result['ExifToolVersion']);

  for (const key of Object.keys(result)) {
    if (key === 'XMP' || key === 'action' || key === 'changed' || key === 'instanceID' || key === 'parameters' || key === 'softwareAgent' || key === 'when' || key === 'lang' || key === 'pick' || key === 'Parameters' || key === 'Look') {
      delete result[key];
    }
  }

  // ExifTool prints XMP booleans lowercase, trims numeric tails and
  // renders ISO dates in EXIF style; normalize to match.
  for (const [k, v] of Object.entries(result)) {
    if (typeof v === 'string') {
      if (v === 'True' || v === 'False') {
        result[k] = v.toLowerCase();
      } else if (/^-?\d+\.\d+$/.test(v)) {
        result[k] = String(Number(v));
      } else if (/^\d{4}-\d{2}-\d{2}T[0-9:+.-]+$/.test(v)) {
        result[k] = v.replace(/^([\d-]+)T/, (_, d) => d.replaceAll('-', ':') + ' ');
      }
    } else if (Array.isArray(v)) {
      result[k] = v.map((item) =>
        typeof item === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(item)
          ? item.replace(/^([\d-]+)T/, (_, d) => d.replaceAll('-', ':') + ' ')
          : item,
      );
    }
  }
  return result;
}
