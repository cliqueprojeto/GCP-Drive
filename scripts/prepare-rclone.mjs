import { mkdir, writeFile, copyFile, chmod, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import extract from "extract-zip";
const version = "1.75.2";
const os = { win32: "windows", linux: "linux", darwin: "osx" }[
  process.platform
];
const arch = { x64: "amd64", arm64: "arm64" }[process.arch];
if (!os || !arch) throw new Error("Plataforma não suportada.");
const name = `rclone-v${version}-${os}-${arch}.zip`;
const folder = path.resolve(`vendor/${process.platform}-${process.arch}`);
const base = `https://downloads.rclone.org/v${version}/`;
async function download(url, max) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Download falhou: ${response.status}`);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > max) throw new Error("Download excedeu o limite.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
const sums = (await download(base + "SHA256SUMS", 1024 * 1024)).toString(
  "utf8",
);
const line = sums
  .split(/\r?\n/)
  .find((line) => line.trim().endsWith(" " + name));
const expected = line?.trim().split(/\s+/)[0];
if (!expected || !/^[0-9a-f]{64}$/i.test(expected))
  throw new Error("Checksum oficial ausente.");
const bytes = await download(base + name, 128 * 1024 * 1024);
const actual = createHash("sha256").update(bytes).digest("hex");
if (actual !== expected.toLowerCase())
  throw new Error("Checksum rclone inválido.");
await mkdir(folder, { recursive: true });
const archive = path.join(folder, "download.zip");
await writeFile(archive, bytes);
const extracted = path.join(folder, "extracted");
await extract(archive, { dir: extracted });
const binary = process.platform === "win32" ? "rclone.exe" : "rclone";
const source = path.join(extracted, `rclone-v${version}-${os}-${arch}`, binary);
await copyFile(source, path.join(folder, binary));
if (process.platform !== "win32") await chmod(path.join(folder, binary), 0o755);
await writeFile(path.join(folder, "SHA256SUMS"), sums);
await writeFile(
  path.join(folder, "provenance.json"),
  JSON.stringify({ version, url: base + name, sha256: actual }, null, 2),
);
await copyFile("THIRD_PARTY_NOTICES.md", path.join(folder, "LICENSES.md"));
console.log(`rclone ${version}: SHA-256 verificado (${actual}).`);
