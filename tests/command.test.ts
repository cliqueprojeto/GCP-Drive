import { test } from "node:test";
import assert from "node:assert/strict";
import {
  executeCommand,
  CommandFailure,
  CommandGroup,
} from "../src/command.ts";
test("a waiting owned process can be cancelled and command completion waits for close", async () => {
  const controller = new AbortController();
  const running = executeCommand(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    { signal: controller.signal, timeout: 5000 },
  );
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(
    running,
    (e) => e instanceof CommandFailure && e.kind === "cancelled",
  );
  assert.equal(
    await executeCommand(process.execPath, [
      "-e",
      'process.stdout.write("retomado")',
    ]),
    "retomado",
  );
});
test("a command group drains mixed owned outcomes and blocks late commands until explicitly reopened", async () => {
  const group = new CommandGroup();
  const success = group.execute(process.execPath, [
    "-e",
    'process.stdout.write("pronto")',
  ]);
  assert.equal(await success, "pronto");
  const waiting = group.execute(process.execPath, [
    "-e",
    "setInterval(()=>{},1000)",
  ]);
  const outcome = waiting.catch((error) => error);
  await group.close();
  assert.equal((await outcome).kind, "cancelled");
  await assert.rejects(
    group.execute(process.execPath, ["-e", "process.exit(0)"]),
    /encerrando/,
  );
  group.reopen();
  assert.equal(
    await group.execute(process.execPath, [
      "-e",
      'process.stdout.write("nova tentativa")',
    ]),
    "nova tentativa",
  );
  await group.close();
});
test("aborted-before-start, command deadline and bounded output remain distinguishable", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    executeCommand(process.execPath, ["-e", "process.exit(0)"], {
      signal: controller.signal,
    }),
    (e) => e instanceof CommandFailure && e.kind === "cancelled",
  );
  await assert.rejects(
    executeCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      timeout: 100,
    }),
    (e) => e instanceof CommandFailure && e.kind === "timeout",
  );
  await assert.rejects(
    executeCommand(
      process.execPath,
      ["-e", 'process.stdout.write("x".repeat(8192))'],
      { maxBytes: 128 },
    ),
    (e) => e instanceof CommandFailure && e.kind === "capacity",
  );
});
