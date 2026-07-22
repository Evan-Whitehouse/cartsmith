import * as esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const out = resolve(root, "dist");
const watch = process.argv.includes("--watch");

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  format: "esm",
  target: "es2022",
  logLevel: "info",
  // The extension solves with the pure-JS greedy solver, so the HiGHS-WASM exact solver is
  // never in the graph; mark it external as a safety net so no wasm is ever bundled.
  external: ["highs"],
};

const ctxs = await Promise.all([
  esbuild.context({
    ...common,
    entryPoints: [resolve(root, "src/popup.ts")],
    outfile: resolve(out, "popup.js"),
  }),
  esbuild.context({
    ...common,
    entryPoints: [resolve(root, "src/background.ts")],
    outfile: resolve(out, "background.js"),
  }),
]);

async function copyStatic() {
  await cp(resolve(root, "manifest.json"), resolve(out, "manifest.json"));
  await cp(resolve(root, "src/popup.html"), resolve(out, "popup.html"));
  await cp(resolve(root, "src/styles.css"), resolve(out, "styles.css"));
}

if (watch) {
  await Promise.all(ctxs.map((c) => c.watch()));
  await copyStatic();
  console.log("watching…");
} else {
  await Promise.all(ctxs.map((c) => c.rebuild()));
  await copyStatic();
  await Promise.all(ctxs.map((c) => c.dispose()));
  console.log("built ->", out);
}
