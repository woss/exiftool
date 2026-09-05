---
sidebar_position: 1
slug: /c2pa/overview
---

# C2PA Content Credentials Overview

> ⚠️ **Implementation Status**: C2PA/JUMBF support is **planned but not yet implemented**.
> See [C2PA_PLAN.md](../../../C2PA_PLAN.md) for the roadmap. Current parity sweep shows
> C2PA tags as MISSING (PhotoshopQuality, PhotoshopFormat, ProgressiveScans).
>
> ⚠️ **Reality Check**: C2PA is fundamentally broken as a trust system. See Neal Krawetz's
> analysis: [**"C2PA's Worst Case Scenario"**](https://www.hackerfactor.com/blog/index.php?/archives/1013-C2PAs-Worst-Case-Scenario.html)
> (Hacker Factor Blog). Key findings:
> - **Voluntary honor system**: Companies creating AI slop are asked to self-label it
> - **Platforms strip metadata**: Instagram, LinkedIn, Threads all strip C2PA on upload
> - **No enforcement**: Any member can leave anytime (X/Twitter did; 270M users unprotected)
> - **OpenAI admits**: C2PA metadata "can easily be removed either accidentally or intentionally"
> - **Financial incentives oppose it**: AI slop drives engagement → ads → revenue
> - **"Friction theater"**: Appearance of a solution that lets business continue unchanged
>
> exiftool-ts parses JUMBF/C2PA structures if present, but **cannot verify trust** — the chain
> of custody is broken by design.

 C2PA (Coalition for Content Provenance and Authenticity) defines a standard for embedding **cryptographically verifiable provenance** in media files. It enables:

## JUMBF Box Structure

C2PA data lives in **JUMBF (JPEG Universal Metadata Box Format)** boxes:

```
JPEG APP11 ("JP")
  │
  ▼
JUMBF Superbox ("jumb")
  │
  ├─► JUMD ("jumd") - Description box
  │     │
  │     ├─► Type UUID (16 bytes): "c2pa", "c2ma", "c2as", "cbor", "c2cl", "c2cs"
  │     ├─► Flags (1 byte): Label=0x02, ID=0x04, Signature=0x08
  │     ├─► Label (null-terminated): "c2pa", "c2pa.actions", "c2pa.hash.data"
  │     └─► Optional: 4-byte ID, 32-byte signature
  │
  ├─► CBOR Payload ("cbor") ────► Manifest/Actions/Exclusions/Claim/Signature
  │
  └─► Nested JUMBF boxes ──────► Recursive structure
```

## Supported C2PA Tags

### Manifest Tags
| Tag | Description |
|-----|-------------|
| `Claim_generator` | Generator string (e.g., "Adobe Photoshop/25.5.1...") |
| `Claim_Generator_InfoName` | Generator name |
| `Claim_Generator_InfoVersion` | Generator version |
| `Claim_Generator_InfoComAdobeBuild` | Adobe build info |

### Actions
| Tag | Description |
|-----|-------------|
| `ActionsAction` | Action type (e.g., "c2pa.edited", "c2pa.created") |
| `ActionsSoftwareAgent` | Tool name (e.g., "Adobe Firefly") |
| `ActionsDigitalSourceType` | Source type URL (e.g., `trainedAlgorithmicMedia`) |
| `ActionsWhen` | Timestamp of action |

### Exclusions
| Tag | Description |
|-----|-------------|
| `ExclusionsStart` | Byte offset of excluded region |
| `ExclusionsLength` | Length of excluded region |

### Assertions
| Tag | Description |
|-----|-------------|
| `AssertionsUrl` | Array of assertion references |
| `AssertionsHash` | Array of SHA-256 hashes (binary placeholders) |

### Signature
| Tag | Description |
|-----|-------------|
| `Signature` | Signature reference (e.g., `self#jumbf=c2pa.signature`) |

### Claim Box
| Tag | Description |
|-----|-------------|
| `Title` | Content title |
| `Format` | MIME type |
| `InstanceID` | XMP InstanceID |
| `Claim_generator` | Full generator string |
| `Signature` | Signature reference |
| `AssertionsUrl` | Assertion references |
| `AssertionsHash` | Assertion hashes |

## Reading C2PA Data

```typescript
import { ExifTool } from 'exiftool-ts';

const exiftool = new ExifTool();
const result = await exiftool.read('c2pa-image.jpg');

// Access C2PA tags
console.log(result.tags.Claim_generator);           // "Adobe Photoshop/25.5.1..."
console.log(result.tags.ActionsAction);             // "c2pa.edited"
console.log(result.tags.ActionsSoftwareAgent);      // "Adobe Firefly"
console.log(result.tags.ActionsDigitalSourceType);  // "http://cv.iptc.org/..."
console.log(result.tags.ExclusionsStart);           // 57
console.log(result.tags.ExclusionsLength);          // 11443
console.log(result.tags.Claim_Generator_InfoName);  // "Adobe Photoshop"
console.log(result.tags.Claim_Generator_InfoVersion); // "25.5.1"
console.log(result.tags.Claim_Generator_InfoComAdobeBuild); // "20240302.r.408..."
console.log(result.tags.Signature);                 // "self#jumbf=c2pa.signature"
console.log(result.tags.AssertionsUrl);             // ["self#jumbf=...", "..."]
console.log(result.tags.AssertionsHash);            // [Buffer, Buffer]
console.log(result.tags.Title);                     // "Generated Image"
console.log(result.tags.Format);                    // "image/jpeg"
console.log(result.tags.InstanceID);                // "xmp.iid:DB122B584C7CC44E9E849ADD150CED60"
```

## CLI for C2PA

```bash
# All C2PA tags
exiftool-ts -C2PA image.jpg

# Specific C2PA tags
exiftool-ts -Claim_generator -ActionsAction -ActionsSoftwareAgent image.jpg

# JSON output
exiftool-ts -j -C2PA image.jpg
```

## Validation

```typescript
import { ExifTool } from 'exiftool-ts';

const exiftool = new ExifTool();
const result = await exiftool.read('c2pa-image.jpg');

// Check for C2PA presence
if (result.tags.Claim_generator) {
  console.log('C2PA present:', result.tags.Claim_generator);
}

// Verify signature reference exists
if (result.tags.Signature) {
  console.log('Signed:', result.tags.Signature);
}
```