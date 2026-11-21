# XMP serializer + schema catalog spec (§D)

Upstream source: 13.64 `XMP.pm` namespace tables + generated
`src/tags/generated/xmp-namespaces.json`, `xmp-shapes.json`, `xmp-structs.json`.
Code: `src/write/xmp-writer.ts`, `src/exif/xmp.ts`.

## Scope

- All upstream XMP namespace URIs + property names/types/writable flags/enums/
  struct definitions, canonical URI→prefix map. URI provenance pinned to the
  catalog hash in `manifest.json`.
- RDF shapes: scalar, `rdf:Bag`/`rdf:Seq`/`rdf:Alt`, language alternatives
  (`x-default` first), qualified `rdf:parseType="Resource"` structs, nested
  structs and struct lists (schema-checked child names), `xml:lang`.
- Value conversion: enum label→storage (exact/unambiguous-prefix, `#` raw),
  date normalization to ISO 8601, numeric/string-coded enums, list split/join.

## Invariants

- Upsert/delete across sibling `rdf:Description` elements **without discarding
  unrelated descriptions or unknown properties**; nested Camera Raw
  descriptions untouched. Attribute vs element representation must not
  duplicate a property.
- Preserve packet wrapper, PIs, xpacket padding, unknown props byte-for-byte.
- XML CDATA/comment parse + header behavior per 13.58/13.57 (delta §B/D):
  verify write round-trip against 13.64 reference.
- 13.59: data-loss write problems are **errors, not warnings** — surface them.

## Operations

create / set / append / remove / delete per property; empty-structure cleanup
removes the packet; standalone XMP writes reject an empty document; JPEG
Extended XMP split/reassemble with MD5 GUID validation.

## Test vectors

`src/write/xmp-writer.test.ts` (each RDF shape, namespace, group routing,
upsert/delete) + ExifTool 13.64 semantic readback of our output and of
upstream output. Gate: generated-schema completeness report has no unexplained
writable property; `?` types stay explicit in the manifest.

## Exit gate

Each RDF shape + each writable family promoted per matrix cell
(`*/XMP|set|delete`), never by "XMP supported" blanket claim.
