import { _electron } from "playwright-core";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import assert from "node:assert/strict";
import electron from "electron";
const profile = await mkdtemp(path.join(tmpdir(), "gcp-drive-disconnect-"));
const root = path.join(profile, "workspace");
const cloud = path.join(profile, "cloud-fixture");
await mkdir(cloud);
await mkdir(path.join(cloud,'Projetos de teste'));
await writeFile(path.join(cloud,'Planilha de teste.csv'),'nome,valor\nteste,10');
await writeFile(
  path.join(cloud, "Contrato de teste.txt"),
  "arquivo que deve permanecer",
);
const secret = randomBytes(32).toString("base64url");
const id = "gcp-" + randomUUID();
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
async function launch() {
  return _electron.launch({
    executablePath: electron,
    args: [".", `--gcp-test-profile=${profile}`, "--lang=pt-BR"],
    env,
    timeout: 30000,
  });
}
async function close(app) {
  const event = app.waitForEvent("close", { timeout: 15000 });
  await app.evaluate(({ app }) => app.quit()).catch(() => {});
  await event;
}
let app = await launch();
try {
  const first = await app.firstWindow();
  await first
    .getByRole("heading", { name: "Seu trabalho flui melhor aqui." })
    .waitFor();
  await app.evaluate(
    async ({ safeStorage }, { root, secret }) => {
      const fs = process.getBuiltinModule("fs/promises");
      const path = process.getBuiltinModule("path");
      await fs.writeFile(
        path.join(root, "vault.key"),
        safeStorage.encryptString(secret),
      );
    },
    { root, secret },
  );
  await close(app);
  const config = path.join(root, "rclone.conf");
  await writeFile(config, "", { mode: 0o600 });
  const binary = path.resolve("vendor", `${process.platform}-${process.arch}`, process.platform === "win32" ? "rclone.exe" : "rclone");
  const engineEnv = {
    ...Object.fromEntries(
      Object.entries(env).filter(
        ([k]) => !k.toUpperCase().startsWith("RCLONE_"),
      ),
    ),
    RCLONE_CONFIG_PASS: secret,
    GCP_VAULT_PASSWORD: secret,
  };
  const exec = promisify(execFile);
  async function run(args) {
    return (
      await exec(binary, [...args, "--config", config], {
        env: engineEnv,
        windowsHide: true,
        timeout: 15000,
      })
    ).stdout;
  }
  await run([
    "config",
    "encryption",
    "set",
    "--password-command",
    `"${process.execPath}" "${path.resolve("scripts/password.cjs")}"`,
  ]);
  await run([
    "config",
    "create",
    id,
    "alias",
    "remote",
    cloud,
    "--non-interactive",
    "--no-output",
  ]);
  await writeFile(
    path.join(root, "preferences.json"),
    JSON.stringify({
      version: 1,
      accounts: [
        { id, label: "Conta de teste", provider: "dropbox", autoMount: false },
      ],
      favorites: [],
      language: "pt-BR",
      startAtLogin: false,
      folderPlans: [],
      loginDrafts: [],
    }),
  );
  app = await launch();
  const page = await app.firstWindow();
  await page
    .getByRole("heading", { name: "Conta de teste", exact: true })
    .waitFor();
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async (owner, options) => ({
      response: (options ?? owner).message?.startsWith("Desconectar ") ? 1 : 0,
      checkboxChecked: false,
    });
  });
  await page
    .getByRole("button", { name: "Meus arquivos", exact: true })
    .last()
    .click();
  await page
    .getByText("Contrato de teste.txt", { exact: true })
    .waitFor({ timeout: 10000 });
  const icons = await page.evaluate(()=>window.gcpDrive.call('fileIcons',{keys:['folder','file:.txt']}));
  assert.equal(icons.ok, true);
  if (process.platform === "linux" && icons.value["file:.txt"] === "")
    await page.locator(".system-icon").filter({ hasText: "📄" }).first().waitFor();
  else assert.match(icons.value["file:.txt"], /^data:image\//);
  await page.getByLabel('Visualizar arquivos').selectOption('gallery');
  await page.locator('.layout-gallery').waitFor();
  await mkdir('.local',{recursive:true});await page.screenshot({path:'.local/new-file-browser.png'});
  await page.getByLabel('Classificar arquivos').selectOption('size');
  await page.getByText('Contrato de teste.txt',{exact:true}).click();
  await page.locator('.selection-toolbar').getByRole('button',{name:'Renomear',exact:true}).click();
  await page.getByLabel('Novo nome').fill('Contrato renomeado.txt');
  await page.getByRole('button',{name:'Salvar nome',exact:true}).click();
  await page.getByText('Contrato renomeado.txt',{exact:true}).waitFor();
  assert.equal(await readFile(path.join(cloud,'Contrato renomeado.txt'),'utf8'),'arquivo que deve permanecer');
  const renamed = await page.evaluate(({id})=>window.gcpDrive.call('rename',{accountId:id,path:'Contrato renomeado.txt',name:'Contrato de teste.txt'}),{id});assert.equal(renamed.ok,true);
  const favorite=await page.evaluate(({id})=>window.gcpDrive.call('favorite',{accountId:id,path:'',name:'Raiz de teste'}),{id});assert.equal(favorite.ok,true);
  for(const name of ['Projetos de teste','Planilha de teste.csv']){
    const result=await page.evaluate(({id,name})=>window.gcpDrive.call('favorite',{accountId:id,path:name,name}),{id,name});assert.equal(result.ok,true);
  }
  const navigation = await page.locator('aside nav button').allTextContents();
  assert.deepEqual(navigation.slice(0,3).map(value=>value.replace(/[\uE000-\uF8FF]/g,'').trim()),['Visão geral','Contas e armazenamento','Meus arquivos']);
  await page.locator('aside nav').getByRole('button',{name:'Contas e armazenamento',exact:true}).click();
  await page.getByRole('heading',{name:'Contas e armazenamento',exact:true}).waitFor();
  assert.equal(await page.locator('.account-manager').count(),1);
  await page.getByRole('button',{name:'Favoritos',exact:true}).click();
  assert.equal(await page.locator('.account-manager').count(),0);
  await page.getByRole('table',{name:'Favoritos',exact:true}).waitFor();
  await page.getByLabel('Classificar favoritos').selectOption('type');
  const names=await page.locator('.favorites-browser tbody .favorite-open').allTextContents();
  assert.equal(names[0],'Planilha de teste.csv');
  await page.getByLabel('Inverter ordem dos favoritos').click();
  assert.equal((await page.locator('.favorites-browser tbody .favorite-open').allTextContents()).at(-1),'Planilha de teste.csv');
  await page.getByLabel('Visualizar favoritos').selectOption('list');
  assert.equal(await page.locator('.favorites-browser tbody tr').first().locator('td').nth(1).isVisible(),false);
  await page.getByLabel('Visualizar favoritos').selectOption('gallery');
  assert.equal(await page.locator('.favorites-browser tbody').evaluate(element=>getComputedStyle(element).display),'grid');
  await page.screenshot({path:'.local/new-favorites-gallery.png'});
  await page.getByLabel('Pesquisar favoritos').fill('NÃO ENCONTRAR');
  await page.getByRole('heading',{name:'Nenhum favorito encontrado.'}).waitFor();
  await page.getByLabel('Pesquisar favoritos').fill('');
  await page.getByLabel('Visualizar favoritos').selectOption('details');
  await page.screenshot({path:'.local/new-favorites-details.png'});
  for(const name of ['Projetos de teste','Planilha de teste.csv'])await page.getByRole('button',{name:'Remover dos favoritos: '+name,exact:true}).click();
  await page.getByRole('button',{name:'Remover dos favoritos: Raiz de teste'}).click();
  await page.getByRole('heading',{name:'Você ainda não fixou pastas.'}).waitFor();
  await page.getByRole('button',{name:'Visão geral',exact:true}).click();
  assert.equal(await page.locator('.account-manager').count(),0);
  await page.locator('.hero').waitFor();
  await page.getByRole("button", { name: "Preferências", exact: true }).click();
  await page.getByLabel('Nome da conta Conta de teste').fill('Conta renomeada');
  await page.getByRole('button',{name:'Salvar nome',exact:true}).click();
  await page.getByLabel('Nome da conta Conta renomeada').waitFor();
  const saved=await page.evaluate(()=>window.gcpDrive.call('snapshot',null));
  assert.equal(saved.value.preferences.accounts[0].id,id);
  assert.equal(saved.value.preferences.accounts[0].label,'Conta renomeada');
  await page.getByRole('button',{name:'Sobre e licenças'}).click();
  await page.getByRole('heading',{name:'Apoie o projeto'}).waitFor();
  assert.equal(await page.locator('.pix-qr').evaluate(img=>img.complete&&img.naturalWidth>0),true);
  await page.screenshot({path:'.local/new-about.png'});
  await page.getByRole('button',{name:'Fechar licenças'}).click();
  await page
    .getByRole("button", { name: "Desconectar conta", exact: true })
    .click();
  let completed = false;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const r = await page.evaluate(() => window.gcpDrive.call("snapshot", null));
    if (
      r.ok &&
      r.value.preferences.accounts.length === 0 &&
      r.value.activity.some((a) =>
        a.message.startsWith("Conta desconectada deste computador:"),
      )
    ) {
      completed = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(
    completed,
    true,
    "A operação de desconexão precisa concluir e persistir antes da verificação.",
  );
  assert.equal(
    await readFile(path.join(cloud, "Contrato de teste.txt"), "utf8"),
    "arquivo que deve permanecer",
  );
  const configAfter = JSON.parse(await run(["config", "dump"]));
  assert.equal(id in configAfter, false);
  await close(app);
  app = undefined;
  console.log(
    JSON.stringify({
      passed: true,
      scope:
        "Electron e rclone reais com alias local: navegar, desconectar, remover credencial local e preservar arquivo; sem Dropbox real",
      profile,
    }),
  );
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    await mkdir(".local", { recursive: true });
    await page.screenshot({ path: ".local/disconnect-failure.png" });
    console.log(
      JSON.stringify({
        profile,
        alerts: await page.locator('[role="alert"]').allTextContents(),
      }),
    );
  }
  throw error;
} finally {
  if (app) await app.evaluate(({ app }) => app.exit(1)).catch(() => {});
}
