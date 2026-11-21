# Write operations + CLI/API spec (§H)

Upstream: 13.64 `t/Writer.t` + format-specific `vendor/exiftool/t/*.t` write
cases. Code: `src/cli.ts`, `src/exiftool.ts`, `src/write/pipeline.ts`,
`src/types.ts` (`WriteOptions`, `WriteOutcome`, `skipped`).

## Scope

- **Request model (single source):** set / add / append (`+=`) / remove
  (`-=`) / delete (null / `-Tag=`) / copy (`-tagsFromFile`, `@`, `-srcfile`,
  `-DSTTAG<SRCTAG`), source selection, write mode (`-wm w/c/g`), warnings,
  per-tag failures. `ExifTool.write`, `writeBytes`, sidecars, and CLI share
  this model — no parallel semantics.
- **Name resolution:** groups/aliases, family-qualified names, preferred
  write groups, duplicate names, numeric/raw names, precedence. Explicit
  `GROUP:Tag` routes only to that group; mismatches are `skipped`.
- **Value conversion:** all groups/aliases validated; exact + unique-prefix
  enum matching; ambiguous/invalid ⇒ actionable per-tag failure, no silent
  success. Trailing `#` bypasses conversion (raw storage values only).
- **Write modes:** `-wm` metadata-aware existing-tag detection; basic
  pre-checks already exist — full parity open. Writes with no accepted
  requested tag fail **before** replacing the source.
- **Filesystem:** `-o` (incl. `.xmp` sidecar destinations, `-o -`, `%d/%f/%e`
  tokens, collision suffixes), `-overwrite_original(_in_place)`, `-P`
  (preserve mtime), `FileModifyDate` direct mtime writes, permission-bit
  preservation across atomic rename, recursion + `-ext`, `-q`, batch
  partial-success + stable exit codes, stay-open `-executeN`/`{readyN}`.
- **Selection:** `-if` (comparisons, regex `=~`/`!~`, `and`/`or`, parens),
  `-all`, bare `-TAG` selectors with `*`/`?` in projection modes.
- **Binary/date/geotag:** `-b` binary emit (covered); binary writes, `-geotag`,
  `-geosync`, `-geotime`, `-globalTimeShift` are scoped explicitly — implement
  or record unsupported, never half-advertise.

## Invariants

- Unsupported cells fail clearly or land in `skipped` — never report a
  successful write that did nothing.
- Per-file failure never aborts a batch; exit status reflects any failure.
- Help text, generated capabilities, and docs advertise **only** implemented
  option/family/container combinations (derive from `matrix.json`).

## Upstream-only (recorded, do not port)

13.56–13.64 CLI/config items intentionally out of scope: `-eh` alias
(adopt only if `-E` lands), `-config -` piped input, `-sort` stability,
`-diff` internals, strict `-validate` (worth adopting only if validation
comes in scope), stay-open pipe-close hang (#458), `audio2itemlist.args`,
`novelty.config`. Geotag workflows (`-geotag`/`-geosync`/`-geotime`,
`-globalTimeShift`, FIT as geotag source) stay unsupported until explicitly
scoped; record as unsupported, never half-advertise.

## Test vectors

Each op × container × family: bytes where preservation expected, metadata
semantics where serialization differs, diagnostics + exit code + output files.
Behavioral evidence: upstream `t/Writer.t` cases for every supported cell.
