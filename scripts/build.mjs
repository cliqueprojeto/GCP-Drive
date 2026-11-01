import { build } from "esbuild";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  target: "node24",
});
await build({
  entryPoints: ["src/preload.ts"],
  outfile: "dist/preload.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  target: "node24",
});
await build({
  entryPoints: ["src/ui.tsx"],
  outfile: "dist/ui.js",
  bundle: true,
  platform: "browser",
  target: "chrome140",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".woff2": "file" },
});
await copyFile("scripts/password.cjs", "dist/password.cjs");
await writeFile(
  "dist/index.html",
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>GCP-Drive</title><link rel="stylesheet" href="ui.css"></head><body><div id="root"></div><script src="ui.js"></script></body></html>`,
);
console.log("GCP-Drive compilado.");
