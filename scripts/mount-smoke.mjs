import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { mountArgs } from "../src/core.ts";
import {
  chooseDriveLetter,
  logicalDrives,
  mountVisible,
  pendingWrites,
} from "../src/mount-platform.ts";

const exec = promisify(execFile);
const windows = process.platform === "win32";
if (!windows && process.platform !== "linux")
  throw Error("Este ensaio requer WinFsp no Windows ou FUSE no Linux.");
const useKio = !windows && process.env.GCP_MOUNT_SMOKE_KIO === "1";
const binary = path.resolve(
  process.env.GCP_MOUNT_SMOKE_RCLONE ??
    path.join("vendor", `${process.platform}-${process.arch}`, windows ? "rclone.exe" : "rclone"),
);
const root = await mkdtemp(path.join(tmpdir(), "gcp-mounted-"));
let child;
let closed;
let exited = false;
let error = "";
let target;

try {
  const source = path.join(root, "source");
  await mkdir(path.join(source, "Documentos"), { recursive: true });
  for (let i = 0; i < 200; i++)
    await writeFile(path.join(source, "Documentos", `Documento ${i}.txt`), `conteúdo de teste ${i}`);
  const fileBytes = 4 * 1024 * 1024;
  await writeFile(path.join(source, "Arquivo grande.bin"), Buffer.alloc(fileBytes, 7));

  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const mount = windows ? chooseDriveLetter(await logicalDrives(), "V:") : path.join(root, "Montagem local");
  target = windows ? mount + "\\" : mount;
  if (!windows) await mkdir(mount);
  const key = randomBytes(32).toString("hex");
  const config = path.join(root, "fixture.conf");
  await writeFile(config, "", { mode: 0o600 });
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith("RCLONE_")));
  child = spawn(binary, [
    ...mountArgs({ id: "fixture", label: "Ensaio GCP-Drive", provider: "dropbox", autoMount: false }, mount, path.join(root, "cache"), source),
    "--config", config, "--rc", "--rc-addr", `127.0.0.1:${port}`,
  ], {
    windowsHide: true,
    env: { ...env, RCLONE_RC_USER: "fixture", RCLONE_RC_PASS: key },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", (data) => { error = (error + data).slice(-2000); });
  child.on("error", (cause) => { error = cause.message; });
  closed = new Promise((resolve) => child.once("close", () => {
    exited = true;
    resolve();
  }));

  async function rc(action, body = {}) {
    const result = await fetch(`http://127.0.0.1:${port}/${action}`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from("fixture:" + key).toString("base64"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!result.ok) throw Error(await result.text());
    return result.json();
  }
  async function until(check) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (exited) throw Error("Montagem encerrada: " + error);
      try {
        if (await check()) return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw Error("Tempo de espera da montagem excedido: " + error);
  }

  try {
    await until(async () => !!(await rc("vfs/stats")));
    await until(() => mountVisible(target));
    const timings = {};
    async function timed(name, work) {
      const start = performance.now();
      const result = await work();
      timings[name] = Math.round((performance.now() - start) * 100) / 100;
      return result;
    }
    const docs = path.join(target, "Documentos");
    const file = path.join(target, "Arquivo grande.bin");
    assert.equal((await timed("coldDirectoryMs", () => readdir(docs))).length, 200);
    await timed("warmDirectoryMs", () => readdir(docs));
    assert.equal((await timed("coldFileMs", () => readFile(file))).length, fileBytes);
    assert.equal((await timed("warmFileMs", () => readFile(file))).length, fileBytes);

    const panel = await exec(binary, ["lsjson", docs, "--max-depth", "1", "--no-mimetype", "--config", config], {
      windowsHide: true, env, timeout: 10000,
    });
    assert.equal(JSON.parse(panel.stdout).length, 200);
    const newFile = "Novo arquivo.txt";
    const content = "edição feita pela unidade";
    await writeFile(path.join(docs, newFile), content);
    if (useKio) {
      const kio = (...args) => exec("kioclient", ["--platform", "offscreen", ...args], { timeout: 5000 });
      assert.match((await kio("ls", docs)).stdout, /Documento 199.txt/);
      assert.equal((await kio("cat", path.join(docs, newFile))).stdout, content);
      await kio("copy", path.join(docs, newFile), path.join(docs, "Cópia KIO.txt"));
    }
    const sourceDocs = path.join(source, "Documentos");
    await until(async () => !pendingWrites(await rc("vfs/stats")));
    assert.equal(await readFile(path.join(sourceDocs, newFile), "utf8"), content);
    if (useKio) assert.equal(await readFile(path.join(sourceDocs, "Cópia KIO.txt"), "utf8"), content);
    await writeFile(path.join(sourceDocs, "Arquivo externo.txt"), "externo");
    await rc("vfs/refresh", { dir: "Documentos" });
    assert.ok((await readdir(docs)).includes("Arquivo externo.txt"));
    const report = {
      passed: true,
      scope: `Unidade real ${windows ? "WinFsp" : "FUSE"} com origem local; sem rede, nuvem ou interface gráfica`,
      directoryFiles: 200, fileBytes, timings, kio: useKio, platform: process.platform,
    };
    await mkdir(".local", { recursive: true });
    await writeFile(".local/mount-benchmark.json", JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    if (!exited) {
      await rc("core/quit").catch(() => {});
      await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 10000).unref())]);
      if (!exited) child.kill();
    }
    await closed;
  }
} finally {
  if (!target || !(await mountVisible(target))) await rm(root, { recursive: true, force: true });
  else throw Error(`A unidade de teste continua montada; fixture preservada em ${root}.`);
}
