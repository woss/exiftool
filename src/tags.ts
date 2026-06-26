export interface TagDef {
  id: string;
  name: string;
  type: string;
  writable: boolean;
  description?: string;
  g2?: string;
  values?: Record<string, string>;
}

export interface TableDef {
  perlName: string;
  groups: { g0?: string; g1?: string; g2?: string };
  description: string;
  tags: TagDef[];
}
