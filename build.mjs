// Build script: bundles lib/index.ts into ESM and UMD formats using esbuild
import { build } from "esbuild";

const sharedOptions = {
  entryPoints: ["lib/index.ts"],
  bundle: true,
  sourcemap: true,
  target: ["es2022", "chrome89", "firefox89", "safari15"],
  // All provider fetch calls go to external URLs; no external npm deps needed.
  external: [],
};

// ESM bundle — for import via <script type="module"> or bundlers
await build({
  ...sharedOptions,
  format: "esm",
  outfile: "dist/freellm.esm.js",
  minify: false,
});

// Minified ESM bundle — for CDN/production use
await build({
  ...sharedOptions,
  format: "esm",
  outfile: "dist/freellm.esm.min.js",
  minify: true,
});

// UMD/IIFE bundle — exposes all named exports under the `FreeLLM` global namespace
// Usage: <script src="freellm.umd.js"></script>
//        new FreeLLM.FreeLLM({ groq: "..." })
await build({
  ...sharedOptions,
  format: "iife",
  globalName: "FreeLLM",
  outfile: "dist/freellm.umd.js",
  minify: false,
});

// Minified UMD bundle
await build({
  ...sharedOptions,
  format: "iife",
  globalName: "FreeLLM",
  outfile: "dist/freellm.umd.min.js",
  minify: true,
});

console.log("✓ Built dist/freellm.{esm,umd}.{js,min.js}");
