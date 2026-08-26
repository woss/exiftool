#!/usr/bin/env -S deno run -A
/**
 * Builds the npm distribution for exiftool-ts.
 *
 * The npm channel ships the CLI as a NATIVE binary (no Node at runtime):
 *  - @woss/exiftool-ts            → installer + bin shim (this output)
 *  - @woss/exiftool-ts-<platform> → per-platform compiled binaries
 *
 * Platform packages are assembled by the release workflow from the
 * `deno compile` matrix artifacts. This script emits the core package.
 *
 * Usage: deno run -A scripts/build-npm.mjs <out-dir>
 */

const outDir = Deno.args[0] ?? "npm-dist";
const cfg = JSON.parse(await Deno.readTextFile("deno.json"));
const version = cfg.version;
const name = "exiftool-ts";

await Deno.mkdir(`${outDir}/bin`, { recursive: true });

// --- core package.json -------------------------------------------------
const optionalDeps = Object.fromEntries(
  [
    "linux-x64",
    "linux-arm64",
    "darwin-arm64",
    "darwin-x64",
    "win32-x64",
  ].map((p) => [`@woss/exiftool-ts-${p}`, version]),
);

const pkg = {
  name,
  version,
  description: cfg.description,
  license: cfg.license,
  type: "module",
  bin: {
    [name]: "bin/exiftool-ts",
    [`${name}.cmd`]: "bin/exiftool-ts.cmd",
  },
  engines: { node: ">=16" },
  scripts: { postinstall: "node install.js" },
  optionalDependencies: optionalDeps,
  files: ["bin/", "install.js", "README.md"],
  repository: "https://github.com/woss/exiftool-ts",
};

await Deno.writeTextFile(`${outDir}/package.json`, JSON.stringify(pkg, null, 2) + "\n");

// --- installer ---------------------------------------------------------
// Zero-dependency postinstall: finds the platform binary among the installed
// optional dependencies and copies it into ./bin so npm's bin links work.
// Runtime never touches Node again — it execs the native binary directly.
const installJs = `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const pkg = require("./package.json");
const isWin = process.platform === "win32";
const exeName = isWin ? "${name}.exe" : "${name}";
const dest = path.join(__dirname, "bin", exeName);

const platforms = Object.keys(pkg.optionalDependencies || {});
for (const p of platforms) {
  const src = path.join(__dirname, "node_modules", p, exeName);
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    if (!isWin) fs.chmodSync(dest, 0o755);
    if (isWin) {
      // cmd shim so PATH lookup works from cmd.exe
      fs.writeFileSync(
        path.join(__dirname, "bin", "${name}.cmd"),
        '@"%~dp0\\\\' + exeName + '" + "%*\\r\\n',
      );
    }
    process.exit(0);
  }
}
console.error("${name}: no matching platform binary was installed.");
console.error("Expected one of:", platforms.join(", "));
process.exit(1);
`;
await Deno.writeTextFile(`${outDir}/install.js`, installJs);

// --- minimal README ----------------------------------------------------
const readme = `# ${name} (binary distribution)

\`npm i -g ${name}\` installs a self-contained native \`${name}\` binary —
no Node.js required at runtime.

Library users on Deno: see https://jsr.io/@woss/exiftool-ts
`;
await Deno.writeTextFile(`${outDir}/README.md`, readme);

console.log(`npm core package written to ${outDir} (v${version})`);
