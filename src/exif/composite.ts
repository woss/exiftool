import type { TagValue } from '../types.js';

/**
 * Computes ExifTool's Composite tags in place, mutating the passed tag map.
 *
 * Composite tags are derived values exiftool synthesizes after all regular
 * tags are extracted (optics from FocalLength, GPS positions, date pairs,
 * file-type inferences). Every parser (JPEG/PNG/WebP/AVIF) calls this once
 * after its segment walk, BEFORE file-system metadata is overlaid — the
 * emitted set must therefore be a pure function of the parsed tags.
 *
 * Priority rules encoded here (learned from ExifTool's Composite table in
 * lib/Image/ExifTool/Exif.pm):
 *  - existing tags always win: each composite is written behind an
 *    `if (!(name in tags))` guard so explicit metadata is never overwritten;
 *  - DerivedFrom* group priority: IPTC OriginalDocumentID/InstanceID take
 *    precedence over XMP HistoryInstanceID fallbacks;
 *  - optical tags are emitted only when their scale factor is computable —
 *    exiftool omits the whole chain (ScaleFactor35efl -> CoC -> DOF/FOV/...)
 *    rather than defaulting to a 1.0 crop.
 *
 * Internal-only inputs: FocalPlane{X,Y}ResolutionRaw strings are consumed
 * here (Canon sensor-diagonal trick) and deleted before return so they never
 * reach user output.
 */
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

  // --- Optical composites -------------------------------------------------
  // ExifTool derives these from FocalLength plus whatever scale source the
  // file provides (see calcScaleFactor35efl below). Gating mirrors the
  // Require/Desire chains in Exif.pm's Composite table exactly.
  const scale = calcScaleFactor35efl(tags);

  if (focalLength && scale !== undefined) {
    // ExifTool PrintConv: scale present -> "f mm (35 mm equivalent: e mm)";
    // NO scale -> plain "f mm" (never prints a 1.0-equivalent fallback).
    const flStr = `${focalLength.toFixed(1)} mm`;
    if (!('FocalLength35efl' in tags)) {
      tags['FocalLength35efl'] = `${flStr} (35 mm equivalent: ${(focalLength * scale).toFixed(1)} mm)`;
    }
    if (!('ScaleFactor35efl' in tags)) {
      // ExifTool -j emits ScaleFactor35efl as a JSON NUMBER (1, 1.6), unlike
      // the string composites ("0.019 mm"). toFixed(1) keeps the "%.1f" shape.
      tags['ScaleFactor35efl'] = Number(scale.toFixed(1));
    }
    if (!('CircleOfConfusion' in tags)) {
      const coc = calcCircleOfConfusion(scale);
      tags['CircleOfConfusion'] = `${coc.toFixed(3)} mm`;
    }
    if (!('FOV' in tags)) {
      tags['FOV'] = `${calcFOV(focalLength, scale).toFixed(1)} deg`;
    }
    if (fnumber) {
      const coc = calcCircleOfConfusion(scale);
      if (!('HyperfocalDistance' in tags)) {
        tags['HyperfocalDistance'] = `${calcHyperfocalDistance(focalLength, fnumber, coc).toFixed(2)} m`;
      }
      // Focus-distance priority mirrors exiftool's Desire order:
      // SubjectDistance (val[4]) then ApproximateFocusDistance (val[6]).
      const dof = calcDOF(
        focalLength,
        fnumber,
        coc,
        asNum(tags['SubjectDistance']) ?? asNum(tags['ApproximateFocusDistance']),
      );
      if (dof !== undefined && !('DOF' in tags)) tags['DOF'] = dof;
    }
  }
  // Internal plumbing: the raw rational strings are never user-visible.
  delete tags['FocalPlaneXResolutionRaw'];
  delete tags['FocalPlaneYResolutionRaw'];

  if (typeof lat === 'string' && typeof lon === 'string') {
    const latClean = lat.replace(/\s+[NS]$/, '');
    const lonClean = lon.replace(/\s+[EW]$/, '');
    // The parsed refs may carry PrintConv wording ('North'); the composite
    // uses exiftool's single-letter form.
    const latDir = typeof latRef === 'string'
      ? latRef.trim().replace('North', 'N').replace('South', 'S')
      : '';
    const lonDir = typeof lonRef === 'string'
      ? lonRef.trim().replace('East', 'E').replace('West', 'W')
      : '';
    if (!('GPSPosition' in tags)) {
      tags['GPSPosition'] = `${latClean} ${latDir}, ${lonClean} ${lonDir}`;
    }
  }

  if (gpsDate && gpsTime) {
    const dt = `${gpsDate} ${gpsTime}Z`;
    if (!('GPSDateTime' in tags)) tags['GPSDateTime'] = dt;
  }

  /**
   * Builds a SubSec* datetime: "YYYY:MM:DD HH:MM:SS[.subsec][±HH:MM]".
   * The pairing (CreateDate+Digitized, DateTimeOriginal+Original,
   * ModifyDate+plain OffsetTime) follows exiftool's SubSec composite table —
   * the "Digitized" offset pairs with CreateDate even though the names
   * disagree. Subsec renders verbatim ("83" -> ".83", "00" -> ".00").
   */
  function fmtDateTime(dt: string | undefined, offset: string | undefined, subsec: string | undefined): string | undefined {
    if (!dt) return undefined;
    const parts = dt.split(' ');
    if (parts.length === 2) {
      let timePart = parts[1];
      if (subsec) timePart += `.${subsec}`;
      if (offset) timePart += offset;
      return `${parts[0]} ${timePart}`;
    }
    return dt;
  }

  const subSecCreate = fmtDateTime(createDate, offsetTimeDigitized, asStr(tags['SubSecTimeDigitized']));
  const subSecOrig = fmtDateTime(dateTimeOriginal, offsetTimeOriginal, asStr(tags['SubSecTimeOriginal']));
  const subSecMod = fmtDateTime(modifyDate, offsetTime, asStr(tags['SubSecTime']));

  // HierarchicalSubject: exiftool derives from IPTC Keywords or XMP Subject
  const kw = tags['Keywords'];
  const subj = tags['Subject'];
  const source = Array.isArray(kw) ? kw : Array.isArray(subj) ? subj : null;
  if (source && source.length > 0 && !('HierarchicalSubject' in tags)) {
    tags['HierarchicalSubject'] = source.join(',');
  }
  // DerivedFrom*: XMP UUIDs for DerivedFrom*, IPTC hex for Original*
  // DerivedFromDocumentID/InstanceID already set from XMP (stRef/xmpMM)
  // DerivedFromOriginalDocumentID = IPTC OriginalDocumentID (hex)
  if (tags['OriginalDocumentID'] && !tags['DerivedFromOriginalDocumentID']) {
    tags['DerivedFromOriginalDocumentID'] = tags['OriginalDocumentID'];
  }
  // DerivedFromInstanceID: IPTC OriginalInstanceID wins, else HistoryInstanceID fallback
  if (tags['OriginalInstanceID'] && !tags['DerivedFromInstanceID']) {
    tags['DerivedFromInstanceID'] = tags['OriginalInstanceID'];
  } else if (!tags['DerivedFromInstanceID'] && tags['HistoryInstanceID']) {
    const histIDs = tags['HistoryInstanceID'];
    const first = Array.isArray(histIDs) ? histIDs[0] : histIDs;
    if (typeof first === 'string') {
      tags['DerivedFromInstanceID'] = first;
      if (!tags['DerivedFromDocumentID']) {
        tags['DerivedFromDocumentID'] = first.replace('xmp.iid:', 'xmp.did:');
      }
    }
  }
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

  if (exposureTime && !('ShutterSpeed' in tags)) {
    if (exposureTime >= 1) {
      tags["ShutterSpeed"] = `${Number(exposureTime.toFixed(1))}`;
    } else {
      const denominator = Math.round(1 / exposureTime);
      tags['ShutterSpeed'] = `1/${denominator}`;
    }
  }

  if (!('LensID' in tags) && lensModel) {
    tags['LensID'] = lensModel;
  }


  if (!('Compression' in tags) && asStr(tags['EncodingProcess']) !== undefined) {
    tags['Compression'] = 'JPEG (old-style)';
  }
}

