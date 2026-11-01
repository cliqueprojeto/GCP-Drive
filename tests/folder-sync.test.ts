import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  FolderSyncManager,
  overlaps,
  remoteOverlaps,
} from "../src/folder-sync.ts";
import type { FolderPlan } from "../src/contracts.ts";
test("pause retains the running owner through final validation and never overlaps another execution", async () => {
  const p: FolderPlan = {
    id: "sync-test",
    accountId: "account",
    localPath: path.resolve("documents"),
    remotePath: "Computador",
    enabled: false,
    initialized: true,
  };
  let release!: () => void;
  let calls = 0;
  const complete = new Promise<void>((r) => (release = r));
  const manager = new FolderSyncManager(
    path.resolve("state"),
    {
      plans: () => [p],
      remote: async () => "cloud:Computador",
      list: async () => [],
      execute: async () => {
        calls++;
        await complete;
      },
      persist: async () => {},
      record: () => {},
    },
    60000,
  );
  await manager.start(p.id);
  assert.equal(manager.activeFor("account"), true);
  await manager.pause(p.id);
  assert.equal(manager.active, true);
  await assert.rejects(manager.start(p.id));
  assert.equal(calls, 1);
  release();
  await manager.settle();
  assert.equal(manager.active, false);
  assert.equal(manager.snapshot()[0].phase, "paused");
  manager.stopTimers();
});
test("first synchronization requires a reviewed preview and a failed run pauses automatic retries", async () => {
  const p: FolderPlan = {
    id: "sync-test",
    accountId: "a",
    localPath: path.resolve("documents"),
    remotePath: "Computador",
    enabled: false,
    initialized: false,
  };
  let fail = false;
  const manager = new FolderSyncManager(path.resolve("state"), {
    plans: () => [p],
    remote: async () => "cloud:Computador",
    list: async () => [],
    execute: async () => {
      if (fail) throw new Error("provider failed");
    },
    persist: async () => {},
    record: () => {},
  });
  await assert.rejects(manager.start(p.id), /prévia/);
  await manager.preview(p.id);
  fail = true;
  await manager.start(p.id);
  await manager.settle();
  assert.equal(p.enabled, false);
  assert.equal(p.initialized, false);
  assert.equal(manager.snapshot()[0].phase, "error");
  await assert.rejects(manager.start(p.id), /prévia/);
  manager.stopTimers();
});
test("overlap detection distinguishes nested roots from merely similar names", () => {
  const root = path.resolve("docs");
  assert.equal(overlaps(root, path.join(root, "sub")), true);
  assert.equal(overlaps(root, root + "-extra"), false);
  assert.equal(remoteOverlaps("Meu Drive/A", "Meu Drive/A/sub"), true);
  assert.equal(remoteOverlaps("Meu Drive/A", "Meu Drive/AB"), false);
});
