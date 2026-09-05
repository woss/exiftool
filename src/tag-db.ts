import type { TagEntry, TagGroups, TagId } from './types.js';

/**
 * Tag database for managing tag definitions.
 * Provides fast lookup by name, ID, or group.
 * Used by ExifTool for tag normalization and validation.
 *
 * @example
 * ```typescript
 * import { TagDb } from 'exiftool-ts';
 *
 * const db = new TagDb();
 * db.register({
 *   id: 'CustomTag',
 *   name: 'CustomTag',
 *   description: 'My custom tag',
 *   format: 'string',
 *   writable: true,
 *   groups: { family0: 'Custom', family1: 'Custom', family2: 'User' },
 * });
 * ```
 */
export class TagDb {
  private byName = new Map<string, TagEntry>();
  private byId = new Map<string, TagEntry[]>();
  private byGroup = new Map<string, TagEntry[]>();

  /**
   * Registers a single tag entry.
   * Indexes by name (case-insensitive), ID+group, and all group families.
   *
   * @param entry - Tag entry to register
   */
  register(entry: TagEntry): void {
    this.byName.set(entry.name.toLowerCase(), entry);
    const idKey = `${entry.groups.family1 ?? ''}:${entry.id}`;
    const existing = this.byId.get(idKey) ?? [];
    existing.push(entry);
    this.byId.set(idKey, existing);

    for (const key of Object.values(entry.groups)) {
      if (key) {
        const groupEntries = this.byGroup.get(key) ?? [];
        groupEntries.push(entry);
        this.byGroup.set(key, groupEntries);
      }
    }
  }

  /**
   * Registers multiple tag entries in batch.
   *
   * @param entries - Array of tag entries
   */
  registerBatch(entries: TagEntry[]): void {
    for (const entry of entries) {
      this.register(entry);
    }
  }

  /**
   * Looks up a tag by normalized name (case-insensitive).
   *
   * @param name - Tag name (e.g., "exposuretime", "Artist")
   * @returns Tag entry or undefined
   */
  getByName(name: string): TagEntry | undefined {
    return this.byName.get(name.toLowerCase());
  }

  /**
   * Looks up a tag by ID within a group.
   *
   * @param id - Tag ID (e.g., "ExposureTime", "0x829A")
   * @param group - Optional group name (e.g., "IFD0", "XMP-dc")
   * @returns First matching tag entry or undefined
   */
  getById(id: TagId, group?: string): TagEntry | undefined {
    const key = `${group ?? ''}:${id}`;
    const entries = this.byId.get(key);
    return entries?.[0];
  }

  /**
   * Gets all tags belonging to a group family.
   *
   * @param group - Group name (family 0, 1, or 2)
   * @returns Array of tag entries
   */
  getByGroup(group: string): TagEntry[] {
    return this.byGroup.get(group) ?? [];
  }

  /** Returns all registered tags. */
  getAllTags(): TagEntry[] {
    return [...this.byName.values()];
  }

  /** Returns all writable tags. */
  getWritableTags(): TagEntry[] {
    return this.getAllTags().filter((t) => t.writable);
  }

  /** Returns all known group names. */
  getGroups(): string[] {
    return [...this.byGroup.keys()].sort();
  }

  /** Returns the number of registered tags. */
  size(): number {
    return this.byName.size;
  }
}