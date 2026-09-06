[**@woss/exiftool v0.1.0**](../../README.md)

***

[@woss/exiftool](../../modules.md) / [mod](../README.md) / TagGroups

# Interface: TagGroups

Defined in: [src/types.ts:83](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/types.ts#L83)

Tag group assignments across ExifTool's family hierarchy.
Family 0: General category (EXIF, XMP, IPTC, GPS, etc.)
Family 1: Specific group (IFD0, XMP-dc, IPTC:ApplicationRecord, etc.)
Family 2: Sub-category (Image, Camera, Location, etc.)
Family 3-4: Additional groupings
Family 7: Custom/external

## Properties

### family0?

> `optional` **family0?**: `string`

Defined in: [src/types.ts:85](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/types.ts#L85)

Family 0: General category

***

### family1?

> `optional` **family1?**: `string`

Defined in: [src/types.ts:88](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/types.ts#L88)

Family 1: Specific group

***

### family2?

> `optional` **family2?**: `string`

Defined in: [src/types.ts:91](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/types.ts#L91)

Family 2: Sub-category

***

### family3?

> `optional` **family3?**: `string`

Defined in: [src/types.ts:94](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/types.ts#L94)

Family 3: Additional grouping

***

### family4?

> `optional` **family4?**: `string`

Defined in: [src/types.ts:97](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/types.ts#L97)

Family 4: Additional grouping

***

### family7?

> `optional` **family7?**: `string`

Defined in: [src/types.ts:100](https://github.com/woss/exiftool-ts/blob/6eaae3f9d9ea7a8ab482f667fdef64e0c4268e3d/src/types.ts#L100)

Family 7: Custom/external
