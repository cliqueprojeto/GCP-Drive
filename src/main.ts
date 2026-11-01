import {UserError,userMessage} from './user-error.ts';
import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  safeStorage,
  Tray,
  Menu,
  nativeImage,
  clipboard,
} from "electron";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import {
  readFile,
  writeFile,
  mkdir,
  rename,
  copyFile,
  access,
  chmod,
  realpath,
  stat,
  rm,
} from "node:fs/promises";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { createServer } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  Account,
  Preferences,
  Snapshot,
  MountState,
  Activity,
  Question,
  Operations,
  FolderPlan,
} from "./contracts.ts";
import {
  mountArgs,
  parseEntries,
  parseFolderListing,
  provider,
  relativePath,
  systemLanguage,
  withinMount,
  syncObservation,
  sharedUpstreams,
} from "./core.ts";
import { FileIndex } from "./index-store.ts";
import { NativeIcons } from './native-icons.ts';
import { mountTelemetry } from './mount-telemetry.ts';
import { ListingCache } from './listing-cache.ts';
import { setDriveIcon,removeDriveIcon } from './drive-icon.ts';
import { windowsNavigation } from './windows-navigation.ts';
import { windowsContext } from './windows-context.ts';
import { providers } from './providers.ts';
import { createPrivateRemote } from './private-auth.ts';
import {PIX,STRIPE,WEBSITE} from './support.ts';
import {assertCleanCache} from './cache-safety.ts';
import {installLinuxShell,writeLinuxShellState} from './linux-shell.ts';
import {builtinThemes,parseTheme} from './themes.ts';
import {AppUpdates,updateDue} from './updates.ts';
import {ActivityStore} from './activity-store.ts';
import { linuxAutostart } from "./autostart.ts";
import { FolderSyncManager, overlaps, remoteOverlaps } from "./folder-sync.ts";
import { executeCommand, CommandFailure, CommandGroup } from "./command.ts";
import { localizeQuestion } from "./oauth-questions.ts";
import {
  detectMountSupport,
  chooseDriveLetter,
  logicalDrives,
  ensureEmptyMountDirectory,
  pendingWrites,
} from "./mount-platform.ts";
import type { MountSupport } from "./mount-platform.ts";

const testProfile = app.commandLine.getSwitchValue("gcp-test-profile");
if (testProfile && !app.isPackaged) {
  if (!path.isAbsolute(testProfile))
    throw new UserError("Perfil de teste precisa ser absoluto.");
  app.setPath("userData", testProfile);
}
const root = path.join(app.getPath("userData"), "workspace");
const prefsFile = path.join(root, "preferences.json");
const configFile = path.join(root, "rclone.conf");
let prefs: Preferences;
let window: BrowserWindow;
let tray: Tray;
let index: FileIndex;
let icons: NativeIcons;
let folderSync: FolderSyncManager;
let updates:AppUpdates;
let activityStore:ActivityStore|undefined;
let saves = Promise.resolve();
let secret = "";
let engine: Snapshot["engine"] = { available: false };
let mountSupport: MountSupport = {
  available: false,
  message: "Verificando o suporte a unidades virtuais.",
};
const mountFailures = new Map<string, MountState>();
const activity: Activity[] = [];
type OwnedMount = {
  state: MountState;
  child: ChildProcess;
  endpoint: string;
  auth: string;
};
const mounts = new Map<string, OwnedMount>();
const commands = new CommandGroup();
const longCommands = new Set<ChildProcess>();
const listings = new ListingCache();
let requestedView = "home";
type LoginSession = {
  account: Account;
  question: Question;
  cancelled: boolean;
  controller?: AbortController;
  active?: Promise<Question>;
  cleanup?: Promise<void>;
};
const pending = new Map<string, LoginSession>();
let vaultReady = false;
let quitting = false;
let quittingInProgress = false;
let mutation = Promise.resolve();
let loginEpoch = 0;

