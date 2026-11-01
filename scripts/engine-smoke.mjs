import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import {createPrivateRemote} from '../src/private-auth.ts';
const exec = promisify(execFile);
const root = await mkdtemp(path.join(tmpdir(), "gcp-drive-engine-"));
const config = path.join(root, "rclone.conf");
const secret = randomBytes(32).toString("base64url");
const binary = path.resolve(
  "vendor",
  `${process.platform}-${process.arch}`,
  process.platform === "win32" ? "rclone.exe" : "rclone",
);
const env = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !k.toUpperCase().startsWith("RCLONE_"),
    ),
  ),
  RCLONE_CONFIG_PASS: secret,
  GCP_VAULT_PASSWORD: secret,
};
async function run(args,maxBuffer=1024*1024) {
  return (
    await exec(binary, [...args, "--config", config], {
      env,
      windowsHide: true,
      timeout: 15000,
      maxBuffer,
    })
  ).stdout;
}
await writeFile(config, "", { mode: 0o600 });
await run([
  "config",
  "encryption",
  "set",
  "--password-command",
  `"${process.execPath}" "${path.resolve("scripts/password.cjs")}"`,
]);
assert.match(await readFile(config, "utf8"), /RCLONE_ENCRYPT_V0:/);
const mine = path.join(root, "Meu espaço");
const shared = path.join(root, "Equipe");
await mkdir(mine);
await mkdir(shared);
await createPrivateRemote(binary,config,env,'loopback-fixture','alias',{remote:mine},new AbortController().signal);
assert.match(await readFile(config,'utf8'),/RCLONE_ENCRYPT_V0:/);
const catalogue=JSON.parse(await run(['config','providers'],8*1024*1024));
for(const name of ['mega','protondrive'])assert.ok(catalogue.some(provider=>provider.Name===name),name+' must be in the bundled engine');
await writeFile(path.join(mine, "Prestação de contas.txt"), "fixture local");
await writeFile(
  path.join(shared, "Contrato cultural.txt"),
  "fixture compartilhada local",
);
for (const [name, folder] of [
  ["mine", mine],
  ["team", shared],
])
  await run([
    "config",
    "create",
    name,
    "alias",
    "remote",
    folder,
    "--non-interactive",
    "--no-output",
  ]);
await run([
  "config",
  "create",
  "workspace",
  "combine",
  "upstreams",
  '"Meu Drive=mine:" "Drives compartilhados=team:"',
  "--non-interactive",
  "--no-output",
]);
const top = JSON.parse(await run(["lsjson", "workspace:", "--max-depth", "1"]));
assert.deepEqual(top.map((e) => e.Name).sort(), [
  "Drives compartilhados",
  "Meu Drive",
]);
const files = JSON.parse(
  await run(["lsjson", "workspace:Meu Drive", "--max-depth", "1"]),
);
assert.equal(files[0].Name, "Prestação de contas.txt");
assert.match(await readFile(config, "utf8"), /RCLONE_ENCRYPT_V0:/);
console.log(
  JSON.stringify({
    passed: true,
    scope: "rclone real com fixtures locais; sem OAuth, cloud ou mount",
    profile: root,
  }),
);
