export interface ExpandOptions {
  recurse: boolean;
  extensions?: string[];
  ignoreDirs?: string[];
}

/**
 * Expands CLI file arguments: existing files pass through untouched,
 * directories are walked (depth-first when recurse is set) and their
 * discovered files are appended in deterministic lexicographic order.
 * Nonexistent paths pass through unchanged so per-file error handling
 * can report them.
 */
export async function expandInputs(
  inputs: string[],
  opts: ExpandOptions,
): Promise<string[]> {
  const extensions = opts.extensions ?? [];
  const ignoreDirs = opts.ignoreDirs ?? [];
  const out: string[] = [];
  for (const input of inputs) {
    let stat: Deno.FileInfo;
    try {
      stat = await Deno.stat(input);
    } catch {
      out.push(input);
      continue;
    }
    if (!stat.isDirectory) {
      out.push(input);
      continue;
    }
    const discovered: string[] = [];
    await walkDir(
      input,
      { recurse: opts.recurse, extensions, ignoreDirs },
      discovered,
    );
    discovered.sort();
    out.push(...discovered);
  }
  return out;
}

async function walkDir(
  dir: string,
  opts: { recurse: boolean; extensions: string[]; ignoreDirs: string[] },
  out: string[],
): Promise<void> {
  const base = dir.endsWith('/') ? dir : `${dir}/`;
  const files: string[] = [];
  const dirs: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    // Symlinks are skipped outright, which also makes directory cycles
    // impossible without any visited-set bookkeeping.
    if (entry.isSymlink) continue;
    if (entry.isFile) {
      files.push(entry.name);
    } else if (entry.isDirectory && !opts.ignoreDirs.includes(entry.name)) {
      dirs.push(entry.name);
    }
  }
  files.sort();
  dirs.sort();
  for (const name of files) {
    // Empty extension list accepts everything; otherwise case-insensitive
    // suffix match against dotless extensions ('jpg' matches 'X.JPG').
    if (
      opts.extensions.length === 0 ||
      opts.extensions.some((ext) =>
        name.toLowerCase().endsWith(`.${ext.toLowerCase()}`)
      )
    ) {
      out.push(`${base}${name}`);
    }
  }
  if (!opts.recurse) return;
  for (const name of dirs) {
    await walkDir(`${base}${name}`, opts, out);
  }
}
