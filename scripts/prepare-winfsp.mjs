import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
if (process.platform !== "win32")
  throw new Error(
    "O preparo do instalador WinFsp deve ser executado no Windows para verificar sua assinatura.",
  );
const url =
  "https://github.com/winfsp/winfsp/releases/download/v2.1/winfsp-2.1.25156.msi";
const expected =
  "073a70e00f77423e34bed98b86e600def93393ba5822204fac57a29324db9f7a";
const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
if (!response.ok)
  throw new Error("Não foi possível baixar o instalador oficial WinFsp.");
const chunks = [];
let bytes = 0;
for await (const chunk of response.body) {
  bytes += chunk.length;
  if (bytes > 20 * 1024 * 1024)
    throw new Error("Instalador excedeu o tamanho esperado.");
  chunks.push(chunk);
}
const contents = Buffer.concat(chunks);
if (createHash("sha256").update(contents).digest("hex") !== expected)
  throw new Error(
    "A identidade do instalador WinFsp não corresponde à versão validada.",
  );
const folder = path.resolve("vendor/win32-x64");
await mkdir(folder, { recursive: true });
const file = path.join(folder, "winfsp.msi");
await writeFile(file, contents);
const powershell = path.join(
  process.env.SystemRoot ?? "C:/Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
await promisify(execFile)(
  powershell,
  [
    "-NoProfile",
    "-NonInteractive",
    "-File",
    path.resolve("scripts/verify-winfsp.ps1"),
    "-Path",
    file,
  ],
  { windowsHide: true, timeout: 30000 },
);
await writeFile(
  path.join(folder, "winfsp-provenance.json"),
  JSON.stringify(
    { version: "2.1.25156", url, sha256: expected, signer: "NAVIMATICS LLC" },
    null,
    2,
  ),
);
console.log("WinFsp oficial baixado e validado. Nenhum driver foi instalado.");
