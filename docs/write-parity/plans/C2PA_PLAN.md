# C2PA/JUMBF Support Plan

## Architecture (from ExifTool research)

```
Container Format → JUMBF Detection → Jpeg2000::Main (JUMBF boxes) → CBOR.pm (manifest/merkle)
       │                                            │
       │                      ┌────────────────────┴────────────────────┐
       │                      ▼                                         ▼
       │               JUMD boxes (description)                  CBOR data (manifest)
       │                      │                                         │
       │                      ▼                                         ▼
       └────────────────── JUMDType, JUMDLabel,                claim_generator, actions,
                          JUMDToggles, JUMDID,                    assertions (actions, etc.),
                          JUMDSignature                           exclusions, items, etc.
```

**Key modules in ExifTool:**
- `Jpeg2000.pm` — core JUMBF box parser (`ProcessJUMB`, `ProcessJUMD`), `JUMD` tag table
- `CBOR.pm` — CBOR decoder with C2PA-specific tag table (dc:title, authorName, documentID, etc.)
- `JPEG.pm` / `PNG.pm` / `PDF.pm` / `QuickTime.pm` — format-specific JUMBF detection, hand off to Jpeg2000

**Our test assets currently lack C2PA.** Library sweep found 1 file with C2PA tags (the MISSING tags above).

---

## Implementation Scope

### Phase 1: JUMBF Box Infrastructure (core)
- [ ] `src/format/jumbf.ts` — JUMBF box parser (mirrors `ProcessJUMB`/`ProcessJUMD`)
  - JUMBF box header parsing (size, type, UUID)
  - JUMD description box parsing (type UUID, flags, label, ID, signature)
  - Sub-box dispatch (C2PA manifest = CBOR, merkle = CBOR, etc.)
  - Multi-level sub-document tracking (`jumd_level` / `DOC_NUM`)

### Phase 2: Format Integration
- [ ] `src/format/jpeg.ts` — detect APP11 "JP" prefix, delegate to JUMBF parser
- [ ] `src/format/png.ts` — detect `caBX` chunk, delegate
- [ ] `src/format/quicktime.ts` — detect C2PA UUID (`d8fec3d6-1b0e-483c-9297-5828877ec481`), delegate
- [ ] `src/format/pdf.ts` — (later; PDF embedded files)

### Phase 3: CBOR Parser (for manifest/merkle)
- [ ] `src/exif/cbor.ts` — CBOR decoder (RFC 7049 subset for C2PA)
  - Major types 0-7, indefinite length not needed for C2PA
  - Tag handling (date/time string, epoch time, bignum, decimal fraction, COSE, URI, base64, etc.)
  - Output into tag table (dc:title → Title, authorName → AuthorName, etc.)

### Phase 4: C2PA Tag Tables
- [ ] JUMD tags: `JUMDType`, `JUMDLabel`, `JUMDToggles`, `JUMDID`, `JUMDSignature`
- [ ] CBOR/manifest tags: `ClaimGenerator`, `ClaimGeneratorInfo*`, `Actions*`, `Exclusions*`, `Assertions*`, `Signature`, `Items*`
- [ ] Map ExifTool tag names → our camelCase convention

### Phase 5: Test & Verification
- [ ] Add C2PA test asset (or use library file)
- [ ] Parity sweep: reduce MISSING C2PA tags from ~25 → 0
- [ ] Integration tests for JPEG/PNG/QuickTime

---

## Scope Notes

| Area | Effort | Notes |
|---|---|---|
| JUMBF core | Medium | ~300-400 lines; box parsing is well-defined |
| Format hooks | Low | 3-4 format files, ~20 lines each |
| CBOR decoder | Medium | ~200 lines; RFC 7049 subset; already have JSON helpers |
| Tag tables | Low | Straight mapping from ExifTool CBOR::Main + C2PA spec |
| **Total** | **~1-2 days** | Can be incremental; each format works independently |

---

## Decision Points

1. **CBOR implementation**: Full RFC 7049 decoder vs C2PA subset?
   - Recommendation: Full subset (major types 0-5, 7, tags 0-36, 55799). ~200 lines. ExifTool's `CBOR.pm` is ~500 lines with COSE/encoding. Our subset can be smaller.

2. **JUMBF as block save**: ExifTool has `-jumbf:all` to extract raw JUMBF blob. We should support `-b`/`--binary` for JUMBF tag.

3. **Multi-format test assets**: Need at least one JPEG with C2PA, one PNG with C2PA. Can extract from ExifTool test suite or create minimal synthetic.

4. **Parser integration point**: Current `parseXMP` / `parseICC` pattern → new `parseJUMBF(data, format)` called from format parsers.

---

## Acceptance Criteria

- `exiftool -jumbf:all -G3 file.jpg` equivalent output for tags:
  - `JUMBF:JUMDType`, `JUMBF:JUMDLabel`, `JUMBF:ClaimGenerator`, `JUMBF:ActionsAction`, etc.
- Library parity: C2PA MISSING tags → 0
- Coverage: 100% for new modules
- No regression on existing 478 tests