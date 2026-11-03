import {UserError,userMessage} from './user-error.ts';
import path from "node:path";
import type { Account, Entry, Provider } from "./contracts.ts";
import {providers} from './providers.ts';
export function provider(value: unknown): Provider {
  if (typeof value!=='string'||!Object.hasOwn(providers,value))
    throw new UserError("Provedor inválido.");
  return value as Provider;
}
export function relativePath(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.split("/").some((p) => p === ".." || p === ".") ||
    /[\x00-\x1f]/u.test(value)
  )
    throw new UserError("Caminho inválido.");
  return value;
}
export function withinMount(root: string, value: unknown): string {
  const target = path.resolve(root, relativePath(value));
  const relative = path.relative(root, target);
  if (
    relative.startsWith(".." + path.sep) ||
    relative === ".." ||
    path.isAbsolute(relative)
  )
    throw new UserError("Caminho fora da unidade.");
  return target;
}
/** Volume label; on Windows network mode it is also the share name Explorer records under \\server. */
export function volumeName(account: Pick<Account, "label">): string {
  return `GCP-Drive · ${account.label}`;
}
/** Providers whose backend reports remote changes; their directory cache is invalidated by polling, not by age. */
const changePolling = new Set<Provider>(["drive", "onedrive", "dropbox"]);
export function mountArgs(
  account: Account,
  mount: string,
  cache: string,
  remote = `${account.id}:`,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const polled = changePolling.has(account.provider);
  return [
    "mount",
    remote,
    mount,
    "--vfs-cache-mode",
    "full",
    "--cache-dir",
    path.join(cache, account.id),
    "--vfs-cache-max-size",
    "10G",
    "--vfs-cache-min-free-space",
    "2G",
    "--vfs-cache-max-age",
    "336h",
    // Size and modification time identify cached data without hashing it again on open.
    "--vfs-fast-fingerprint",
    "--buffer-size",
    "4M",
    "--vfs-read-chunk-size",
    "16M",
    "--vfs-read-chunk-streams",
    "4",
    "--vfs-write-back",
    "5s",
    // Listings stay valid until the provider reports a change; unpolled providers expire them.
    "--dir-cache-time",
    polled ? "168h" : "5m",
    ...(polled ? ["--poll-interval", "15s"] : []),
    // File managers stat each entry repeatedly; kernel and WinFsp attribute caching avoids those round trips.
    "--attr-timeout",
    "10s",
    "--file-perms",
    "0600",
    "--dir-perms",
    "0700",
    // Explorer treats network volumes as high latency and does not read media to build thumbnails.
    ...(platform === "win32" ? ["--network-mode"] : []),
    "--volname",
    volumeName(account),
    ...(platform === "darwin" ? ["-o", "noappledouble", "-o", "noapplexattr"] : []),
    "--log-level",
    "ERROR",
  ];
}
export function syncObservation(
  stats: unknown,
): "unknown" | "idle" | "transferring" | "problem" {
  if (!stats || typeof stats !== "object") return "unknown";
  const value = stats as Record<string, any>;
  if (
    value.diskCache?.outOfSpace === true ||
    (typeof value.diskCache?.erroredFiles === "number" &&
      value.diskCache.erroredFiles > 0)
  )
    return "problem";
  if (
    (typeof value.diskCache?.uploadsQueued === "number" &&
      value.diskCache.uploadsQueued > 0) ||
    (typeof value.diskCache?.uploadsInProgress === "number" &&
      value.diskCache.uploadsInProgress > 0)
  )
    return "transferring";
  if (
    value.diskCache?.uploadsQueued === 0 &&
    value.diskCache?.uploadsInProgress === 0
  )
    return "idle";
  return "unknown";
}
export function sharedUpstreams(value: unknown, remote: string): string {
  if (!Array.isArray(value))
    throw new UserError("Lista de drives compartilhados inválida.");
  const used = new Set<string>();
  return value
    .map((d: unknown) => {
      if (
        !d ||
        typeof d !== "object" ||
        !("id" in d) ||
        !("name" in d) ||
        typeof d.id !== "string" ||
        typeof d.name !== "string" ||
        !/^[\w-]+$/.test(d.id) ||
        !d.name ||
        /[\x00-\x1f/\\]/.test(d.name)
      )
        throw new UserError(
          "Drive compartilhado com nome incompatível. O nome original foi preservado; montagem interrompida.",
        );
      let label = d.name;
      let suffix = 2;
      while (used.has(label)) label = `${d.name} (${suffix++})`;
      used.add(label);
      return JSON.stringify(
        `${label}=${remote},team_drive=${d.id},root_folder_id=:`,
      );
    })
    .join(" ");
}
export function parseEntries(value: unknown): Entry[] {
  if (!Array.isArray(value)) throw new UserError("Resposta de arquivos inválida.");
  return value.map((row) => {
    if (
      !row ||
      typeof row !== "object" ||
      typeof row.Name !== "string" ||
      typeof row.Path !== "string" ||
      typeof row.IsDir !== "boolean" ||
      typeof row.Size !== "number" ||
      typeof row.ModTime !== "string"
    )
      throw new UserError("Arquivo com metadados inválidos.");
    relativePath(row.Path);
    return {
      Name: row.Name,
      Path: row.Path,
      Size: row.Size,
      IsDir: row.IsDir,
      ModTime: row.ModTime,
    };
  });
}
export function systemLanguage(value: string): "pt-BR" | "en" | "es" {
  return value.toLowerCase().startsWith("en")
    ? "en"
    : value.toLowerCase().startsWith("es")
      ? "es"
      : "pt-BR";
}
/** RC paths are relative to the remote root; CLI listings are relative to the selected folder. */
export function parseFolderListing(value:unknown,folder:string):Entry[]{
  return parseEntries(value).map(entry=>{
    if(entry.Name.includes('/')||entry.Name.includes('\\')||entry.Name==='.'||entry.Name==='..'||(entry.Path!==entry.Name&&entry.Path!==(folder?folder+'/':'')+entry.Name))throw new UserError('Resposta de pasta com caminho incompatível.');
    return {...entry,Path:entry.Name};
  });
}
