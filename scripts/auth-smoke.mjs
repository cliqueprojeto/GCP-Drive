import { _electron } from "playwright-core";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import electron from "electron";
const profile = await mkdtemp(path.join(tmpdir(), "gcp-drive-auth-smoke-"));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({
  executablePath: electron,
  args: [".", `--gcp-test-profile=${profile}`, "--lang=pt-BR"],
  env,
  timeout: 30000,
});
let exited = false;
try {
  const page = await app.firstWindow();
  await page
    .getByRole("heading", { name: "Seu trabalho flui melhor aqui." })
    .waitFor();
  await page
    .getByRole("button", { name: "Conectar conta", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Como quer chamar esta conta?")
    .fill("Teste cancelável");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page
    .getByRole("heading", { name: "Credencial do Google Drive", exact: true })
    .waitFor({ timeout: 20000 });
  const dialog = page.getByRole("dialog");
  const text = await dialog.innerText();
  assert.ok(!text.includes("config_shared_client_id"));
  assert.ok(!text.includes("rclone's shared"));
  assert.ok(!text.includes("\nYes\n"));
  assert.ok(!text.includes("\nNo\n"));
  await mkdir(".local", { recursive: true });
  await page.screenshot({ path: ".local/auth-pt-br.png" });
  await page
    .getByRole("button", { name: "Cancelar conexão", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  for (let i = 0; i < 30; i++) {
    const s = await page.evaluate(() => window.gcpDrive.call("snapshot", null));
    if (s.ok && !s.value.preferences.loginDrafts?.length) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const after = await page.evaluate(() =>
    window.gcpDrive.call("snapshot", null),
  );
  assert.equal(after.ok, true);
  assert.equal(after.value.preferences.accounts.length, 0);
  assert.equal(after.value.preferences.loginDrafts?.length ?? 0, 0);
  // A second attempt must be possible after cancellation, with the same display name.
  await page
    .getByRole("button", { name: "Conectar conta", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Como quer chamar esta conta?")
    .fill("Teste cancelável");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page
    .getByRole("heading", { name: "Credencial do Google Drive", exact: true })
    .waitFor();
  const closed = app.waitForEvent("close", { timeout: 15000 });
  await page.evaluate(() => window.gcpDrive.call("quit", null)).catch(() => {});
  await closed;
  exited = true;
  console.log(
    JSON.stringify({
      passed: true,
      scope:
        "rclone real: primeira pergunta, tradução PT-BR, cancelamento, nova tentativa e saída durante conexão; sem OAuth real",
      profile,
    }),
  );
} finally {
  if (!exited) await app.evaluate(({ app }) => app.exit(1)).catch(() => {});
}
