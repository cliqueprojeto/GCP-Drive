import {UserError,userMessage} from './user-error.ts';
import path from "node:path";
import type {
  FolderPlan,
  FolderPreview,
  FolderSyncState,
} from "./contracts.ts";
export type SyncDependencies = {
  plans: () => FolderPlan[];
  remote: (plan: FolderPlan) => Promise<string>;
  list: (target: string) => Promise<{ Path: string }[]>;
  execute: (args: string[]) => Promise<void>;
  persist: () => Promise<void>;
  record: (message: string, error?: boolean) => void;
};
export function overlaps(
  a: string,
  b: string,
  platform = process.platform,
): boolean {
  const normalize = (p: string) =>
    platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p);
  const left = normalize(a),
    right = normalize(b);
  const relative = path.relative(left, right),
    inverse = path.relative(right, left);
  const contains = (p: string) =>
    !p || (!p.startsWith(".." + path.sep) && p !== ".." && !path.isAbsolute(p));
  return contains(relative) || contains(inverse);
}
export function remoteOverlaps(a: string, b: string): boolean {
  return a === b || a.startsWith(b + "/") || b.startsWith(a + "/");
}
export function historyPath(remote: string): string {
  const colon = remote.indexOf(":");
  if (colon < 0) throw new UserError("Destino remoto inválido.");
  const prefix = remote.slice(0, colon + 1),
    parts = remote.slice(colon + 1).split("/");
  const root =
    parts[0] === "Meu Drive"
      ? "Meu Drive/"
      : parts[0] === "Drives compartilhados" && parts[1]
        ? `Drives compartilhados/${parts[1]}/`
        : "";
  return prefix + root + "Histórico GCP-Drive";
}
/** One owner for each plan, timer, active job and bisync work directory. */
export class FolderSyncManager {
  private states = new Map<string, FolderSyncState>();
  private jobs = new Map<string, Promise<void>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private reviewed = new Set<string>();
  private previews = new Set<string>();
  private root: string;
  private deps: SyncDependencies;
  private intervalMs: number;
  constructor(root: string, deps: SyncDependencies, intervalMs = 60000) {
    this.root = root;
    this.deps = deps;
    this.intervalMs = intervalMs;
  }
  snapshot() {
    return this.deps
      .plans()
      .map(
        (p) => this.states.get(p.id) ?? { id: p.id, phase: "paused" as const },
      );
  }
  get active() {
    return this.jobs.size > 0 || this.previews.size > 0;
  }
  activeFor(accountId: string) {
    return this.deps
      .plans()
      .some(
        (p) =>
          p.accountId === accountId &&
          (this.jobs.has(p.id) || this.previews.has(p.id)),
      );
  }
  private plan(id: string) {
    const p = this.deps.plans().find((p) => p.id === id);
    if (!p) throw new UserError("Sincronização não encontrada.");
    return p;
  }
  private historyLocal(id: string) {
    return path.join(this.root, "versions", id);
  }
  async preview(id: string): Promise<FolderPreview> {
    const p = this.plan(id);
    if (p.enabled || this.jobs.has(id) || this.previews.has(id))
      throw new UserError(
        "Pause esta pasta e aguarde a operação em andamento antes da prévia.",
      );
    this.previews.add(id);
    this.states.set(id, { id, phase: "previewing" });
    try {
      const remote = await this.deps.remote(p);
      const [local, cloud] = await Promise.all([
        this.deps.list(p.localPath),
        this.deps.list(remote),
      ]);
      const names = new Set(local.map((e) => e.Path));
      const report: FolderPreview = {
        planId: id,
        localFiles: local.length,
        cloudFiles: cloud.length,
        sameNames: cloud.filter((e) => names.has(e.Path)).length,
        historyLocal: this.historyLocal(id),
        historyRemote: historyPath(remote) + "/" + id,
      };
      // Real provider dry-run, with its own local state directory. No remote writes.
      await this.deps.execute([
        ...this.args(p, remote, true),
        "--workdir",
        path.join(this.root, "bisync", id, "preview"),
        "--dry-run",
      ]);
      this.reviewed.add(id);
      this.states.set(id, { id, phase: "ready" });
      return report;
    } catch (e) {
      this.states.set(id, {
        id,
        phase: "error",
        message: e instanceof Error ? userMessage(e) : "Falha na prévia.",
      });
      throw e;
    } finally {
      this.previews.delete(id);
    }
  }
  private args(p: FolderPlan, remote: string, initial: boolean): string[] {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return [
      "bisync",
      p.localPath,
      remote,
      "--compare",
      "size,modtime,checksum",
      "--conflict-resolve",
      "none",
      "--conflict-loser",
      "num",
      "--conflict-suffix",
      "conflito-local,conflito-nuvem",
      "--backup-dir1",
      path.join(this.historyLocal(p.id), stamp),
      "--backup-dir2",
      `${historyPath(remote)}/${p.id}/${stamp}`,
      "--recover",
      "--resilient",
      "--check-sync",
      "true",
      ...(initial ? ["--resync-mode", "newer"] : []),
    ];
  }
  async start(id: string) {
    const p = this.plan(id);
    if (this.jobs.has(id) || this.previews.has(id))
      throw new UserError("Esta pasta já está sendo sincronizada.");
    if (!p.initialized && !this.reviewed.has(id))
      throw new UserError("Revise a prévia antes da primeira sincronização.");
    p.enabled = true;
    await this.deps.persist();
    this.kick(p);
  }
  private kick(p: FolderPlan) {
    if (this.jobs.has(p.id) || !p.enabled) return;
    const timer = this.timers.get(p.id);
    if (timer) clearTimeout(timer);
    this.timers.delete(p.id);
    this.states.set(p.id, { id: p.id, phase: "syncing" });
    const job = this.perform(p);
    this.jobs.set(p.id, job);
    void job.finally(() => {
      this.jobs.delete(p.id);
      if (p.enabled)
        this.timers.set(
          p.id,
          setTimeout(() => this.kick(p), this.intervalMs),
        );
    });
  }
  private async perform(p: FolderPlan) {
    try {
      const remote = await this.deps.remote(p);
      await this.deps.execute([
        ...this.args(p, remote, !p.initialized),
        "--workdir",
        path.join(this.root, "bisync", p.id, "active"),
      ]);
      p.initialized = true;
      this.reviewed.delete(p.id);
      await this.deps.persist();
      this.states.set(p.id, {
        id: p.id,
        phase: p.enabled ? "idle" : "paused",
        lastSuccess: new Date().toISOString(),
      });
      this.deps.record(`Pasta sincronizada: ${path.basename(p.localPath)}`);
    } catch (e) {
      p.enabled = false;
      this.reviewed.delete(p.id);
      this.states.set(p.id, {
        id: p.id,
        phase: "error",
        message: e instanceof Error ? userMessage(e) : "Sincronização interrompida.",
      });
      this.deps.record(
        `Sincronização pausada; histórico preservado: ${path.basename(p.localPath)}`,
        true,
      );
      try {
        await this.deps.persist();
      } catch {
        this.deps.record(
          "Não foi possível salvar a pausa. A operação permanece sob supervisão.",
          true,
        );
      }
    }
  }
  async pause(id: string) {
    const p = this.plan(id);
    p.enabled = false;
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    await this.deps.persist();
    if (!this.jobs.has(id)) this.states.set(id, { id, phase: "paused" });
    // An active transfer keeps its owner until rclone finishes final validation/cleanup.
  }
  async remove(id: string) {
    await this.pause(id);
    if (this.previews.has(id))
      throw new UserError("Aguarde a prévia terminar antes de remover esta sincronização.");
    await this.jobs.get(id);
    const plans = this.deps.plans();
    const position = plans.findIndex(p => p.id === id);
    if (position >= 0) plans.splice(position, 1);
    await this.deps.persist();
    this.states.delete(id);
    this.reviewed.delete(id);
    // Retain recovery state and backups; removing a plan never deletes user files.
  }
  resumeSaved() {
    for (const p of this.deps.plans())
      if (p.enabled && p.initialized) this.kick(p);
  }
  async settle() {
    await Promise.all(this.jobs.values());
  }
  stopTimers() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
