import {UserError,userMessage} from './user-error.ts';
import { access, constants, readFile, readdir, realpath, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
const exec = promisify(execFile);
export type MountSupport = {
  available: boolean;
  message: string;
  installURL?: string;
};
async function accessible(file: string, mode?: number) {
  try {
    await access(file, mode);
    return true;
  } catch (e) {
    if (
      ["ENOENT", "EACCES", "EPERM"].includes(
        (e as NodeJS.ErrnoException).code ?? "",
      )
    )
      return false;
    throw e;
  }
}
export async function detectMountSupport(): Promise<MountSupport> {
  if (process.platform === "win32") {
    const roots = [
      path.join(
        process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)",
        "WinFsp",
      ),
      path.join(process.env.ProgramFiles ?? "C:/Program Files", "WinFsp"),
    ];
    for (const key of [
      "HKLM\\SOFTWARE\\WinFsp",
      "HKLM\\SOFTWARE\\WOW6432Node\\WinFsp",
    ]) {
      try {
        const result = await exec(
          path.join(
            process.env.SystemRoot ?? "C:/Windows",
            "System32",
            "reg.exe",
          ),
          ["query", key, "/v", "InstallDir"],
          { windowsHide: true, timeout: 5000 },
        );
        const value = result.stdout
          .match(/^\s*InstallDir\s+REG_SZ\s+(.+)$/m)?.[1]
          ?.trim();
        if (value) roots.push(value);
      } catch {
        /* Missing registry keys do not establish absence; also examine standard installations. */
      }
    }
    for (const root of roots)
      if (
        await accessible(
          path.join(
            root,
            "bin",
            process.arch === "arm64" ? "winfsp-a64.dll" : "winfsp-x64.dll",
          ),
        )
      )
        return {
          available: true,
          message: "Suporte a unidades virtuais instalado.",
        };
    return {
      available: false,
      message:
        "Ative o suporte a unidades virtuais para que a conta apareça em Este Computador. A autorização da conta foi preservada.",
      installURL: "https://winfsp.dev/rel/",
    };
  }
  if (process.platform === "linux")
    return (await accessible("/dev/fuse", constants.R_OK | constants.W_OK))
      ? { available: true, message: "FUSE disponível." }
      : {
          available: false,
          message:
            "O acesso ao FUSE não está disponível. Verifique o pacote FUSE e a permissão de /dev/fuse antes de montar.",
        };
  if (process.platform === "darwin")
    return (await accessible("/Library/Filesystems/macfuse.fs"))
      ? {
          available: true,
          message:
            "macFUSE instalado; a autorização do sistema ainda poderá ser necessária.",
        }
      : {
          available: false,
          message:
            "Instale e autorize o macFUSE para montar as contas no Finder.",
          installURL: "https://macfuse.github.io/",
        };
  return { available: false, message: "Sistema sem suporte a montagem." };
}
export function chooseDriveLetter(
  occupied: string[],
  preferred?: string,
): string {
  const used = new Set(occupied.map((p) => p.slice(0, 2).toUpperCase()));
  if (
    preferred &&
    /^[D-Z]:$/i.test(preferred) &&
    !used.has(preferred.toUpperCase())
  )
    return preferred.toUpperCase();
  for (const letter of "G H N O P Q R S T U V W X Y Z D E F I J K L M".split(
    " ",
  ))
    if (!used.has(letter + ":")) return letter + ":";
  throw new UserError(
    "Não há letra de unidade disponível. Libere uma unidade e tente novamente.",
  );
}
export async function logicalDrives(): Promise<string[]> {
  const result = await exec(
    path.join(
      process.env.SystemRoot ?? "C:/Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "[System.Console]::Write([string]::Join([System.Environment]::NewLine,[System.Environment]::GetLogicalDrives()))",
    ],
    { windowsHide: true, timeout: 10000 },
  );
  const value: unknown = result.stdout.trim().split(/\r?\n/);
  if (
    !Array.isArray(value) ||
    !value.every((d) => typeof d === "string" && /^[A-Z]:\\$/i.test(d))
  )
    throw new UserError("Não foi possível consultar as unidades do Windows.");
  return value;
}
export function linuxRcloneMounted(mountInfo: string, target: string): boolean {
  return mountInfo.split("\n").some((entry) => {
    const [mount, filesystem] = entry.split(" - ");
    if (filesystem?.split(" ", 1)[0] !== "fuse.rclone") return false;
    const mountPath = mount.split(" ")[4]?.replace(
      /\\([0-7]{3})/g,
      (_, octal: string) => String.fromCharCode(parseInt(octal, 8)),
    );
    return mountPath === target;
  });
}

/** The RC server answers before the volume is attached. On Linux, consult the kernel without touching the FUSE root. */
export async function mountVisible(target: string): Promise<boolean> {
  try {
    if (process.platform === "linux") {
      const parent = await realpath(path.dirname(target));
      return linuxRcloneMounted(
        await readFile("/proc/self/mountinfo", "utf8"),
        path.join(parent, path.basename(target)),
      );
    }
    if (process.platform === "win32") {
      await access(target);
      return true;
    }
    const [mounted, parent] = await Promise.all([stat(target), stat(path.dirname(target))]);
    return mounted.dev !== parent.dev;
  } catch {
    return false;
  }
}
export async function ensureEmptyMountDirectory(directory: string) {
  const entries = await readdir(directory);
  if (entries.length)
    throw new UserError(
      "A pasta de montagem contém arquivos. Escolha uma pasta vazia para preservar os documentos existentes.",
    );
}
/** inUse counts VFS references, not open files: a mounted VFS normally reports 1. */
export function pendingWrites(value: unknown): boolean {
  if (!value || typeof value !== "object" || !("diskCache" in value))
    throw new UserError("Não foi possível verificar as gravações da unidade.");
  const cache = value.diskCache as Record<string, unknown> | null;
  if (
    !cache ||
    typeof cache.uploadsInProgress !== "number" ||
    typeof cache.uploadsQueued !== "number" ||
    typeof cache.erroredFiles !== "number"
  )
    throw new UserError("Estado das gravações desconhecido.");
  return (
    cache.uploadsInProgress > 0 ||
    cache.uploadsQueued > 0 ||
    cache.erroredFiles > 0
  );
}
