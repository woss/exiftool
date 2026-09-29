import type { ContainerWriter } from '../types.js';
import { classifyTiffRaw } from '../format/tiff-raw.js';
import { mergeExifTiff, parseRawTiff, resolveMergeRequests, type ExifRequest } from './jpeg-merge.js';
import { writeXmpPacket } from './xmp-writer.js';
import { UnsupportedFormatError } from './writers.js';

/**
 * TIFF/DNG merge writer.
 *
 * Writing is intentionally restricted to plain TIFF and DNG: camera RAW
 * files (CR2, NEF, ARW, ORF, RAF, RW2, …) are provenance material and are
 * never rewritten — consumers must use `.xmp` sidecars for those.
 *
 * EXIF tags are structurally merged into the IFD chain (untouched entry
 * values copied verbatim). XMP lives in the IFD0 XMP tag (0xBC01, type
 * UNDEFINED/BYTE): the packet is spliced/created by the generalized XMP
 * writer. IPTC into TIFF (IFD0 IPTC-NAA 0x83BB) is not yet written.
 */

const XMP_TAG_SPEC = { id: 0xbc01, type: 7 as const, name: 'XMP' };

export const tiffMergeWriter: ContainerWriter = (original, tags) => {
  if (original.length < 8) throw new UnsupportedFormatError('not a TIFF stream');
  const magic = original[0] | (original[1] << 8);
  if (magic !== 0x4949 && magic !== 0x4d4d) {
    throw new UnsupportedFormatError('not a TIFF stream');
  }
  const isLE = original[0] === 0x49;
  const version = isLE ? original[2] | (original[3] << 8) : (original[3] << 8) | original[2];
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
    written: [...written, ...merged.written.filter((w) => w !== 'XMP')],
    skipped: [...skipped, ...merged.skipped.filter((s) => s !== 'XMP')],
  };
};
