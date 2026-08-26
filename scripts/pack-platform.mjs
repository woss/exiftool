#!/usr/bin/env -S deno run -A
/**
 * Assembles one npm platform package around a compiled binary.
 *
 * Usage: deno run -A scripts/pack-platform.mjs <platform> <binary-path>
 *   e.g. deno run -A scripts/pack-platform.mjs linux-x64 ./exiftool-ts
 *
 * Output: npm-pkg/ directory containing package.json + binary.
 */

const [platform, binaryPath] = Deno.args;
if (!platform || !binaryPath) {
  console.error("usage: pack-platform.mjs <platform> <binary>");
  Deno.exit(1);
}

const cfg = JSON.parse(await Deno.readTextFile("deno.json"));
const pkgName = `@woss/exiftool-ts-${platform}`;
const exe = platform.startsWith("win32") ? "exiftool-ts.exe" : "exiftool-ts";

await Deno.mkdir("npm-pkg", { recursive: true });
await Deno.copyFile(binaryPath, `npm-pkg/${exe}`);

const pkg = {
  name: pkgName,
  version: cfg.version,
  description: `${cfg.description} — ${platform} binary`,
  license: cfg.license,
  os: [platform.split("-")[0]],
  cpu: [platform.split("-")[1] ?? "x64"],
  files: [exe],
};

await Deno.writeTextFile("npm-pkg/package.json", JSON.stringify(pkg, null, 2) + "\n");
console.log(`packed ${pkgName} (binary ${binaryPath}, ${exe})`);
