# RAW test fixtures

`DNG.dng`, `CanonRaw.cr2`, `Nikon.nef`, `Panasonic.rw2`, `Sony.jpg`,
`Olympus.jpg`, `OlympusE1.jpg`, `Pentax.jpg`, `Panasonic.jpg` come from
[ExifTool](https://github.com/exiftool/exiftool)'s own test suite
(`t/images/`), trimmed by its author to a few KB each.

ExifTool is copyright Phil Harvey and licensed under the GNU General
Public License (v3+) or, at your option, the Artistic License 2.0; this
redistribution is made under the Artistic License 2.0
(https://dev.perl.org/licenses/artistic.html).

Used only as test inputs (`src/format/tiff-raw.test.ts`,
`src/exif/makernotes.test.ts`); expected tag
values in those tests are exiftool 13.55 output captured from the same
files.