// ---------------------------------------------------------------------------
// Optical composites
//
// Port of the Composite entries in ExifTool's lib/Image/ExifTool/Exif.pm and
// the Canon helper in lib/Image/ExifTool/Canon.pm. Every formula below is a
// literal transcription — including ExifTool's rounding quirks — because the
// output strings must match exiftool -j byte for byte.
//
// The dependency chain is:
//   ScaleFactor35efl  <-  FocalLengthIn35mmFormat | Canon sensor diag | focal plane size
//   CircleOfConfusion <-  ScaleFactor35efl
//   FocalLength35efl / FOV / HyperfocalDistance / DOF <-  the two above
// ---------------------------------------------------------------------------

/** Diagonal of a 36x24 mm "35 mm" frame — the scale reference ExifTool uses. */
const DIAG_35MM = Math.sqrt(36 * 36 + 24 * 24); // 43.26661530556787

/**
 * Canon sensor diagonal from the RAW FocalPlaneX/YResolution rationals.
 *
 * Canon writes the rational so that the numerator is pixel width * 1000 and
 * the denominator is the sensor width in inches * 1000 (the quotient alone
 * loses the physical size — see CalcSensorDiag in Canon.pm). The diagonal in
 * mm is sqrt(denX^2 + denY^2) * 0.0254. Every bounds check below is exiftool's
 * heuristic for "these rationals really follow the Canon convention"; if any
 * fails we return undefined and the caller falls through to the focal-plane
 * estimate. Known wrong for some EOS 20D / A310 / SD40 / IXUS 65 firmware.
 *
 * Inputs are the "num/den" strings stashed by the TIFF parser
 * (FocalPlaneXResolutionRaw / FocalPlaneYResolutionRaw).
 */
