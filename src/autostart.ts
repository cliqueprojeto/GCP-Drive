import {UserError,userMessage} from './user-error.ts';
import path from "node:path";
import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  rename,
  unlink,
} from "node:fs/promises";
const marker = "X-GCPDrive-Managed=true";
export function desktopEntry(executable: string): string {
  if (!path.isAbsolute(executable) || /[\r\n\0]/.test(executable))
    throw new UserError("Executável inválido para inicialização.");
  const quoted =
    '"' + executable.replace(/([\\"`$])/g, "\\$1").replace(/%/g, "%%") + '"';
  return `[Desktop Entry]\nType=Application\nVersion=1.0\nName=GCP-Drive\nComment=Suas nuvens no seu computador\nExec=${quoted} --hidden\nTerminal=false\nCategories=Network;FileTransfer;\nX-GNOME-Autostart-enabled=true\n${marker}\n`;
}
export async function linuxAutostart(
  configHome: string,
  executable: string,
  enabled: boolean,
) {
  const folder = path.join(configHome, "autostart");
  const file = path.join(folder, "br.com.gestaoculturalpro.drive.desktop");
  let previous: string | undefined;
  try {
    previous = await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  if (previous && !previous.split("\n").includes(marker))
    throw new UserError("Atalho existente não pertence ao GCP-Drive.");
  const next = desktopEntry(executable);
  if (enabled && previous === next) return;
  if (previous) await copyFile(file, file + ".bak");
  if (enabled) {
    await mkdir(folder, { recursive: true });
    await writeFile(file + ".new", next, { mode: 0o600 });
    await rename(file + ".new", file);
  } else if (previous !== undefined) await unlink(file);
}
