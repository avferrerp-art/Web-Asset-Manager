// Builds and runs scripts/verify-product-sync.ts using the same esbuild setup as build.mjs
// (pino plugin + createRequire banner), since API routes are auth-protected and tsx is unavailable.
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
  entryPoints: [path.join(dir, "verify-product-sync.ts")],
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

const res = spawnSync("node", [path.join(outdir, "verify-product-sync.mjs")], {
  stdio: "inherit",
});
process.exit(res.status ?? 1);
