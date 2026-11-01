import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  utimes,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { FolderSyncManager } from "../src/folder-sync.ts";
const exec = promisify(execFile);
const root = await mkdtemp(path.join(tmpdir(), "gcp-drive-bisync-"));
const local = path.join(root, "Local");
const cloud = path.join(root, "Cloud");
await mkdir(local);
await mkdir(path.join(cloud, "Dados"), { recursive: true });
const binary = path.resolve(
  "vendor",
  `${process.platform}-${process.arch}`,
  process.platform === "win32" ? "rclone.exe" : "rclone",
);
const config = path.join(root, "rclone.conf");
await writeFile(config, "");
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => !k.toUpperCase().startsWith("RCLONE_"),
  ),
);
async function command(args) {
  return (
    await exec(binary, [...args, "--config", config], {
      env,
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
    })
  ).stdout;
}
await command([
  "config",
  "create",
  "cloud",
  "alias",
  "remote",
  cloud,
  "--non-interactive",
  "--no-output",
]);
for (const name of ["Constante.txt", "Disputa.txt"]) {
  await writeFile(path.join(local, name), "original");
  await writeFile(path.join(cloud, "Dados", name), "original");
}
await writeFile(path.join(local, "Só local.txt"), "do computador");
await writeFile(path.join(cloud, "Dados", "Só nuvem.txt"), "da nuvem");
const plan = {
  id: "sync-local-test",
  accountId: "account",
  localPath: local,
  remotePath: "Dados",
  enabled: false,
  initialized: false,
};
const manager = new FolderSyncManager(
  path.join(root, "state"),
  {
    plans: () => [plan],
    remote: async () => "cloud:Dados",
    list: async (target) =>
      JSON.parse(
        await command(["lsjson", target, "--recursive", "--files-only"]),
      ),
    execute: async (args) => {
      await command(args);
    },
    persist: async () => {},
    record: () => {},
  },
  60000,
);
try {
  const preview = await manager.preview(plan.id);
  assert.equal(preview.localFiles, 3);
  assert.equal(preview.cloudFiles, 3);
  assert.equal(preview.sameNames, 2);
  await assert.rejects(readFile(path.join(local, "Só nuvem.txt")));
  await manager.start(plan.id);
  await manager.settle();
  assert.equal(manager.snapshot()[0].phase, "idle");
  assert.equal(
    await readFile(path.join(local, "Só nuvem.txt"), "utf8"),
    "da nuvem",
  );
  assert.equal(
    await readFile(path.join(cloud, "Dados", "Só local.txt"), "utf8"),
    "do computador",
  );
  await manager.pause(plan.id);
  await writeFile(path.join(local, "Só local.txt"), "edição local");
  await utimes(
    path.join(local, "Só local.txt"),
    new Date(),
    new Date(Date.now() + 10000),
  );
  await writeFile(
    path.join(cloud, "Dados", "Novo da nuvem.txt"),
    "nova versão remota",
  );
  await manager.start(plan.id);
  await manager.settle();
  assert.equal(
    await readFile(path.join(cloud, "Dados", "Só local.txt"), "utf8"),
    "edição local",
  );
  assert.equal(
    await readFile(path.join(local, "Novo da nuvem.txt"), "utf8"),
    "nova versão remota",
  );
  await manager.pause(plan.id);
  await writeFile(path.join(local, "Disputa.txt"), "versão local concorrente");
  await utimes(
    path.join(local, "Disputa.txt"),
    new Date(),
    new Date(Date.now() + 20000),
  );
  await writeFile(
    path.join(cloud, "Dados", "Disputa.txt"),
    "versão remota concorrente",
  );
  await utimes(
    path.join(cloud, "Dados", "Disputa.txt"),
    new Date(),
    new Date(Date.now() + 30000),
  );
  await manager.start(plan.id);
  await manager.settle();
  assert.equal(manager.snapshot()[0].phase, "idle");
  const contents = await Promise.all(
    (await readdir(local)).map((name) =>
      readFile(path.join(local, name), "utf8"),
    ),
  );
  assert.ok(contents.includes("versão local concorrente"));
  assert.ok(contents.includes("versão remota concorrente"));
  await manager.pause(plan.id);
  console.log(
    JSON.stringify({
      passed: true,
      scope:
        "rclone bisync real com fixtures locais: prévia sem cópia, ida/volta, edição e preservação das duas versões concorrentes; sem cloud real",
      profile: root,
    }),
  );
} finally {
  manager.stopTimers();
}
