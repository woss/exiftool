---
sidebar_position: 2
slug: /c2pa/jumbf-structure
---

# JUMBF Box Structure

Detailed reference for the JUMBF (JPEG Universal Metadata Box Format) structure used by C2PA.

## Box Hierarchy

```
JPEG APP11 Segment
  │
  └─► JUMBF Superbox (type: 'jumb')
        │
        ├─► JUMD Description Box (type: 'jumd')
        │     │
        │     ├─► UUID Type (16 bytes)
        │     ├─► Flags (1 byte)
        │     ├─► Label (null-terminated)
        │     ├─► Optional: ID (4 bytes)
        │     └─► Optional: Signature (32 bytes)
        │
        ├─► CBOR Payload Box (type: 'cbor')
        │     └─► CBOR data (manifest, claim, etc.)
        │
        └─► Nested JUMBF Superbox (type: 'jumb')
              └─► ... (recursive)
```

## JUMD Box Detail

### UUID Types (First 4 bytes ASCII)

| UUID Prefix | Full UUID | Purpose |
|-------------|-----------|---------|
| `c2pa` | `63327061-0010-0010-8000-00AA00389B71` | Main manifest |
| `c2ma` | `63326D61-0010-0010-8000-00AA00389B71` | Manifest |
| `c2as` | `63326173-0010-0010-8000-00AA00389B71` | Assertions |
| `cbor` | `63626F72-0010-0010-8000-00AA00389B71` | CBOR payload |
| `c2cl` | `6332636C-0010-0010-8000-00AA00389B71` | Claim |
| `c2cs` | `63326373-0010-0010-8000-00AA00389B71` | Claim signature |

### Flags Byte

| Bit | Value | Meaning |
|-----|-------|---------|
| 0 | 0x01 | Has ID |
| 1 | 0x02 | Has Label |
| 2 | 0x04 | Reserved |
| 3 | 0x08 | Has Signature |
| 4-7 | - | Reserved |

### Example JUMD Box

```
Offset  Size  Description
0       16    UUID: 63 32 70 61 00 10 00 10 80 00 00 AA 00 38 9B 71  ("c2pa...")
16      1     Flags: 0x03 (Label + ID)
17      5     Label: "c2pa\0"
22      4     ID: 0x00000001
26      32    Signature: (32 bytes)
```

## CBOR Payload Structure

The `cbor` box contains a CBOR-encoded C2PA manifest:

```
CBOR Map
  ├─► 1: "c2pa" (magic)
  ├─► 2: Claim Generator Info
  │     ├─► name: "Adobe Photoshop"
  │     ├─► version: "25.5.1"
  │     └─► com.adobe.build: "20240302.r.408..."
  ├─► 3: Assertions (array)
  │     ├─► 0: Actions
  │     │     ├─► action: "c2pa.edited"
  │     │     ├─► softwareAgent: "Adobe Firefly"
  │     │     ├─► digitalSourceType: "trainedAlgorithmicMedia"
  │     │     └─► when: "2024-01-15T14:30:22Z"
  │     ├─► 1: Exclusions
  │     │     └─► ranges: [{start: 57, length: 11443}]
  │     └─► 2: Claim
  │           ├─► title: "Generated Image"
  │           ├─► format: "image/jpeg"
  │           ├─► instanceId: "xmp.iid:..."
  │           └─► claimGenerator: "Adobe Photoshop/25.5.1..."
  └─► 4: Signature (COSE Sign1)
        ├─► protected: {alg: -7}  (ES256)
        ├─► unprotected: {}
        ├─► payload: (bytes)
        └─► signature: (bytes)
```

## Nested JUMBF Boxes

For large manifests, JUMBF boxes can nest:

```
jumb (superbox)
  ├─► jumd (label: "c2pa")
  ├─► cbor (manifest)
  └─► jumb (nested - large assertion)
        ├─► jumd (label: "c2pa.actions")
        └─► cbor (actions detail)
```

## PNG caBX Chunk

PNG stores C2PA in `caBX` chunks:

```
PNG Signature
IHDR
caBX (C2PA JUMBF data)
  └─► Same JUMBF structure as JPEG
IDAT
IEND
```

## QuickTime/HEIC UUID Box

QuickTime/HEIC uses a UUID atom:

```
'moov' or 'meta'
  └─► 'uuid' (C2PA UUID: D8FEC3D6-1B0E-483C-9297-5828877EC481)
        └─► JUMBF structure
```

## Byte Order

All multi-byte values in JUMBF boxes are **big-endian** (network byte order), except:
- UUID follows Microsoft GUID byte order (mixed endianness)
- CBOR data follows CBOR spec (big-endian for integers)

## ExifTool Parity

exiftool-ts JUMBF parser matches ExifTool 13.55+ byte-for-byte:

- ✅ 16-byte UUID parsing
- ✅ 1-byte flags
- ✅ Null-terminated labels
- ✅ Optional 4-byte ID
- ✅ Optional 32-byte signature
- ✅ Recursive jumb container walking
- ✅ Label-gated CBOR payload association