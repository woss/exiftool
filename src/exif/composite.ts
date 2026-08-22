import type { TagValue } from '../types.ts';

export function computeCompositeTags(tags: Record<string, TagValue>): void {
  const imageWidth = asNum(tags['ImageWidth']);
  const imageHeight = asNum(tags['ImageHeight']) || asNum(tags['ImageLength']);
  if (imageHeight && !('ImageLength' in tags)) {
    tags['ImageLength'] = imageHeight;
  }
  const fnumber = asNum(tags['FNumber']);
  const exposureTime = asNum(tags['ExposureTime']);
  const iso = asNum(tags['ISO']);
  const focalLength = asNum(tags['FocalLength']);
  const focalLength35 = asNum(tags['FocalLengthIn35mmFormat']);
  const lat = tags['GPSLatitude'];
  const lon = tags['GPSLongitude'];
  const latRef = tags['GPSLatitudeRef'];
  const lonRef = tags['GPSLongitudeRef'];
  const gpsDate = asStr(tags['GPSDateStamp']);
  const gpsTime = asStr(tags['GPSTimeStamp']);
  const lensModel = asStr(tags['LensModel']);
  const createDate = asStr(tags['CreateDate']);
  const dateTimeOriginal = asStr(tags['DateTimeOriginal']);
  const modifyDate = asStr(tags['ModifyDate']);
  const offsetTime = asStr(tags['OffsetTime']);
  const offsetTimeOriginal = asStr(tags['OffsetTimeOriginal']);
  const offsetTimeDigitized = asStr(tags['OffsetTimeDigitized']);
  const shutterSpeedValue = asNum(tags['ShutterSpeedValue']);

  if (imageWidth && imageHeight) {
    const mp = Math.round(imageWidth * imageHeight / 100000) / 10;
    if (!('Megapixels' in tags)) tags['Megapixels'] = mp;
  }

  if (fnumber && !('Aperture' in tags)) {
    tags['Aperture'] = fnumber;
  }

  if (focalLength) {
    const flStr = `${focalLength.toFixed(1).replace(/\.0$/, '')}.0 mm`;
    if (focalLength35) {
      const fl35Str = `${focalLength35.toFixed(0).replace(/\.0$/, '')} mm`;
      if (!('FocalLength35efl' in tags)) {
        tags['FocalLength35efl'] = `${flStr} (35 mm equivalent: ${fl35Str})`;
      }
    }
  }

  if (typeof lat === 'string' && typeof lon === 'string') {
    const latClean = lat.replace(/\s+[NS]$/, '');
    const lonClean = lon.replace(/\s+[EW]$/, '');
    const latDir = typeof latRef === 'string' ? latRef.trim() : '';
    const lonDir = typeof lonRef === 'string' ? lonRef.trim() : '';
    if (!('GPSPosition' in tags)) {
      tags['GPSPosition'] = `${latClean} ${latDir}, ${lonClean} ${lonDir}`;
    }
  }

  if (gpsDate && gpsTime) {
    const dt = `${gpsDate} ${gpsTime}Z`;
    if (!('GPSDateTime' in tags)) tags['GPSDateTime'] = dt;
  }

  function fmtDateTime(dt: string | undefined, offset: string | undefined): string | undefined {
    if (!dt) return undefined;
    const parts = dt.split(' ');
    if (parts.length === 2) {
      if (offset) return `${parts[0]} ${parts[1]}${offset}`;
      return `${parts[0]} ${parts[1]}`;
    }
    return dt;
  }

  const subSecCreate = fmtDateTime(createDate, offsetTimeDigitized);
  const subSecOrig = fmtDateTime(dateTimeOriginal, offsetTimeOriginal);
  const subSecMod = fmtDateTime(modifyDate, offsetTime);

  if (subSecCreate && !('SubSecCreateDate' in tags)) tags['SubSecCreateDate'] = subSecCreate;
  if (subSecOrig && !('SubSecDateTimeOriginal' in tags)) tags['SubSecDateTimeOriginal'] = subSecOrig;
  if (subSecMod && !('SubSecModifyDate' in tags)) tags['SubSecModifyDate'] = subSecMod;

  if (lensModel && !('Lens' in tags)) {
    tags['Lens'] = lensModel;
  }

  if (focalLength && fnumber && exposureTime) {
    const ev100 = Math.log(fnumber * fnumber / exposureTime * 100 / (iso || 100)) / Math.LN2;
    const lv = Math.round(ev100 * 10) / 10;
    if (!('LightValue' in tags)) tags['LightValue'] = lv;
  }

  if (imageWidth && imageHeight && !('ImageSize' in tags)) {
    tags['ImageSize'] = `${imageWidth}x${imageHeight}`;
  }

  if (imageWidth && imageHeight && !('ImageHeight' in tags)) {
    tags['ImageHeight'] = imageHeight;
  }

  if (imageWidth && !('ImageHeight' in tags) && tags['ImageLength']) {
    tags['ImageHeight'] = tags['ImageLength'];
  }

  const scale = focalLength35 && focalLength ? focalLength35 / focalLength : 1;
  if (scale >= 1 && !('ScaleFactor35efl' in tags)) {
    tags['ScaleFactor35efl'] = Math.round(scale * 10) / 10;
  }

  if (exposureTime && !('ShutterSpeed' in tags)) {
    if (exposureTime >= 1) {
      tags['ShutterSpeed'] = `${exposureTime}s`;
    } else {
      const denominator = Math.round(1 / exposureTime);
      tags['ShutterSpeed'] = `1/${denominator}`;
    }
  }

  if (!('LensID' in tags) && lensModel) {
    tags['LensID'] = lensModel;
  }

  if (focalLength && focalLength35) {
    const ccdWidth = 36 * focalLength / focalLength35;
    const coc = 0.030;
    if (!('CircleOfConfusion' in tags)) {
      tags['CircleOfConfusion'] = `${coc.toFixed(3)} mm`;
    }
    if (fnumber && !('HyperfocalDistance' in tags)) {
      const hfd = focalLength * focalLength / (fnumber * coc) / 1000;
      tags['HyperfocalDistance'] = `${hfd.toFixed(2)} m`;
    }
    if (!('FOV' in tags)) {
      const fov = 2 * Math.atan(ccdWidth / (2 * focalLength));
      const fovDeg = fov * 180 / Math.PI;
      tags['FOV'] = `${fovDeg.toFixed(1)} deg`;
    }
  }

  if (!('Compression' in tags) && asStr(tags['EncodingProcess']) !== undefined) {
    tags['Compression'] = 'JPEG (old-style)';
  }
}

function asNum(v: TagValue): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const match = v.match(/^1\/(\d+)$/);
    if (match) return 1 / parseInt(match[1]);
    const n = parseFloat(v);
    return isNaN(n) ? undefined : n;
  }
  return undefined;
}

function asStr(v: TagValue): string | undefined {
  if (typeof v === 'string') return v;
  return undefined;
}