export function canonSensorDiag(xRaw?: string, yRaw?: string): number | undefined {
  if (!xRaw || !yRaw) return undefined;
  const [xn, xd] = xRaw.split('/').map(Number);
  const [yn, yd] = yRaw.split('/').map(Number);
  if (!xn || !xd || !yn || !yd) return undefined;
  if (xn % 1000 !== 0 || yn % 1000 !== 0) return undefined; // numerators divisible by 1000
  if (xn < 640000 || yn < 480000) return undefined; // at least 640x480 pixels
  if (xn >= 10000000 || yn >= 10000000) return undefined; // ... but not too big
  if (xd < 61 || xd >= 1500 || yd < 61 || yd >= 1000) return undefined; // min sensor 0.061 in
  if (xd === yd) return undefined; // not square (reduced rationals break the trick)
  return Math.sqrt(xd * xd + yd * yd) * 0.0254;
}

/**
 * ScaleFactor35efl — how much longer the 35 mm-equivalent focal length is
 * (Exif.pm `CalcScaleFactor35efl`). Resolution order:
 *
 *  1. FocalLengthIn35mmFormat / FocalLength   (written by most mirrorless)
 *  2. Canon raw-rational sensor diagonal      (see canonSensorDiag)
 *  3. Focal-plane size estimate: image dims * unit mm / FocalPlaneX/YResolution
 *
 * Returns undefined when nothing is computable — exiftool then omits
 * ScaleFactor35efl AND every tag downstream of it.
 */
export function calcScaleFactor35efl(tags: Record<string, TagValue>): number | undefined {
  const focal = asNum(tags['FocalLength']);
  const foc35 = asNum(tags['FocalLengthIn35mmFormat']);
  if (focal && foc35) return foc35 / focal;

  if (tags['Make'] === 'Canon') {
    const diag = canonSensorDiag(asStr(tags['FocalPlaneXResolutionRaw']), asStr(tags['FocalPlaneYResolutionRaw']));
    if (diag !== undefined) return DIAG_35MM / diag;
  }

  // Focal-plane size from resolution + unit. ExifTool's unit table maps the
  // numeric EXIF values and their PrintConv'd strings alike; anything
  // unrecognized (including "None"/1 and the common default 2) means inches.
  const unit = tags['FocalPlaneResolutionUnit'];
  const mmPerUnit: Record<string, number> = { 3: 10, 4: 1, 5: 0.001, cm: 10, mm: 1, um: 0.001 };
  const units = mmPerUnit[String(unit)] ?? 25.4;
  const xRes = asNum(tags['FocalPlaneXResolution']);
  const yRes = asNum(tags['FocalPlaneYResolution']) ?? xRes;
  if (!xRes || !yRes) return undefined;

  // Image dimension pairs in exiftool's precedence order; the loop stops at
  // the first pair with a plausible aspect ratio (0.5 < w/h < 2).
  const pairs: Array<[string, string]> = [
    ['ExifImageWidth', 'ExifImageHeight'],
    ['ImageWidth', 'ImageHeight'],
  ];
  for (const [wKey, hKey] of pairs) {
    const w = asNum(tags[wKey]);
    const h = asNum(tags[hKey]);
    if (!w || !h) continue;
    const aspect = w / h;
    if (aspect <= 0.5 || aspect >= 2) continue;
    const diag = Math.sqrt((w * units / xRes) ** 2 + (h * units / yRes) ** 2);
    // Sanity window from Exif.pm: a real focal-plane diagonal is 1-100 mm.
    if (diag > 1 && diag < 100) return DIAG_35MM / diag;
    return undefined;
  }
  return undefined;
}

