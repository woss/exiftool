ExifTool-derived tag data
=========================

The JSON files in this directory are derived from Phil Harvey's ExifTool
(https://exiftool.org, https://github.com/exiftool/exiftool):

- `tags.json`      — generated from `exiftool -listx` output
  (scripts/generate-tags.ts)
- `manifest.json`  — ExifTool release/source-tree hash and SHA-256 of `tags.json`
- `xmp-namespaces.json` — canonical XMP prefix-to-URI map from ExifTool `XMP.pm`
- `xmp-shapes.json` — writable RDF Bag/Seq/Alt shapes extracted from ExifTool's loaded XMP tables
- `xmp-structs.json` — recursive XMP struct field metadata extracted from ExifTool's loaded tables
- `write-metadata.json` — core family write groups, protection/conditions, and conversion metadata from ExifTool Perl tables
- `maker-printconv.json` — literal hash PrintConv tables extracted from the
  ExifTool Perl source (scripts/extract-maker-printconv.py)

These files contain ExifTool's tag descriptions and PrintConv value tables
and are therefore subject to ExifTool's own license: **GPL-3.0-or-later OR
Artistic License 2.0** (ExifTool, copyright Phil Harvey). They are
redistributed here under the Artistic License 2.0
(https://dev.perl.org/licenses/artistic.html).

Tag identifiers and tag names describe standard and vendor metadata formats
and remain useful as uncopyrightable interface facts, but the descriptive
text and value tables are ExifTool's expression — hence this notice.

The TypeScript code in this repository is NOT derived from ExifTool and
remains MIT-licensed (see /LICENSE). If you redistribute this package,
these data files must keep the ExifTool notice above.

Upgrading
---------
The reference ExifTool source is vendored as a git submodule pinned to the
release we generated these files from:

    git submodule update --init --depth 1   # clone/refresh
    cd vendor/exiftool && git fetch --depth 1 origin tag <newer> && git checkout --detach <newer>

Then update the pinned version in `scripts/generate-tags.ts`, regenerate, and
commit the reviewed catalog, manifest, and PrintConv diff:

  pnpm generate-tags
  python3 scripts/extract-maker-printconv.py

