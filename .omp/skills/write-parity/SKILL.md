---
name: write-parity
description: Metadata-writing parity lanes for exiftool-ts — matrix-driven specs, serializer/container work, differential gates vs vendored ExifTool 13.64
---

## Source of truth

- `docs/write-parity/README.md` + `matrix.json` (generated) + `specs/*.md` —
  the executable contract, derived from `vendor/exiftool/README` +
  `src/tags/generated/manifest.json` (pinned 13.64).
- `docs/write-parity/plans/WRITE_PLAN.md` — requirement source + phase map only. Where it disagrees
  with the matrix/specs, follow the code and file the divergence note.
- Load `skill://code-philosophy` before any BACKEND code change (repo rule).

## Roles (never same agent plans + verifies)

1. **Planner** (read-only): `get_minimal_context(task=…)` via
   code-review-graph, trace to the serializer/container owners with
   `query_graph`/`lsp`. Output: spec delta + exact `matrix.json` cells to
   flip. No code.
2. **Implementer**: one GitButler lane, one serializer OR one container OR
   one op cluster. Differential test first, status promotion second.
3. **Reviewer**: diff + upstream `vendor/exiftool/t/*.t` cases. Verifies
   our-write→upstream-read, upstream-write→our-read, and unchanged blocks
   byte-identical.

## Gates

- `pnpm generate-tags` → regenerate `src/tags/generated/*`, then
  `pnpm generate-matrix` → regenerate `docs/write-parity/matrix.json`. Never
  hand-edit generated outputs. Byte-for-byte regenerate-and-diff is the
  acceptance gate on any ExifTool bump.
- `pnpm generate-matrix --check` must pass. `implemented` requires a `test`
  link in the matrix; `partial`/`unsafe` require a `reason`.
- Safety: opaque/encrypted/proprietary blocks are preserved byte-for-byte or
  the write is refused loud. A container's writeability never implies every
  family writes into it — promote one `fileType|family|op` cell at a time.
- Version drift: `matrix.json` `exiftoolVersion` must equal
  `manifest.json` `exiftoolVersion`, which must equal `vendor/exiftool/exiftool -ver`.
  `docs/write-parity/plans/WRITE_PLAN.md` "13.55" text is historical; verify against 13.64.

## Quick commands

```bash
pnpm generate-matrix                 # write docs/write-parity/matrix.json
pnpm generate-matrix --check         # CI gate
pnpm generate-tags                   # regenerate tag catalog (see gates)
node node_modules/vitest/vitest.mjs run scripts/generate-matrix.test.ts
vendor/exiftool/exiftool -ver        # must print 13.64
```
