ExifTool-derived tag data
=========================

The JSON files in this directory are derived from Phil Harvey's ExifTool
(https://exiftool.org, https://github.com/exiftool/exiftool):

- `tags.json`      — generated from `exiftool -listx` output
  (scripts/generate-tags.ts)
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
