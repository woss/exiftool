import { createNetpbmParser } from './netpbm.js';

export const ppmParser = createNetpbmParser({
  format: 'PPM',
  magics: ['P3', 'P6'],
  hasMaxValue: true,
  extensions: ['.ppm', '.pnm'],
  mimeType: 'image/x-portable-pixmap',
});
