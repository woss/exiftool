import { ExifTool } from './src/exiftool.ts';

const tool = new ExifTool();
await tool.run(Deno.args);
