import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { desktopEntry, linuxAutostart } from "../src/autostart.ts";
test("desktop entry quotes a caller-selected absolute path and neutralizes field codes", () => {
  const executable = path.resolve("GCP Drive 100%", "GCP-Drive");
  const entry = desktopEntry(executable);
  assert.ok(entry.includes("100%%"));
  assert.ok(entry.includes('" --hidden'));
  assert.ok(entry.includes("Categories=Network;FileTransfer;"));
  assert.throws(() => desktopEntry("relative"));
  assert.throws(() => desktopEntry(path.resolve("bad") + "\nExec=other"));
});
test("autostart is idempotent, backs up changes and refuses foreign shortcut ownership", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gcp-drive-autostart-"));
  const file = path.join(
    root,
    "autostart",
    "br.com.gestaoculturalpro.drive.desktop",
  );
  try {
    const executable = path.resolve("GCP-Drive");
    await linuxAutostart(root, executable, true);
    const first = await readFile(file, "utf8");
    await linuxAutostart(root, executable, true);
    await assert.rejects(access(file + ".bak"));
    await linuxAutostart(root, executable, false);
    assert.equal(await readFile(file + ".bak", "utf8"), first);
    await writeFile(file, "[Desktop Entry]\nName=Other app");
    await assert.rejects(
      linuxAutostart(root, executable, true),
      /não pertence/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
