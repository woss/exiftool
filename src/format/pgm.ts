import { createNetpbmParser } from './netpbm.js';

export const pgmParser = createNetpbmParser({
  format: 'PGM',
  magics: ['P2', 'P5'],
  hasMaxValue: true,
  extensions: ['.pgm'],
  mimeType: 'image/x-portable-graymap',
});