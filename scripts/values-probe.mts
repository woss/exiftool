import { formatExifValue } from '../src/exif/values.js';
console.log('src SensingMethod 1 →', JSON.stringify(formatExifValue(1, 'SensingMethod')));
console.log('src FileSource 1 →', JSON.stringify(formatExifValue(1, 'FileSource')));
