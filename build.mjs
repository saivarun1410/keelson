import { build } from "esbuild";

/**
 * `yaml` is CommonJS. Bundled into an ESM output it calls `require` at module
 * scope, which ESM does not provide, so we inject a real one. Minifying matters
 * more here than in most CLIs: the hook is parsed on every single agent edit.
 */
const BANNER = [
  "#!/usr/bin/env node",
  'import{createRequire as __createRequire}from"node:module";',
  "const require=__createRequire(import.meta.url);",
].join("\n");

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist/cli.js",
  minify: true,
  banner: { js: BANNER },
});

console.log("built dist/cli.js");
