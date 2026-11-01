import { _electron } from "playwright-core";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import electron from "electron";
const profile = await mkdtemp(path.join(tmpdir(), "gcp-drive-smoke-"));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({
  executablePath: electron,
  args: [".", `--gcp-test-profile=${profile}`],
  env,
  timeout: 30000,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page
    .getByRole("heading", { name: "Seu trabalho flui melhor aqui." })
    .waitFor();
  const snapshot = await page.evaluate(async () =>
    window.gcpDrive.call("snapshot", null),
  );
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.value.preferences.accounts.length, 0);
  assert.equal(snapshot.value.engine.available, true);
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  await mkdir(".local", { recursive: true });
  await page.screenshot({ path: ".local/overview.png" });
  await page
    .getByRole("button", { name: "Conectar conta", exact: true })
    .first()
    .click();
  await page.getByRole("dialog").waitFor();
  await page.getByLabel("Como quer chamar esta conta?").fill("Google Trabalho");
  assert.equal(
    await page
      .getByRole("button", { name: "Continuar", exact: true })
      .isEnabled(),
    true,
  );
  await page.screenshot({ path: ".local/connect.png" });
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  await page.getByRole("button", { name: "Preferências", exact: true }).click();
  await page.locator(".setting-row select").selectOption("en");
  await page
    .getByRole("heading", { name: "Preferences", exact: true })
    .waitFor();
  await page.locator(".setting-row select").selectOption("es");
  await page
    .getByRole("heading", { name: "Preferencias", exact: true })
    .waitFor();
  await page.locator(".setting-row select").selectOption("pt-BR");
  await page
    .getByRole("heading", { name: "Preferências", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Salvar preferências", exact: true })
    .click();
  await page.getByRole("button", { name: "Visão geral", exact: true }).click();
  await page
    .getByRole("heading", { name: "Seu trabalho flui melhor aqui." })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      engine: snapshot.value.engine.version,
      screenshots: [".local/overview.png", ".local/connect.png"],
      profile,
    }),
  );
} finally {
  await app.evaluate(({ app }) => app.exit(0));
}
