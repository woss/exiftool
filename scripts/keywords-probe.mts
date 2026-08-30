import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? process.env.HOME + '/Pictures/woss-photo';
const files = readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f)).map((f) => join(dir, f));

for (const file of files) {
  const ref = JSON.parse(execFileSync('exiftool', ['-j', file]).toString())[0];
  if (ref['Keywords'] === undefined) continue;
  const ours = JSON.parse(execFileSync('node', ['dist/cli.js', file, '-j']).toString())[0];
  if (String(ref['Keywords']) !== String(ours['Keywords'])) {
    console.log('FILE:', file);
    console.log('  ref :', JSON.stringify(ref['Keywords']));
    console.log('  ours:', JSON.stringify(ours['Keywords']));
    const xmp = readFileSync(file).toString();
    const seg = xmp.slice(xmp.indexOf('<x:xmpmeta'), xmp.indexOf('</x:xmpmeta>') + 12);
    const bag = seg.match(/keywords[\s\S]{0,400}?<\/rdf:Bag>/i) ?? seg.match(/subject[\s\S]{0,400}?<\/rdf:Bag>/i);
    console.log('  raw :', bag ? bag[0].replace(/\s+/g, ' ').slice(0, 260) : '(none)');
    break;
  }
}
