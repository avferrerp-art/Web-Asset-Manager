// Builds and runs scripts/verify-traslados.ts using the API server's bundling
// setup so the authenticated Odoo services can be exercised without HTTP.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

globalThis.require = createRequire(import.meta.url);
const { build } = await import("esbuild");
const esbuildPluginPino = (await import("esbuild-plugin-pino")).default;

const dir = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.join(dir, ".verify-dist");

await build({
  entryPoints: [path.join(dir, "verify-traslados.ts")],
  platform: "node",
  bundle: true,
  format: "esm",
  outdir,
  outExtension: { ".js": ".mjs" },
  external: ["*.node", "pg-native"],
  plugins: [esbuildPluginPino({ transports: ["pino-pretty"] })],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; globalThis.require = __cr(import.meta.url);",
  },
});

const result = spawnSync("node", [path.join(outdir, "verify-traslados.mjs")], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);