function record(message: string, level: Activity["level"] = "info",details:Pick<Activity,'accountId'|'path'|'kind'>={},eventKey?:string) {
  const event={at:new Date().toISOString(),message,level,...details};
  try{if(activityStore){activityStore.add(event,eventKey);return;}}catch{/* Keep recent records in memory if local storage is unavailable. */}
  activity.unshift(event);activity.splice(500);
}
async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}
async function save() {
  const contents = JSON.stringify(prefs, null, 2);
  const work = saves.then(async () => {
    if (await exists(prefsFile)) await copyFile(prefsFile, prefsFile + ".bak");
    await writeFile(prefsFile + ".new", contents, { mode: 0o600 });
    await rename(prefsFile + ".new", prefsFile);
  });
  saves = work.catch(() => {});
  await work;
}
async function runSync(args: string[]): Promise<void> {
  await vault();
  return new Promise((resolve, reject) => {
    const child = spawn(
      executable(),
      [...args, "--config", configFile, "--log-level", "ERROR"],
      {
        shell: false,
        windowsHide: true,
        env: childEnv(),
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    longCommands.add(child);
    let failed=false;
    child.stderr?.on("data", () => {});
    child.once("error", () => {failed=true;});
    child.once("close", (code) => {
      longCommands.delete(child);
      code === 0 && !failed
        ? resolve()
        : reject(
            new UserError(
              `A transferência foi interrompida (código ${code ?? "desconhecido"}). Os dados locais e o histórico foram preservados.`,
            ),
          );
    });
  });
}
function executable() {
  return (
    prefs.rclonePath ||
    (app.isPackaged
      ? path.join(
          process.resourcesPath,
          "rclone",
          process.platform === "win32" ? "rclone.exe" : "rclone",
        )
      : path.join(
          app.getAppPath(),
          "vendor",
          `${process.platform}-${process.arch}`,
          process.platform === "win32" ? "rclone.exe" : "rclone",
        ))
  );
}
function childEnv(extra: Record<string, string> = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.toUpperCase().startsWith("RCLONE_"),
    ),
  );
  return { ...env, RCLONE_CONFIG_PASS: secret, ...extra };
}
async function run(
  args: string[],
  timeout = 45000,
  extra: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<string> {
  return commands.execute(executable(), [...args, "--config", configFile], {
    timeout,
    env: childEnv(extra),
    signal,
  });
}
async function detect() {
  try {
    const version = (await run(["version"], 10000)).split("\n")[0];
    engine = { available: true, version };
  } catch {
    engine = {
      available: false,
      error: "Selecione o rclone para conectar suas contas.",
    };
  }
}
async function vault() {
  if (vaultReady) return;
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === "linux" &&
      safeStorage.getSelectedStorageBackend() === "basic_text")
  )
    throw new UserError(
      "Ative o cofre seguro do sistema (Keychain, Credential Manager ou Secret Service).",
    );
  const keyFile = path.join(root, "vault.key");
  if (await exists(keyFile))
    secret = safeStorage.decryptString(await readFile(keyFile));
  else {
    if (await exists(configFile))
      throw new UserError(
        "Configuração existente sem chave. Restaure o backup do cofre antes de continuar.",
      );
    secret = randomBytes(32).toString("base64url");
    await writeFile(keyFile, safeStorage.encryptString(secret), {
      mode: 0o600,
      flag: "wx",
    });
  }
  if (!(await exists(configFile))) {
    await writeFile(configFile, "", { mode: 0o600, flag: "wx" });
    const command = `"${process.execPath}" "${path.join(__dirname, "password.cjs")}"`;
    await run(
      ["config", "encryption", "set", "--password-command", command],
      10000,
      { ELECTRON_RUN_AS_NODE: "1", GCP_VAULT_PASSWORD: secret },
    );
  }
  if (!(await readFile(configFile, "utf8")).includes("RCLONE_ENCRYPT_V0:"))
    throw new UserError(
      "O cofre ainda não está criptografado. Nenhuma conta será conectada.",
    );
  vaultReady = true;
}
function getAccount(value: unknown): Account {
  const account = prefs.accounts.find((a) => a.id === value);
  if (!account) throw new UserError("Conta não encontrada.");
  return account;
}
function question(raw: string): Question {
  const data: unknown = JSON.parse(raw);
  if (
    !data ||
    typeof data !== "object" ||
    !("State" in data) ||
    typeof data.State !== "string"
  )
    throw new UserError("Resposta de autenticação inválida.");
  const q = data as Question;
  if (
    q.Option &&
    (typeof q.Option.Name !== "string" ||
      typeof q.Option.Help !== "string" ||
      (q.Option.Examples &&
        (!Array.isArray(q.Option.Examples) ||
          !q.Option.Examples.every(
            (e) => typeof e.Value === "string" && typeof e.Help === "string",
          ))))
  )
    throw new UserError("Pergunta de autenticação inválida.");
  return {
    State: q.State,
    Option: q.Option,
    Error: q.Error
      ? "O provedor não aceitou a resposta. Tente novamente."
      : undefined,
  };
}
async function finish(id: string, q: Question) {
  const item = pending.get(id)!;
  item.question = q;
  if (q.Error) throw new UserError(q.Error);
  if (!q.State) {
    if (item.cancelled)
      throw new CommandFailure("cancelled", "Conexão cancelada.");
    if (!prefs.accounts.some((a) => a.id === id))
      prefs.accounts.push(item.account);
    prefs.loginDrafts = (prefs.loginDrafts ?? []).filter((a) => a.id !== id);
    await save();
    pending.delete(id);
    record(`Conta conectada: ${item.account.label}`);
    window?.show();
    window?.focus();
    mountSupport = await detectMountSupport();
    if (!mountSupport.available) {
      q.MountMessage = mountSupport.message;
      mountFailures.set(id, {
        accountId: id,
        phase: "error",
        path: "",
        sync: "problem",
        message: mountSupport.message,
      });
      record(mountSupport.message, "error");
    } else {
      // Join the existing mutation owner after this login step has committed.
      setImmediate(() => {
        mutation = mutation.then(async () => {
          if (!prefs.accounts.some((a) => a.id === id)) return;
          try {
            await mount(item.account);
          } catch (e) {
            const message =
              e instanceof Error
                ? userMessage(e)
                : "Não foi possível montar a unidade.";
            mountFailures.set(id, {
              accountId: id,
              phase: "error",
              path: "",
              sync: "problem",
              message,
            });
            record(`${item.account.label}: ${message}`, "error");
          }
        });
      });
    }
  }
  return localizeQuestion(q, prefs.language, item.account.provider);
}
async function authTemplate() {
  const target = path.join(root, "authorization.html");
  await writeFile(
    target,
    await readFile(path.join(app.getAppPath(), "assets", "auth-complete.html")),
    { mode: 0o600 },
  );
  return target;
}
async function cleanupLogin(session: LoginSession) {
  if (prefs.accounts.some((a) => a.id === session.account.id)) return;
  if (session.cleanup) return session.cleanup;
  const cleanup = (async () => {
    if (await exists(configFile)) {
      await copyFile(configFile, configFile + ".bak");
      await run(["config", "delete", session.account.id], 10000);
    }
    prefs.loginDrafts = (prefs.loginDrafts ?? []).filter(
      (a) => a.id !== session.account.id,
    );
    await save();
    if (pending.get(session.account.id) === session)
      pending.delete(session.account.id);
  })();
  session.cleanup = cleanup;
  try {
    await cleanup;
  } catch (e) {
    session.cleanup = undefined;
    throw e;
  }
}
function loginStep(
  session: LoginSession,
  task: (signal: AbortSignal) => Promise<Question>,
): Promise<Question> {
  const controller = new AbortController();
  session.controller = controller;
  if (session.cancelled) controller.abort();
  const active = (async () => {
    try {
      const q = await task(controller.signal);
      if (session.cancelled)
        throw new CommandFailure("cancelled", "Conexão cancelada.");
      return await finish(session.account.id, q);
    } catch (e) {
      if (session.cancelled || e instanceof CommandFailure) {
        try {
          await cleanupLogin(session);
        } catch {
          record(
            "A limpeza da conexão ficou pendente. Os dados locais foram preservados para uma nova tentativa.",
            "error",
          );
        }
      }
      throw e;
    }
  })();
  session.active = active;
  const clear = () => {
    if (session.active === active) {
      session.active = undefined;
      session.controller = undefined;
    }
  };
  void active.then(clear, clear);
  return active;
}
async function cancelLogins() {
  loginEpoch++;
  for (const session of [...pending.values()]) {
    session.cancelled = true;
    session.controller?.abort();
    if (session.active) await session.active.catch(() => {});
    if (pending.get(session.account.id) === session)
      try {
        await cleanupLogin(session);
      } catch {
        record(
          "Uma conexão cancelada aguarda limpeza local. Você pode encerrar o aplicativo; a recuperação será repetida na próxima abertura.",
          "error",
        );
      }
  }
}
async function continueInternalQuestions(
  session: LoginSession,
  initial: Question,
  signal: AbortSignal,
) {
  let q = initial;
  if (
    session.account.provider === "drive" &&
    q.Option?.Name === "config_change_team_drive"
  )
    q = question(
      await run(
        [
          "config",
          "update",
          session.account.id,
          "config_template_file",
          await authTemplate(),
          "--non-interactive",
          "--continue",
          "--state",
          q.State,
          "--result",
          "false",
        ],
        180000,
        {},
        signal,
      ),
    );
  return q;
}
const roots = new Map<string, string>();
async function accountRoot(account: Account) {
  if (account.provider !== "drive") return `${account.id}:`;
  const cached = roots.get(account.id);
  if (cached) return cached;
  const drives: unknown = JSON.parse(
    await run(["backend", "drives", `${account.id}:`]),
  );
  const upstreams = sharedUpstreams(drives, account.id);
  await copyFile(configFile, configFile + ".bak");
  if (upstreams)
    await run([
      "config",
      "create",
      account.id + "-shared",
      "combine",
      "upstreams",
      upstreams,
      "--non-interactive",
      "--no-output",
    ]);
  const rootUpstreams = [
    JSON.stringify(`Meu Drive=${account.id}:`),
    JSON.stringify(`Compartilhados comigo=${account.id},shared_with_me=true:`),
    ...(upstreams
      ? [JSON.stringify(`Drives compartilhados=${account.id}-shared:`)]
      : []),
  ].join(" ");
  await run([
    "config",
    "create",
    account.id + "-root",
    "combine",
    "upstreams",
    rootUpstreams,
    "--non-interactive",
    "--no-output",
  ]);
  const remote = `${account.id}-root:`;
  roots.set(account.id, remote);
  return remote;
}
async function port(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new UserError("Porta indisponível."));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}
async function rc(mount: OwnedMount, operation: string, input:Record<string,unknown>={},timeout=3000) {
  const response = await fetch(`${mount.endpoint}/${operation}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${mount.auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new UserError("Unidade ainda indisponível.");
  return response.json();
}
async function mount(account: Account) {
  const previous = mounts.get(account.id);
  if (previous) {
    if (previous.child.exitCode !== null || previous.child.signalCode !== null)
      mounts.delete(account.id);
    else throw new UserError("Esta conta já tem uma montagem em andamento.");
  }
  await vault();
  mountSupport = await detectMountSupport();
  if (!mountSupport.available) {
    mountFailures.set(account.id, {
      accountId: account.id,
      phase: "error",
      path: "",
      sync: "problem",
      message: mountSupport.message,
    });
    throw new UserError(mountSupport.message);
  }
  mountFailures.delete(account.id);
  const remote = await accountRoot(account);
  let mountPath: string;
  if (process.platform === "win32") {
    mountPath = chooseDriveLetter(
      [
        ...(await logicalDrives()),
        ...[...mounts.values()]
          .filter((m) => m.state.phase !== "error")
          .map((m) => m.state.path),
      ],
      account.mountLetter,
    );
    if (account.mountLetter !== mountPath) {
      account.mountLetter = mountPath;
      await save();
    }
  } else {
    mountPath = account.mountFolder??path.join(app.getPath("home"), "GCP-Drive", account.label);
    if(!account.mountFolder){account.mountFolder=mountPath;await save();}
    await mkdir(mountPath, { recursive: true });
    await ensureEmptyMountDirectory(mountPath);
  }
  const password = randomBytes(32).toString("hex");
  const endpoint = `127.0.0.1:${await port()}`;
  const child = spawn(
    executable(),
    [
      ...mountArgs(account, mountPath, path.join(root, "cache"), remote),
      "--config",
      configFile,
      "--rc",
      "--rc-addr",
      endpoint,
    ],
    {
      shell: false,
      windowsHide: true,
      env: childEnv({ RCLONE_RC_USER: "gcp", RCLONE_RC_PASS: password }),
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  const owned: OwnedMount = {
    state: {
      accountId: account.id,
      phase: "starting",
      path: process.platform === "win32" ? mountPath + "\\" : mountPath,
      sync: "unknown",
    },
    child,
    endpoint: `http://${endpoint}`,
    auth: Buffer.from(`gcp:${password}`).toString("base64"),
  };
  mounts.set(account.id, owned);
  child.stderr?.on("data", () => {});
  child.once("error", () => {
    owned.state.phase = "error";
    owned.state.message = "Falha ao iniciar rclone.";
    record(`Falha ao montar ${account.label}.`, "error");
  });
  child.once("close", (code) => {
    if (owned.state.phase === "stopping" && code === 0)
      mounts.delete(account.id);
    else {
      owned.state.phase = "error";
      owned.state.message =
        "Unidade encerrada. Cache preservado; verifique WinFsp/FUSE e conectividade.";
      record(
        `A unidade ${account.label} foi encerrada; cache preservado.`,
        "error",
      );
    }
  });
  for (let attempt = 0; attempt < 30; attempt++) {
    if (owned.state.phase === "error") throw new UserError(owned.state.message??'Não foi possível montar a unidade.');
    try {
      await rc(owned, "vfs/stats");
      owned.state.phase = "running";
      if(!(prefs.importedMountedShortcuts??[]).includes(account.id)){
        prefs.importedMountedShortcuts??=[];prefs.importedMountedShortcuts.push(account.id);
        if(!prefs.favorites.some(f=>f.accountId===account.id&&f.path===''))prefs.favorites.push({accountId:account.id,path:'',name:account.label});
        await save();
      }
      if(process.platform==='win32'){
        const iconPath=path.join(root,'drive.ico');
        await copyFile(path.join(app.getAppPath(),'assets/icon.ico'),iconPath);
        await setDriveIcon(mountPath,iconPath).catch(()=>record('Não foi possível personalizar o ícone desta unidade.','error'));
        await windowsNavigation(account,mountPath+'\\',iconPath).catch(()=>record('Não foi possível fixar a unidade na navegação do Explorador.','error'));
        if(app.isPackaged)await windowsContext(process.execPath,iconPath,[...mounts.values()].map(m=>m.state.path)).catch(()=>record('Não foi possível preparar as ações do Explorador.','error'));
      }
      record(`Streaming ativo: ${account.label}`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  // Keep ownership and the process: a slow handshake is not proof of failed startup.
  owned.state.message =
    "Inicialização demorada. A montagem continua sob supervisão.";
  throw new UserError(owned.state.message);
}
async function unmountAccount(id: string) {
  const owned = mounts.get(id);
  if (!owned) {
    mountFailures.delete(id);
    return;
  }
  if (owned.child.exitCode !== null || owned.child.signalCode !== null) {
    mounts.delete(id);
    mountFailures.delete(id);
    return;
  }
  if (pendingWrites(await rc(owned, "vfs/stats")))
    throw new UserError(
      "Há gravações pendentes nesta unidade. Aguarde a conclusão antes de desconectar.",
    );
  owned.state.phase = "stopping";
  const closed = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new UserError(
            "A unidade ainda não encerrou. O processo e o cache permanecem sob supervisão.",
          ),
        ),
      10000,
    );
    owned.child.once("close", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve()
        : reject(
            new UserError(
              "A unidade não encerrou corretamente. O cache foi preservado.",
            ),
          );
    });
  });
  void closed.catch(() => {});
  try {
    await rc(owned, "core/quit");
  } catch {
    if (owned.child.exitCode !== 0)
      throw new UserError("Não foi possível solicitar a desmontagem.");
  }
  await closed;
  await removeDriveIcon(owned.state.path.slice(0,2),path.join(root,'drive.ico')).catch(()=>{});
  mountFailures.delete(id);
}
async function execute<K extends keyof Operations>(
  operation: K,
  input: any,
): Promise<Operations[K]["output"] | unknown> {
  switch (operation) {
    case 'activityHistory':
      if(input?.before!==undefined&&(typeof input.before!=='string'||!/^\d{1,15}$/.test(input.before)))throw new UserError('Página de histórico inválida.');
      return activityStore?.page(input?.before)??{items:activity};
    case 'clearActivity': {
      const confirm=await dialog.showMessageBox(window,{title:'Limpar histórico',type:'question',message:'Limpar os registros de atividade deste computador?',detail:'As transferências em andamento, os arquivos e as configurações serão preservados.',buttons:['Cancelar','Limpar histórico'],defaultId:0,cancelId:0});
      if(confirm.response===1){activityStore?.clear();activity.length=0;}return null;
    }
    case 'updateSettings':
      if(!['launch','daily','weekly','fortnightly','monthly','never'].includes(input?.frequency))throw new UserError('Periodicidade inválida.');
      prefs.updateFrequency=input.frequency;await save();return null;
    case 'checkUpdates':
      try{await updates.check();}finally{prefs.lastUpdateCheck=new Date().toISOString();await save();}return null;
    case 'downloadUpdate':await updates.download(process.platform,process.arch,input?.format);return null;
    case 'cancelUpdate':await updates.cancel();return null;
    case 'installUpdate': {
      const installer=updates.verifiedPackage;
      const choice=await dialog.showMessageBox(window,{title:'Atualizar GCP-Drive',type:'question',message:`Instalar GCP-Drive ${updates.state.version}?`,detail:'O aplicativo verificará gravações pendentes antes de encerrar. Suas contas e configurações serão preservadas. O sistema poderá pedir confirmação para instalar o pacote.',buttons:['Cancelar','Instalar atualização'],defaultId:0,cancelId:0});
      if(choice.response===1){if(process.platform==='win32')await quit(installer);else if(process.platform==='linux'&&installer.endsWith('.AppImage')){await chmod(installer,0o700);await quit(installer);}else{const error=await shell.openPath(installer);if(error)throw new UserError('Não foi possível abrir o pacote no instalador do sistema.');}}
      return null;
    }
    case 'appearance': {
      if(![...builtinThemes,...(prefs.customThemes??[])].some(t=>t.id===input?.theme)&&input?.theme!=='system')throw new UserError('Tema não encontrado.');
      prefs.theme=input.theme;await save();return null;
    }
    case 'installTheme': {
      const result=await dialog.showOpenDialog(window,{title:'Instalar tema do GCP-Drive',properties:['openFile'],filters:[{name:'Tema GCP-Drive (JSON)',extensions:['json']}]});
      if(result.canceled)return null;
      if((await stat(result.filePaths[0])).size>16384)throw new UserError('O arquivo de tema excede 16 KB.');
      const theme=parseTheme(JSON.parse(await readFile(result.filePaths[0],'utf8')),'theme-'+randomUUID());
      if((prefs.customThemes??[]).length>=30)throw new UserError('O limite é de 30 temas personalizados.');
      (prefs.customThemes??=[]).push(theme);prefs.theme=theme.id;await save();return null;
    }
    case 'refreshShared': {
      const account=getAccount(input?.accountId);
      if(account.provider!=='drive')throw new UserError('Esta ação está disponível para contas Google Drive.');
      const mounted=mounts.get(account.id)?.state.phase==='running';
      if(mounted)await unmountAccount(account.id);
      roots.delete(account.id);listings.clear();
      await accountRoot(account);
      if(mounted)await mount(account);
      record(`Unidades compartilhadas atualizadas: ${account.label}`);return null;
    }
    case 'support':
      if(input?.action==='pix')clipboard.writeText(PIX);
      else if(input?.action==='stripe-copy')clipboard.writeText(STRIPE);
      else if(input?.action==='stripe')await shell.openExternal(STRIPE);
      else if(input?.action==='website')await shell.openExternal(WEBSITE);
      else throw new UserError('Ação inválida.');return null;
    case 'renameAccount': {
      const account=getAccount(input?.accountId);
      const label=typeof input?.label==='string'?input.label.trim():'';
      if(!label||label.length>64||/[\\/<>:"|?*\x00-\x1f]/u.test(label)||/[. ]$/.test(label)||label==='.'||label==='..')throw new UserError('Use um nome de 1 a 64 caracteres, sem caracteres reservados.');
      if(prefs.accounts.some(a=>a.id!==account.id&&a.label.toLocaleLowerCase()===label.toLocaleLowerCase()))throw new UserError('Outra conta já usa esse nome.');
      account.label=label;await save();
      const rootFavorite=prefs.favorites.find(f=>f.accountId===account.id&&f.path==='');
      if(rootFavorite){rootFavorite.name=label;await save();}
      const owned=mounts.get(account.id);
      if(owned?.state.phase==='running'&&process.platform==='win32')await windowsNavigation(account,owned.state.path,path.join(root,'drive.ico'));
      record(`Nome da conta atualizado: ${label}`);return null;
    }
    case 'fullscreen': window.setFullScreen(!window.isFullScreen());return window.isFullScreen();
    case 'download': {
      const account=getAccount(input?.accountId),remote=relativePath(input?.path);
      if(!remote)throw new UserError('Selecione um arquivo ou uma pasta.');
      await vault();const target=`${await accountRoot(account)}${remote}`;
      const entry=JSON.parse(await run(['lsjson',target,'--stat']));
      if(entry.IsDir){
        const result=await dialog.showOpenDialog(window,{title:'Escolher onde baixar a pasta',properties:['openDirectory','createDirectory']});
        if(!result.canceled)await runSync(['copy',target,path.join(result.filePaths[0],path.posix.basename(remote)),'--immutable']);
      }else{
        const result=await dialog.showSaveDialog(window,{title:'Baixar arquivo',defaultPath:path.join(app.getPath('downloads'),path.posix.basename(remote))});
        if(!result.canceled&&result.filePath)await runSync(['copyto',target,result.filePath]);
      }
      record(`Download concluído ou cancelado: ${path.posix.basename(remote)}`);return null;
    }
    case 'rename': {
      const account=getAccount(input?.accountId),remote=relativePath(input?.path),name=relativePath(input?.name);
      if(!remote||!name||name.includes('/')||name.length>255||/[<>:"|?*]/.test(name))throw new UserError('Nome de arquivo inválido.');
      await vault();const rootRemote=await accountRoot(account);
      const parent=path.posix.dirname(remote),destination=(parent==='.'?'':parent+'/')+name;
      if(destination===remote)return null;
      try{await run(['lsjson',rootRemote+destination,'--stat']);throw new UserError('Já existe um item com esse nome.');}
      catch(error){if(!(error instanceof CommandFailure) || ![3,4].includes(error.exitCode??0))throw error;}
      await run(['moveto',rootRemote+remote,rootRemote+destination,'--immutable']);
      listings.clear();const owned=mounts.get(account.id);if(owned?.state.phase==='running')await rc(owned,'vfs/forget',{dir:parent==='.'?'':parent});
      record(`Item renomeado: ${path.posix.basename(remote)} → ${name}`);return null;
    }
    case 'refreshFolder': {
      const account=getAccount(input?.accountId),remote=relativePath(input?.path);
      const owned=mounts.get(account.id);
      if(owned?.state.phase==='running')await rc(owned,'vfs/refresh',{dir:remote,recursive:false});
      listings.clear();return null;
    }
    case 'storage': {
      const account=getAccount(input?.accountId),owned=mounts.get(account.id);
      if(!owned || owned.state.phase!=='running')throw new UserError('Monte a unidade para consultar o armazenamento com segurança.');
      const stats=await rc(owned,'vfs/stats');
      return {cacheBytes:stats.diskCache?.bytesUsed??0,cacheFiles:stats.diskCache?.files??0,canClear:!pendingWrites(stats),offlineBytes:0};
    }
    case 'clearCache': {
      const account=getAccount(input?.accountId);
      if(mounts.get(account.id)?.state.phase!=='running')throw new UserError('Monte a unidade antes de limpar o cache.');
      const result=await dialog.showMessageBox(window,{type:'question',title:'Liberar espaço',message:`Limpar o cache de ${account.label}?`,detail:'Feche os arquivos desta unidade. Somente cópias locais temporárias serão removidas. Arquivos da nuvem e históricos de sincronização serão preservados. Gravações pendentes impedem a limpeza.',buttons:['Cancelar','Limpar cache'],defaultId:0,cancelId:0});
      if(result.response!==1)return null;
      await unmountAccount(account.id);
      const cache=path.join(root,'cache',account.id);
      try{await assertCleanCache(cache);}catch(error){await mount(account);throw error;}
      const retired=cache+'.limpeza-'+randomUUID();
      if(await exists(cache)){await rename(cache,retired);await rm(retired,{recursive:true,force:true});}
      await mount(account);record(`Cache liberado: ${account.label}`);return null;
    }
    case 'web': {
      const account=getAccount(input?.accountId),remote=relativePath(input?.path);
      let url:string=providers[account.provider].web;
      if(remote && account.provider==='drive') {
        await vault();const item=JSON.parse(await run(['lsjson',`${await accountRoot(account)}${remote}`,'--stat']));
        if(typeof item.ID==='string' && /^[\w-]+$/.test(item.ID))url=item.IsDir?`https://drive.google.com/drive/u/0/folders/${item.ID}`:`https://drive.google.com/file/d/${item.ID}/view`;
      }
      // Opening provider UI never creates a public link or changes access permissions.
      await shell.openExternal(url);return url;
    }
    case 'removeFolder': {
      const plan=prefs.folderPlans?.find(p=>p.id===input?.planId);
      if(!plan)throw new UserError('Sincronização não encontrada.');
      const confirm=await dialog.showMessageBox(window,{title:'Parar de sincronizar pasta',type:'question',message:`Remover a sincronização de ${path.basename(plan.localPath)}?`,detail:'A operação atual terminará antes da remoção. Os arquivos locais, os arquivos na nuvem e o histórico serão preservados.',buttons:['Cancelar','Parar e remover'],defaultId:0,cancelId:0});
      if(confirm.response===1){await folderSync.remove(plan.id);record(`Sincronização removida: ${path.basename(plan.localPath)}`);}
      return null;
    }
    case 'nativeIcons': return icons.actionIcons(input?.names);
    case 'fileIcons': return icons.fileIcons(input?.keys);
    case 'licenses': return readFile(path.join(app.getAppPath(),'THIRD_PARTY_NOTICES.md'),'utf8');
    case "cancelLogin":
      await cancelLogins();
      return null;
    case "quit":
      await quit();
      return null;
    case "openMountSupport": {
      mountSupport = await detectMountSupport();
      const installer = app.isPackaged
        ? path.join(process.resourcesPath, "support", "winfsp.msi")
        : path.join(app.getAppPath(), "vendor", "win32-x64", "winfsp.msi");
      if (
        process.platform === "win32" &&
        !mountSupport.available &&
        (await exists(installer))
      ) {
        if (
          createHash("sha256")
            .update(await readFile(installer))
            .digest("hex") !==
          "073a70e00f77423e34bed98b86e600def93393ba5822204fac57a29324db9f7a"
        )
          throw new UserError(
            "O instalador de suporte não corresponde à versão oficial validada.",
          );
        const choice = await dialog.showMessageBox(window, {
          type: "question",
          title: "Ativar unidades no Windows",
          message: "Ativar o suporte a unidades virtuais?",
          detail:
            "O componente assinado permite que suas contas apareçam como unidades no Explorador de Arquivos. O Windows mostrará o fornecedor verdadeiro na confirmação de administrador. Você poderá conferir e aprovar as etapas.",
          buttons: ["Agora não", "Abrir instalador oficial"],
          defaultId: 1,
          cancelId: 0,
        });
        if (choice.response === 1) {
          const error = await shell.openPath(installer);
          if (error)
            throw new UserError("Não foi possível abrir o instalador do suporte.");
        }
      } else if (mountSupport.installURL)
        await shell.openExternal(mountSupport.installURL);
      return null;
    }
    case "disconnect": {
      const account = getAccount(input?.accountId);
      const confirmation = await dialog.showMessageBox(window, {
        type: "question",
        title: "Desconectar conta",
        message: `Desconectar ${account.label} deste computador?`,
        detail:
          "Os arquivos na nuvem não serão excluídos. Feche os arquivos abertos nesta unidade. O cache e o histórico local serão preservados. A autorização no provedor poderá ser revogada nas configurações da sua conta.",
        buttons: ["Manter conectada", "Desconectar"],
        defaultId: 0,
        cancelId: 0,
      });
      if (confirmation.response !== 1) return null;
      for (const p of prefs.folderPlans ?? [])
        if (p.accountId === account.id) await folderSync.pause(p.id);
      if (folderSync.activeFor(account.id))
        throw new UserError(
          "A sincronização foi pausada. Aguarde a operação atual terminar e desconecte novamente.",
        );
      await unmountAccount(account.id);
      await vault();
      if(account.mountLetter)await windowsNavigation(account,account.mountLetter+'\\',path.join(root,'drive.ico'),true);
      await copyFile(configFile, configFile + ".bak");
      for (const name of [
        account.id + "-root",
        account.id + "-shared",
        account.id,
      ])
        await run(["config", "delete", name]);
      for (const name of [
        account.id + "-root",
        account.id + "-shared",
        account.id,
      ])
        await executeCommand(
          executable(),
          ["config", "delete", name, "--config", configFile + ".bak"],
          { env: childEnv(), timeout: 10000 },
        );
      prefs.accounts = prefs.accounts.filter((a) => a.id !== account.id);
      prefs.favorites = prefs.favorites.filter(
        (f) => f.accountId !== account.id,
      );
      prefs.folderPlans = (prefs.folderPlans ?? []).filter(
        (p) => p.accountId !== account.id,
      );
      index.removeAccount(account.id);
      roots.delete(account.id);
      mountFailures.delete(account.id);
      await save();
      record(`Conta desconectada deste computador: ${account.label}`);
      return null;
    }
    case "snapshot": {
      const journal=activityStore?.page();
      return {
        version: app.getVersion(),
        preferences: prefs,
        mounts: [...mounts.values()]
          .map((m) => m.state)
          .concat(
            [...mountFailures.values()].filter((f) => !mounts.has(f.accountId)),
          ),
        activity:[...activity,...(journal?.items??[])],
        activityCursor:journal?.cursor,
        engine,
        platform: process.platform,
        vault: vaultReady,
        folderSyncs: folderSync.snapshot(),
        mountSupport,
        requestedView,
        updates:updates.state,
      } satisfies Snapshot;
    }
    case "addFolder": {
      const account = getAccount(input?.accountId);
      const remotePath = relativePath(input?.remotePath);
      if (
        !remotePath ||
        remotePath.split("/").includes("Histórico GCP-Drive") ||
        (account.provider === "drive" &&
          !/^(Meu Drive\/[^/]|Drives compartilhados\/[^/]+\/[^/])/.test(
            remotePath,
          ))
      )
        throw new UserError(
          "Escolha uma subpasta de destino, por exemplo Meu Drive/Computador/Documentos.",
        );
      const result = await dialog.showOpenDialog(window, {
        title: "Escolha a pasta deste computador para sincronizar",
        properties: ["openDirectory"],
      });
      if (result.canceled) return null;
      const localPath = await realpath(result.filePaths[0]);
      if (
        !(await stat(localPath)).isDirectory() ||
        overlaps(localPath, root) ||
        overlaps(localPath, path.join(app.getPath("home"), "GCP-Drive"))
      )
        throw new UserError(
          "A pasta não pode incluir as unidades virtuais ou os dados internos do aplicativo.",
        );
      const plans = (prefs.folderPlans ??= []);
      if (
        plans.some(
          (p) =>
            overlaps(p.localPath, localPath) ||
            (p.accountId === account.id &&
              remoteOverlaps(p.remotePath, remotePath)),
        )
      )
        throw new UserError(
          "Esta pasta ou seu destino se sobrepõe a outra sincronização.",
        );
      await vault();
      const remote = `${await accountRoot(account)}${remotePath}`;
      // The user explicitly chooses this destination before selecting the local folder.
      await run(["mkdir", remote]);
      const plan: FolderPlan = {
        id: `sync-${randomUUID()}`,
        accountId: account.id,
        localPath,
        remotePath,
        enabled: false,
        initialized: false,
      };
      plans.push(plan);
      await save();
      record(`Pasta adicionada para revisão: ${path.basename(localPath)}`);
      return plan;
    }
    case "previewFolder":
      return folderSync.preview(input?.planId);
    case "startFolder":
      await folderSync.start(input?.planId);
      return null;
    case "pauseFolder":
      await folderSync.pause(input?.planId);
      return null;
    case "chooseEngine": {
      if (mounts.size || pending.size || folderSync.active)
        throw new UserError("Encerre as operações antes de trocar o motor.");
      const result = await dialog.showOpenDialog(window, {
        title: "Selecionar componente de sincronização",
        properties: ["openFile"],
        filters:
          process.platform === "win32"
            ? [{ name: "rclone.exe", extensions: ["exe"] }]
            : [],
      });
      if (result.canceled) return false;
      prefs.rclonePath = result.filePaths[0];
      await save();
      await detect();
      return engine.available;
    }
    case "connect": {
      if (pending.size) throw new UserError("Conclua a conexão em andamento.");
      const kind = provider(input?.provider);
      if (
        typeof input?.label !== "string" ||
        !input.label.trim() ||
        input.label.length > 80 ||
        /[\x00-\x1f<>:"/\\|?*]/.test(input.label) ||
        /[. ]$/.test(input.label) ||
        /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(input.label) ||
        prefs.accounts.some(
          (a) =>
            a.label.toLocaleLowerCase() ===
            input.label.trim().toLocaleLowerCase(),
        )
      )
        throw new UserError("Use um nome único e válido para a pasta desta conta.");
      const account: Account = {
        id: `gcp-${randomUUID()}`,
        label: input.label.trim(),
        provider: kind,
        autoMount: true,
      };
      const session: LoginSession = {
        account,
        question: { State: "starting" },
        cancelled: false,
      };
      pending.set(account.id, session);
      prefs.loginDrafts ??= [];
      prefs.loginDrafts.push(account);
      await save();
      const q = await loginStep(session, async (signal) => {
        await vault();
        if (signal.aborted)
          throw new CommandFailure("cancelled", "Conexão cancelada.");
        await copyFile(configFile, configFile + ".bak");
        if(kind==='mega'||kind==='protondrive'){
          const credentials=input?.credentials;
          if(!credentials||typeof credentials.user!=='string'||!credentials.user.trim()||typeof credentials.password!=='string'||!credentials.password||credentials.user.length>320||credentials.password.length>4096|| (credentials.otp!==undefined&&(typeof credentials.otp!=='string'||!/^\d{0,10}$/.test(credentials.otp)))||(credentials.mailbox!==undefined&&(typeof credentials.mailbox!=='string'||credentials.mailbox.length>4096)))throw new CommandFailure('exit','Informe o usuário, a senha e o código de autenticação, se houver.');
          try{
            await createPrivateRemote(executable(),configFile,childEnv(),account.id,kind,{user:credentials.user.trim(),pass:credentials.password,...(credentials.otp?{'2fa':credentials.otp}:{}),...(kind==='protondrive'&&credentials.mailbox?{mailbox_password:credentials.mailbox}:{}),...(kind==='mega'?{use_https:'true'}:{})},signal);
            await run(['lsjson',account.id+':','--dirs-only','--max-depth','1'],120000,{},signal);
            return {State:''};
          }catch(error){throw new CommandFailure(signal.aborted?'cancelled':'exit',signal.aborted?'Conexão cancelada.':'Não foi possível autenticar a conta. Confira os dados, o código de duas etapas e as limitações deste provedor.');}
        }
        const template = await authTemplate();
        return continueInternalQuestions(
          session,
          question(
            await run(
              [
                "config",
                "create",
                account.id,
                kind,
                "config_template_file",
                template,
                "--non-interactive",
              ],
              180000,
              {},
              signal,
            ),
          ),
          signal,
        );
      });
      return { accountId: account.id, question: q };
    }
    case "answer": {
      const item = pending.get(input?.accountId);
      if (
        !item ||
        typeof input?.answer !== "string" ||
        input.answer.length > 65536
      )
        throw new UserError("Sessão de login inválida.");
      if (item.active) throw new UserError("A conexão já está em andamento.");
      return loginStep(item, async (signal) => {
        await copyFile(configFile, configFile + ".bak");
        return continueInternalQuestions(
          item,
          question(
            await run(
              [
                "config",
                "update",
                item.account.id,
                "config_template_file",
                await authTemplate(),
                "--non-interactive",
                "--continue",
                "--state",
                item.question.State,
                "--result",
                input.answer,
              ],
              180000,
              {},
              signal,
            ),
          ),
          signal,
        );
      });
    }
    case "list": {
      const account = getAccount(input?.accountId);
      const remote = relativePath(input?.path);
      await vault();
      const owned=mounts.get(account.id);
      const entries = await listings.get(account.id+'\0'+remote,async()=>{
        const fs=await accountRoot(account);
        if(owned?.state.phase==='running'){
          const result=await rc(owned,'operations/list',{fs,remote,opt:{recurse:false,noMimeType:true}},45000);
          return parseFolderListing(result.list,remote);
        }
        return parseFolderListing(JSON.parse(await run(['lsjson',fs+remote,'--max-depth','1','--no-mimetype'])),remote);
      });
      if(!prefs.accounts.some(a=>a.id===account.id)||(owned&&(mounts.get(account.id)!==owned||owned.state.phase==='stopping')))throw new UserError('A conta foi desconectada durante a consulta.');
      index.replaceFolder(account.id, remote, entries);
      return entries.map(entry=>({...entry,IconKey:icons.key(entry.Name,entry.IsDir)}));
    }
    case "search": {
      const account = getAccount(input?.accountId);
      if (typeof input?.query !== "string" || input.query.length > 300)
        throw new UserError("Pesquisa inválida.");
      return {
        hits: index.search(input.query, account.id).map(hit=>({...hit,IconKey:icons.key(hit.name,hit.isDir)})),
        coverage: "visited-folders-only",
      };
    }
    case "mount":
      await mount(getAccount(input?.accountId));
      return null;
    case "open": {
      const account = getAccount(input?.accountId);
      const owned = mounts.get(account.id);
      if (!owned || owned.state.phase !== "running")
        throw new UserError("Ative o streaming desta conta primeiro.");
      const target = withinMount(owned.state.path, input?.path);
      const error = await shell.openPath(target);
      if (error)
        throw new UserError(
          "Não foi possível abrir este arquivo no aplicativo padrão.",
        );
      return null;
    }
    case "favorite": {
      const account = getAccount(input?.accountId);
      const remote = relativePath(input?.path);
      if (typeof input.name !== "string" || input.name.length > 255)
        throw new UserError("Nome inválido.");
      const favoriteIndex = prefs.favorites.findIndex(
        (f) => f.accountId === account.id && f.path === remote,
      );
      if (favoriteIndex >= 0) prefs.favorites.splice(favoriteIndex, 1);
      else
        {const observed=index.lookup(account.id,remote);prefs.favorites.push({
          accountId: account.id,
          path: remote,
          name: input.name,
          ...(observed?{isDir:observed.isDir,size:observed.size,modified:observed.modified}:remote===''?{isDir:true}:{}),
        });}
      await save();
      return null;
    }
    case "preferences": {
      if (
        !["pt-BR", "en", "es"].includes(input?.language) ||
        typeof input?.startAtLogin !== "boolean"
      )
        throw new UserError("Preferências inválidas.");
      if (input.startAtLogin && !app.isPackaged)
        throw new UserError(
          "Instale o aplicativo antes de ativar a inicialização automática.",
        );
      if (process.platform === "linux")
        await linuxAutostart(
          app.getPath("appData"),
          process.execPath,
          input.startAtLogin,
        );
      else
        app.setLoginItemSettings({
          openAtLogin: input.startAtLogin,
          args: ["--hidden"],
        });
      prefs.language = input.language;
      prefs.startAtLogin = input.startAtLogin;
      await save();
      return null;
    }
    default:
      throw new UserError("Operação não suportada.");
  }
}
async function quit(installer?:string) {
  if (quittingInProgress) return;
  quittingInProgress = true;
  try {
    if (folderSync?.active || longCommands.size>0) {
      await dialog.showMessageBox(window, {
        type: "warning",
        title: "GCP-Drive",
        message: "Sincronização em andamento",
        detail:
          "Pause as pastas e aguarde a conclusão da operação antes de sair. O GCP-Drive continuará na bandeja.",
        buttons: ["Entendi"],
      });
      return;
    }
    await cancelLogins();
    await updates?.cancel();
    folderSync?.stopTimers();
    await commands.close();
    for (const id of [...mounts.keys()])
      try {
        await unmountAccount(id);
      } catch (e) {
        await dialog.showMessageBox(window, {
          type: "warning",
          title: "GCP-Drive",
          message: "Encerramento pendente",
          detail:
            e instanceof Error
              ? userMessage(e)
              : "Aguarde as gravações antes de sair.",
          buttons: ["Entendi"],
        });
        return;
      }
    folderSync?.stopTimers();
    if(installer){
      const child=spawn(installer,['--updated'],{detached:true,windowsHide:false,stdio:'ignore'});
      await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',()=>reject(new UserError('Não foi possível iniciar o instalador.')));});child.unref();
    }
    quitting = true;
    app.quit();
  } finally {
    if (!quitting) {
      commands.reopen();
      folderSync?.resumeSaved();
    }
    quittingInProgress = false;
  }
}
async function nativeAction(argv:string[]){
  const action=argv.find(v=>v.startsWith('--gcp-native-action='))?.slice('--gcp-native-action='.length);
  const value=argv.find(v=>v.startsWith('--gcp-native-path='))?.slice('--gcp-native-path='.length);
  if(!action||!value||!['open','web','share','favorite','download'].includes(action)||!path.isAbsolute(value))return;
  const owned=[...mounts.values()].find(m=>{const relative=path.relative(m.state.path,value);return !path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);});
  if(!owned)throw new UserError('Este item não pertence a uma unidade ativa do GCP-Drive.');
  const remote=path.relative(owned.state.path,value).split(path.sep).join('/');
  if(action==='open'){
    const account=getAccount(owned.state.accountId);
    const entry=remote?JSON.parse(await run(['lsjson',(await accountRoot(account))+remote,'--stat'])):{IsDir:true};
    requestedView='files';window.webContents.send('gcp-location',{accountId:account.id,path:entry.IsDir?remote:remote.split('/').slice(0,-1).join('/')});return;
  }
  if(action==='favorite')await execute('favorite',{accountId:owned.state.accountId,path:remote,name:path.basename(value)});
  else await execute(action==='download'?'download':'web',{accountId:owned.state.accountId,path:remote,share:action==='share'});
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", (_event,argv) => {
    window?.show();
    window?.focus();
    mutation=mutation.then(()=>nativeAction(argv)).catch(e=>record(userMessage(e),'error'));
  });
  app.on("will-quit", () => {index?.close();activityStore?.close();});
  app.on("before-quit", (event) => {
    if (!quitting) {
      event.preventDefault();
      void quit();
    }
  });
  void app
    .whenReady()
    .then(async () => {
      await mkdir(root, { recursive: true, mode: 0o700 });
      if(process.platform==='linux'&&app.isPackaged)await installLinuxShell(app.getPath('home'),path.join(app.getAppPath(),'assets/gcp-drive-file-manager.py')).catch(()=>record('As ações do gerenciador de arquivos não puderam ser ativadas.','error'));
      icons=new NativeIcons(path.join(root,'system-icons'),(executable,args)=>commands.execute(executable,args,{timeout:5000,maxBytes:128*1024,env:process.env}));
      index = new FileIndex(path.join(root, "file-index.sqlite"));
      try{activityStore=new ActivityStore(path.join(root,'activity.sqlite'));for(const event of [...activity].reverse())activityStore.add(event);activity.length=0;setInterval(()=>{try{activityStore?.prune();}catch{}},3600000);}catch{record('O histórico local não pôde ser aberto. As atividades recentes continuam disponíveis nesta sessão.','error');}
      if (process.platform !== "win32")
        await chmod(path.join(root, "file-index.sqlite"), 0o600);
      if (await exists(prefsFile)) {
        prefs = JSON.parse(await readFile(prefsFile, "utf8"));
        if (
          prefs.version !== 1 ||
          !Array.isArray(prefs.accounts) ||
          !Array.isArray(prefs.favorites)
        )
          throw new UserError(
            "Preferências inválidas. Restaure preferences.json.bak.",
          );
        for (const a of prefs.accounts) {
          provider(a.provider);
          if (
            !/^gcp-[0-9a-f-]{36}$/.test(a.id) ||
            typeof a.label !== "string" ||
            typeof a.autoMount !== "boolean"
          )
            throw new UserError("Identidade de conta inválida.");
        }
      } else {
        prefs = {
          version: 1,
          accounts: [],
          favorites: [],
          language: systemLanguage(app.getLocale()),
          startAtLogin: false,
        };
        await save();
      }
      prefs.folderPlans ??= [];
      prefs.loginDrafts ??= [];
      if (
        !Array.isArray(prefs.loginDrafts) ||
        !prefs.loginDrafts.every(
          (a) =>
            /^gcp-[0-9a-f-]{36}$/.test(a.id) &&
            Object.hasOwn(providers,a.provider),
        )
      )
        throw new UserError("Registro de conexões incompletas inválido.");
      if (!Array.isArray(prefs.folderPlans))
        throw new UserError("Configuração de pastas inválida.");
      for (const p of prefs.folderPlans) {
        if (
          !/^sync-[0-9a-f-]{36}$/.test(p.id) ||
          !prefs.accounts.some((a) => a.id === p.accountId) ||
          typeof p.localPath !== "string" ||
          !path.isAbsolute(p.localPath) ||
          typeof p.enabled !== "boolean" ||
          typeof p.initialized !== "boolean"
        )
          throw new UserError("Configuração de sincronização inválida.");
        relativePath(p.remotePath);
      }
      updates=new AppUpdates(path.join(root,'updates'),app.getVersion());
      folderSync = new FolderSyncManager(root, {
        plans: () => prefs.folderPlans!,
        remote: async (p) =>
          `${await accountRoot(getAccount(p.accountId))}${p.remotePath}`,
        list: async (target) => {
          await vault();
          return parseEntries(
            JSON.parse(
              await run(["lsjson", target, "--recursive", "--files-only"]),
            ),
          );
        },
        execute: runSync,
        persist: save,
        record: (message, error) => record(message, error ? "error" : "info"),
      });
      await detect();
      mountSupport = await detectMountSupport();
      const icon = nativeImage.createFromPath(
        path.join(app.getAppPath(), "assets/icon.png"),
      );
      window = new BrowserWindow({
        width: 1380,
        height: 900,
        minWidth: 1080,
        minHeight: 720,
        title: "GCP-Drive",
        icon,
        autoHideMenuBar: true,
        backgroundColor: "#f6f7fb",
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (e) => e.preventDefault());
      const rendererURL = pathToFileURL(
        path.join(__dirname, "index.html"),
      ).href;
      ipcMain.handle("gcp-drive", async (event, operation, input) => {
        if (
          event.sender !== window.webContents ||
          event.senderFrame?.url !== rendererURL
        )
          return { ok: false, error: "Origem não autorizada." };
        const readOnly = operation === "snapshot" || operation==='nativeIcons' || operation==='fileIcons' || operation==='licenses' || operation==='search' || (operation==='list'&&mounts.get(input?.accountId)?.state.phase==='running');
        const submittedLoginEpoch =
          operation === "connect" ? ++loginEpoch : undefined;
        const work = async () => {
          try {
            if (
              submittedLoginEpoch !== undefined &&
              submittedLoginEpoch !== loginEpoch
            )
              throw new CommandFailure("cancelled", "Conexão cancelada.");
            return { ok: true, value: await execute(operation, input) };
          } catch (e) {
            return {
              ok: false,
              error: e instanceof Error ? userMessage(e) : "Falha inesperada.",
            };
          }
        };
        if (readOnly || operation === "cancelLogin" || operation === "quit" || operation==='cancelUpdate')
          return work();
        if (operation === "disconnect") await cancelLogins();
        const result = mutation.then(work);
        mutation = result.then(() => {});
        return result;
      });
      await window.loadURL(rendererURL);
      const automaticUpdate=async(launch=false)=>{
        if(updateDue(prefs.updateFrequency??'launch',prefs.lastUpdateCheck,launch)&&updates.state.phase!=='checking'&&updates.state.phase!=='downloading'){
          try{await execute('checkUpdates',null);}catch{/* State is shown in preferences; no repeated modal. */}
        }
      };
      if(!testProfile){void automaticUpdate(true);setInterval(()=>{void automaticUpdate();},3600000);}
      if (!testProfile) {
        app.setAsDefaultProtocolClient("gcp-drive");
      }
      app.on("open-url", (event, url) => {
        event.preventDefault();
        if (url === "gcp-drive://authorization-return") {
          window.show();
          window.focus();
        }
      });
      if (process.argv.includes("--hidden")) window.hide();
      window.on("close", (event) => {
        if (!quitting) {
          event.preventDefault();
          if (pending.size) void cancelLogins();
          window.hide();
        }
      });
      tray = new Tray(icon.resize({ width: 20, height: 20 }));
      tray.setToolTip("GCP-Drive");
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: "Abrir GCP-Drive", click: () => window.show() },
          {
            label: "Sair com segurança",
            click: () => {
              void quit();
            },
          },
        ]),
      );
      tray.on("click", () => { requestedView='activity';window.show();window.focus();window.webContents.send('gcp-view','activity'); });
      let monitoring = false;
      let frame = 0;
      let trayAnimated = false;
      const trayFrames = [0, 1, 2, 3].map((i) =>
        nativeImage.createFromPath(
          path.join(app.getAppPath(), `assets/tray-${i}.png`),
        ),
      );
      setInterval(() => {
        const transferring =
          folderSync.active || longCommands.size>0 ||
          [...mounts.values()].some((m) => m.state.sync === "transferring");
        if (transferring) {
          tray.setImage(trayFrames[frame++ % trayFrames.length]);
          trayAnimated = true;
        } else if (trayAnimated) {
          tray.setImage(icon.resize({ width: 20, height: 20 }));
          trayAnimated = false;
        }
      }, 250);
      setInterval(() => {
        if (monitoring) return;
        monitoring = true;
        void Promise.all(
          [...mounts.values()]
            .filter(
              (m) => m.state.phase !== "error" && m.state.phase !== "stopping",
            )
            .map(async (m) => {
              try {
                const [vfs, transfers, queue, completed] = await Promise.all([
                  rc(m, "vfs/stats"),
                  rc(m, "core/stats"),
                  rc(m, "vfs/queue"),
                  rc(m, "core/transferred"),
                ]);
                Object.assign(m.state,mountTelemetry(vfs,transfers,queue,completed));
                m.state.sync = syncObservation(vfs);
                if (
                  Array.isArray(transfers.transferring) &&
                    transfers.transferring.length > 0
                )
                  if(m.state.sync!=='problem')m.state.sync = "transferring";
                m.state.observedAt = new Date().toISOString();
                m.state.phase = "running";
              } catch {
                m.state.sync = "unknown";
              }
            }),
        ).finally(() => {
          monitoring = false;
          if(process.platform==='linux'&&app.isPackaged)void writeLinuxShellState(app.getPath('home'),process.execPath,[...mounts.values()].map(m=>m.state)).catch(()=>{});
        });
      }, 2000);
      if (
        (prefs.accounts.length || prefs.loginDrafts.length) &&
        engine.available
      )
        mutation = mutation.then(async () => {
          try {
            await vault();
            for (const draft of [...prefs.loginDrafts!])
              if (!prefs.accounts.some((a) => a.id === draft.id))
                await cleanupLogin({
                  account: draft,
                  question: { State: "" },
                  cancelled: true,
                });
            for (const account of prefs.accounts.filter((a) => a.autoMount)) {
              try {
                await mount(account);
              } catch (e) {
                record(
                  `${account.label}: ${e instanceof Error ? userMessage(e) : "Não foi possível montar a unidade."}`,
                  "error",
                );
              }
            }
          } catch {
            record(
              "Desbloqueie o cofre do sistema para iniciar suas unidades.",
              "error",
            );
          }
          folderSync.resumeSaved();
        });
    })
    .catch((error) => {
      dialog.showMessageBoxSync({
        type: "error",
        title: "GCP-Drive",
        message: "Não foi possível iniciar o aplicativo",
        detail: userMessage(error),
        buttons: ["Fechar"],
      });
      quitting = true;
      app.quit();
    });
}
