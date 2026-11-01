import { access } from "node:fs/promises";
import path from "node:path";
export default async function beforePack(context) {
  const platform = context.electronPlatformName;
  const arch = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64", 4: "universal" }[
    context.arch
  ];
  if (
    !["win32", "linux", "darwin"].includes(platform) ||
    !["x64", "arm64"].includes(arch)
  )
    throw new Error("Arquitetura de distribuição não suportada.");
  const folder = path.join(
    context.packager.info.appDir,
    "vendor",
    `${platform}-${arch}`,
  );
  await access(
    path.join(folder, platform === "win32" ? "rclone.exe" : "rclone"),
  );
  await access(path.join(folder, "provenance.json"));
}