/**
 * Circle of confusion: D/1440 where D is the 35 mm-frame diagonal scaled by
 * the crop factor (Exif.pm CircleOfConfusion ValueConv). Printed "%.3f mm".
 */
export function calcCircleOfConfusion(scale: number): number {
  return DIAG_35MM / (scale * 1440);
}

/**
 * Field of view over the long image dimension, in degrees (Exif.pm FOV).
 *
 * Quirk kept deliberately: ExifTool divides by the LITERAL 3.14159, not
 * Math.PI. The difference is below the "%.1f deg" rounding threshold in most
 * cases but not all — use the same constant to stay byte-identical.
 * (FocusDistance correction ignored: we don't parse a FocusDistance composite.)
 */
export function calcFOV(focalLength: number, scale: number): number {
  const halfAngle = Math.atan2(36, 2 * focalLength * scale);
  return (halfAngle * 360) / 3.14159;
}

/**
 * Hyperfocal distance in metres: f^2 / (N * c * 1000) with f in mm, N the
 * aperture number and c the CoC in mm (Exif.pm HyperfocalDistance ValueConv).
 * Printed "%.2f m".
 */
export function calcHyperfocalDistance(focalLength: number, aperture: number, coc: number): number {
  return (focalLength * focalLength) / (aperture * coc * 1000);
}

/**
 * Depth of field string in ExifTool's exact PrintConv shape, e.g.
 * "2.53 m (2.45 - 2.62 m)". Returns undefined when the input is insufficient.
 *
 * Focus distance priority: FocusDistance -> SubjectDistance -> (we don't
 * parse ObjectDistance / ApproximateFocusDistance / FocusDistanceLower/Upper).
 * Two subtleties preserved from Exif.pm:
 *  - far < 0 means the hyperfocal sits inside the focus distance: ExifTool
 *    renders far as 0 and the PrintConv turns that into "inf";
 *  - the depth uses THREE decimals when it is under 0.02 m (macro shots print
 *    "0.001 m (0.300 - 0.300 m)" instead of collapsing to "0.00").
 */
export function calcDOF(
  focalLength: number,
  aperture: number,
  coc: number,
  subjectDistanceMetres: number | undefined,
): string | undefined {
  const d = subjectDistanceMetres;
  if (d === undefined || !focalLength || !coc || !aperture) return undefined;
  const dMm = d * 1000;
  const t = (aperture * coc * (dMm - focalLength)) / (focalLength * focalLength);
  const near = dMm / (1 + t) / 1000;
  let far = dMm / (1 - t) / 1000;
  if (far < 0) far = 0; // 0 renders as 'inf' below
  const dof = far - near;
  const fmt = (v: number): string => v.toFixed(dof > 0 && dof < 0.02 ? 3 : 2);
  if (far === 0) return `inf (${near.toFixed(2)} m - inf)`;
  return `${fmt(dof)} m (${fmt(near)} - ${fmt(far)} m)`;
}

/**
 * Coerces a tag value to a number. Two string shapes appear in practice:
 *  - EXIF aperture/shutter PrintConv leftovers like "1/8000" (reciprocal);
 *  - plain numeric strings ("2.8", "100.0 mm" — parseFloat stops at the unit).
 * Returns undefined for anything else; callers treat that as "tag absent".
 */
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

/** String-only view of a tag; used where formatting (not math) matters. */
function asStr(v: TagValue): string | undefined {
  if (typeof v === 'string') return v;
  return undefined;
}
