import { createNetpbmParser } from './netpbm.js';

export const pbmParser = createNetpbmParser({
  format: 'PBM',
  magics: ['P1', 'P4'],
  hasMaxValue: false,
  extensions: ['.pbm'],
  mimeType: 'image/x-portable-bitmap',
});