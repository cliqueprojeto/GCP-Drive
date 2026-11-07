import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  mountArgs,
  parseEntries,
  relativePath,
  sharedUpstreams,
  syncObservation,
  systemLanguage,
  withinMount,
} from "../src/core.ts";
test("opening preserves Unicode and spaces but rejects parent and absolute paths", () => {
  assert.equal(
    relativePath("Projetos/Ação cultural.pdf"),
    "Projetos/Ação cultural.pdf",
  );
  const root = path.resolve("mount");
  assert.equal(
    withinMount(root, "Projetos/Ação cultural.pdf"),
    path.join(root, "Projetos", "Ação cultural.pdf"),
  );
  for (const value of [
    "../secrets",
    "/etc/passwd",
    "folder/../file",
    "C:\\Users\\file",
    "a\0b",
    "./file",
    "a\nb",
  ])
    assert.throws(() => withinMount(root, value));
});
test("mounts use separate cache identity and argv, not a shell or mirror command", () => {
  const a = {
    id: "gcp-a",
    label: "Trabalho",
    provider: "drive" as const,
    autoMount: true,
  };
  const b = { ...a, id: "gcp-b" };
  assert.ok(
    mountArgs(a, "MOUNT", "CACHE").includes(path.join("CACHE", "gcp-a")),
  );
  assert.ok(
    mountArgs(b, "MOUNT", "CACHE").includes(path.join("CACHE", "gcp-b")),
  );
  assert.equal(mountArgs(a, "MOUNT", "CACHE")[0], "mount");
  assert.equal(mountArgs(a, "MOUNT", "CACHE")[1], "gcp-a:");
  const args = mountArgs(a, "MOUNT", "CACHE");
  assert.equal(args[args.indexOf("--file-perms") + 1], "0600");
  assert.equal(args[args.indexOf("--dir-perms") + 1], "0700");
  assert.equal(args.includes("--allow-other"), false);
});
test("listing boundary rejects malformed rows and keeps display names separate", () => {
  const row = {
    Name: "Meu arquivo.pdf",
    Path: "Pasta/Meu arquivo.pdf",
    Size: 10,
    IsDir: false,
    ModTime: "2026-11-01T10:00:00Z",
  };
  assert.deepEqual(parseEntries([row]), [row]);
  assert.throws(() => parseEntries([{ ...row, Path: "../escape" }]));
  assert.throws(() => parseEntries([{ ...row, IsDir: "false" }]));
  assert.throws(() => parseEntries({ files: [] }));
});
test("unknown live status never becomes synchronized", () => {
  for (const s of [
    null,
    {},
    { diskCache: {} },
    { diskCache: { uploadsQueued: 0 } },
  ])
    assert.equal(syncObservation(s), "unknown");
  assert.equal(
    syncObservation({ diskCache: { uploadsQueued: 0, uploadsInProgress: 0 } }),
    "idle",
  );
  assert.equal(
    syncObservation({ diskCache: { uploadsQueued: 1, uploadsInProgress: 0 } }),
    "transferring",
  );
  assert.equal(
    syncObservation({
      diskCache: { outOfSpace: true, uploadsQueued: 0, uploadsInProgress: 0 },
    }),
    "problem",
  );
  assert.equal(syncObservation({ diskCache: { erroredFiles: 1 } }), "problem");
});
test("shared drives retain names, disambiguate duplicates, and reject unmappable identities", () => {
  const upstreams = sharedUpstreams(
    [
      { id: "ID_A", name: "Projetos culturais" },
      { id: "ID_B", name: "Projetos culturais" },
    ],
    "gcp-a",
  );
  assert.match(
    upstreams,
    /Projetos culturais=gcp-a,team_drive=ID_A,root_folder_id=:/,
  );
  assert.match(
    upstreams,
    /Projetos culturais \(2\)=gcp-a,team_drive=ID_B,root_folder_id=:/,
  );
  assert.throws(() =>
    sharedUpstreams([{ id: "A,extra=x", name: "Nome" }], "gcp-a"),
  );
  assert.throws(() =>
    sharedUpstreams([{ id: "A", name: "Nome/Subpasta" }], "gcp-a"),
  );
});
test("language detection prioritizes supported system languages and defaults to Brazil", () => {
  assert.equal(systemLanguage("es-MX"), "es");
  assert.equal(systemLanguage("en-GB"), "en");
  assert.equal(systemLanguage("pt-PT"), "pt-BR");
  assert.equal(systemLanguage("de-DE"), "pt-BR");
});
test("mount tuning keeps listings until polled providers report changes and expires the others", () => {
  const base = { id: "gcp-a", label: "Trabalho", autoMount: true };
  const value = (args: string[], flag: string) => args[args.indexOf(flag) + 1];
  const drive = mountArgs({ ...base, provider: "drive" }, "M", "C", undefined, "linux");
  assert.equal(value(drive, "--dir-cache-time"), "168h");
  assert.equal(value(drive, "--poll-interval"), "15s");
  assert.equal(value(drive, "--attr-timeout"), "10s");
  assert.equal(value(drive, "--vfs-cache-mode"), "full");
  assert.equal(value(drive, "--vfs-cache-max-size"), "2G");
  assert.equal(value(drive, "--vfs-read-chunk-streams"), "0");
  assert.ok(drive.includes("--vfs-fast-fingerprint"));
  assert.equal(drive.includes("--network-mode"), false);
  const mega = mountArgs({ ...base, provider: "mega" }, "M", "C", undefined, "linux");
  assert.equal(value(mega, "--dir-cache-time"), "5m");
  assert.equal(mega.includes("--poll-interval"), false);
  const windows = mountArgs({ ...base, provider: "onedrive" }, "G:", "C", undefined, "win32");
  assert.ok(windows.includes("--network-mode"));
  assert.equal(value(windows, "--volname"), "GCP-Drive · Trabalho");
  const mac = mountArgs({ ...base, provider: "dropbox" }, "M", "C", undefined, "darwin");
  assert.ok(mac.includes("noappledouble"));
});
