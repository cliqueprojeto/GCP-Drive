import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseDriveLetter, pendingWrites } from "../src/mount-platform.ts";
test("Windows drive selection preserves an available preference and never takes an occupied letter", () => {
  assert.equal(chooseDriveLetter(["C:\\", "G:\\", "I:\\"], "P:"), "P:");
  assert.equal(chooseDriveLetter(["C:\\", "G:\\"], "G:"), "H:");
  assert.throws(() =>
    chooseDriveLetter(
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((l) => l + ":\\"),
    ),
  );
});
test("VFS reference count one is not a pending upload, while unknown cache state stays unknown", () => {
  assert.equal(
    pendingWrites({
      inUse: 1,
      diskCache: { uploadsInProgress: 0, uploadsQueued: 0, erroredFiles: 0 },
    }),
    false,
  );
  assert.equal(
    pendingWrites({
      inUse: 1,
      diskCache: { uploadsInProgress: 0, uploadsQueued: 1, erroredFiles: 0 },
    }),
    true,
  );
  assert.throws(() => pendingWrites({ inUse: 1, diskCache: {} }));
});
