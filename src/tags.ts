/**
 * Tag definition types for the internal tag database.
 * These mirror the JSON structure in `tags/generated/tags.json`.
 */

/**
 * Individual tag definition.
 * Matches ExifTool's tag table structure.
 */
export interface TagDef {
  /** Tag ID (e.g., "ExposureTime", "0x829A") */
  id: string;

  /** Human-readable name (e.g., "Exposure Time") */
  name: string;

  /** Type string (e.g., "rational64u", "string", "int16u") */
  type: string;

  /** Whether the tag is writable */
  writable: boolean;

  /** Optional description */
  description?: string;

  /** Group 2 name (ExifTool family 2) */
  g2?: string;

  /** Value enumeration for known values (e.g., { "1": "Auto", "2": "Manual" }) */
  values?: Record<string, string>;
}

/**
 * Tag table definition (group of related tags).
 * E.g., "EXIF", "GPS", "XMP-dc", "IPTC".
 */
export interface TableDef {
  /** Perl module name (e.g., "Image::ExifTool::EXIF") */
  perlName: string;

  /** Group names at different family levels */
  groups: {
    /** Family 0: general category (e.g., "EXIF", "XMP") */
    g0?: string;
    /** Family 1: specific group (e.g., "IFD0", "dc") */
    g1?: string;
    /** Family 2: sub-group (e.g., "Image", "Camera") */
    g2?: string;
  };

  /** Table description */
  description: string;

  /** Array of tag definitions */
  tags: TagDef[];
}