import {UserError,userMessage} from './user-error.ts';
import { spawn } from "node:child_process";
export class CommandFailure extends UserError {
  kind: "cancelled" | "timeout" | "capacity" | "spawn" | "exit";
  exitCode?: number;
  constructor(
    kind: CommandFailure["kind"],
    message: string,
    exitCode?: number,
  ) {
    super(message);
    this.name = "CommandFailure";
    this.kind = kind;
    this.exitCode = exitCode;
  }
}
/** Cancellation requests termination; completion is delivered only after the owned handle closes. */
export function executeCommand(
  executable: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    timeout?: number;
    maxBytes?: number;
  } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new CommandFailure("cancelled", "Conexão cancelada."));
      return;
    }
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let bytes = 0;
    let failure: CommandFailure | undefined;
    const stop = (error: CommandFailure) => {
      if (failure) return;
      failure = error;
      child.kill();
    };
    const abort = () =>
      stop(new CommandFailure("cancelled", "Conexão cancelada."));
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () =>
        stop(
          new CommandFailure(
            "timeout",
            "A operação excedeu o tempo. Você pode tentar novamente.",
          ),
        ),
      options.timeout ?? 45000,
    );
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > (options.maxBytes ?? 8 * 1024 * 1024))
        stop(
          new CommandFailure(
            "capacity",
            "O resultado excedeu o limite desta operação.",
          ),
        );
      else if (!failure) output += chunk;
    });
    child.stderr.on("data", () => {});
    child.once("error", () => {
      failure ??= new CommandFailure(
        "spawn",
        "Não foi possível executar o motor de sincronização.",
      );
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else if (code === 0) resolve(output);
      else
        reject(
          new CommandFailure(
            "exit",
            `O motor não concluiu a operação (código ${code ?? "desconhecido"}).`,
            code ?? undefined,
          ),
        );
    });
  });
}
/** Owns short-lived query/config commands; mount and synchronization owners remain separate. */
export class CommandGroup {
  private active = new Map<AbortController, Promise<string>>();
  private closing = false;
  async execute(
    executable: string,
    args: string[],
    options: Parameters<typeof executeCommand>[2] = {},
  ) {
    if (this.closing)
      throw new CommandFailure("cancelled", "O aplicativo está encerrando.");
    const controller = new AbortController();
    const relay = () => controller.abort();
    options?.signal?.addEventListener("abort", relay, { once: true });
    if (options?.signal?.aborted) controller.abort();
    const done = executeCommand(executable, args, {
      ...options,
      signal: controller.signal,
    });
    this.active.set(controller, done);
    try {
      return await done;
    } finally {
      options?.signal?.removeEventListener("abort", relay);
      this.active.delete(controller);
    }
  }
  async close() {
    this.closing = true;
    for (const controller of this.active.keys()) controller.abort();
    await Promise.allSettled(this.active.values());
  }
  reopen() {
    if (this.active.size)
      throw new UserError("Há processos que ainda não concluíram o encerramento.");
    this.closing = false;
  }
}
