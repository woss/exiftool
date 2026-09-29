import type { ContainerWriter } from '../types.js';
import { classifyTiffRaw } from '../format/tiff-raw.js';
import { mergeExifTiff, parseRawTiff, resolveMergeRequests, type ExifRequest } from './jpeg-merge.js';
import { writeXmpPacket } from './xmp-writer.js';
import { UnsupportedFormatError } from './writers.js';

/**
 * TIFF merge writer.
 *
 * EXIF tags are structurally merged into the IFD chain (untouched entry
 * values copied verbatim). XMP lives in the IFD0 XMP/XMLPacket tag
 * (0x02BC, type UNDEFINED/BYTE): the packet is spliced/created by the
 * generalized XMP writer. IPTC into TIFF (IFD0 IPTC-NAA 0x83BB) is not
 * yet written.
 *
 * Writing is intentionally restricted to plain TIFF files:
 * - Camera RAW (CR2, NEF, ARW, ORF, RAF, RW2, …) is provenance material
 *   and is never rewritten in place — consumers must use `.xmp` sidecars.
 * - Files with SubIFDs (0x014A: DNG raw images, TIFF previews/tiles) are
 *   refused too: their image data is reachable only through numeric
 *   offsets the IFD-chain merge cannot preserve.
 * Lightroom reads `.xmp` sidecars for RAW/DNG, so this does not block the
 * Kelp desktop flow.
 */

const XMP_TAG_SPEC = { id: 0x02bc, type: 7 as const, name: 'XMP' };

export const tiffMergeWriter: ContainerWriter = (original, tags) => {
  if (original.length < 8) throw new UnsupportedFormatError('not a TIFF stream');
  const magic = original[0] | (original[1] << 8);
  if (magic !== 0x4949 && magic !== 0x4d4d) {
    throw new UnsupportedFormatError('not a TIFF stream');
  }
  const isLE = original[0] === 0x49;
  const version = isLE ? original[2] | (original[3] << 8) : (original[2] << 8) | original[3];
  if (version !== 42) {
    throw new UnsupportedFormatError('not a TIFF stream');
  }
  const classified = classifyTiffRaw(original, false);
  if (classified !== 'TIFF' && classified !== 'DNG') {
    throw new UnsupportedFormatError(
      `${classified} files are never rewritten in place (provenance); use an .xmp sidecar`,
    );
  }
  const raw = parseRawTiff(original);
  if (!raw) throw new UnsupportedFormatError('malformed TIFF structure');
  // Files with SubIFDs (0x014A — DNG raw images, TIFF previews/tiles) carry
  // image data reachable only through numeric offsets inside those sub-IFDs;
  // the structural merge preserves IFD chains, not arbitrary pointee data.
  // Rewriting them would corrupt the image payload, so they are refused.
  if (raw.ifd0.entries.some((e) => e.tag === 0x014a)) {
    throw new UnsupportedFormatError(
      `${classified} files with SubIFDs (raw image data) are never rewritten in place; use an .xmp sidecar`,
    );
  }

  const reqs = resolveMergeRequests(tags);
  const written: string[] = [];
  const skipped: string[] = [...reqs.skipped];

  // Existing XMP packet from the IFD0 XMP tag, if present.
  let existingXmp: string | null = null;
  const xmpEntry = raw.ifd0.entries.find((e) => e.tag === XMP_TAG_SPEC.id);
  if (xmpEntry?.data) {
    existingXmp = new TextDecoder().decode(xmpEntry.data);
  }

  const exifReqs: ExifRequest[] = [...reqs.exif];
  if (reqs.xmp.length > 0) {
    const packet = writeXmpPacket(existingXmp, reqs.xmp);
    exifReqs.push({ key: 'XMP', spec: XMP_TAG_SPEC, value: packet, home: 0 });
    written.push(...reqs.xmpKeys);
  }

  if (exifReqs.length === 0) {
    return { bytes: original, written, skipped };
  }
  const merged = mergeExifTiff(original, exifReqs);
  return {
    bytes: merged.bytes,
    // 'XMP' is the container key, not a user-facing written tag.
    written: [...written, ...merged.written.filter((w) => w !== 'XMP')],
    skipped: [...skipped, ...merged.skipped],
  };
};
