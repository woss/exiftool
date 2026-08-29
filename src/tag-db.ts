import type { TagEntry, TagGroups, TagId } from './types.js';

export class TagDb {
  private byName = new Map<string, TagEntry>();
  private byId = new Map<string, TagEntry[]>();
  private byGroup = new Map<string, TagEntry[]>();

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

  registerBatch(entries: TagEntry[]): void {
    for (const entry of entries) {
      this.register(entry);
    }
  }

  getByName(name: string): TagEntry | undefined {
    return this.byName.get(name.toLowerCase());
  }

  getById(id: TagId, group?: string): TagEntry | undefined {
    const key = `${group ?? ''}:${id}`;
    const entries = this.byId.get(key);
    return entries?.[0];
  }

  getByGroup(group: string): TagEntry[] {
    return this.byGroup.get(group) ?? [];
  }

  getAllTags(): TagEntry[] {
    return [...this.byName.values()];
  }

  getWritableTags(): TagEntry[] {
    return this.getAllTags().filter((t) => t.writable);
  }

  getGroups(): string[] {
    return [...this.byGroup.keys()].sort();
  }

  size(): number {
    return this.byName.size;
  }
}
